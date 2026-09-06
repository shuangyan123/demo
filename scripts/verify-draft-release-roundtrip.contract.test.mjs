import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertDraftReleaseMetadata,
  assertMatchingReleaseArtifacts,
  buildRoundTripEvidence,
  expectedReleaseAssetNames,
  verifyDraftReleaseRoundTrip,
} from "./verify-draft-release-roundtrip.mjs";
import {
  canonicalInstallerFilename,
  formatSha256Manifest,
} from "./release-artifact-provenance.mjs";

const version = "0.3.0";
const installerFilename = canonicalInstallerFilename(version);
const manifestFilename = "SHA256SUMS.txt";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "draft-release-roundtrip-"));
  const canonicalDirectory = path.join(root, "out", "release-canonical");
  const roundTripDirectory = path.join(root, "out", "release-roundtrip");
  mkdirSync(canonicalDirectory, { recursive: true });
  mkdirSync(roundTripDirectory, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }) + "\n", "utf8");
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return { root, canonicalDirectory, roundTripDirectory };
}

async function writeReleaseDirectory(directory, bytes, {
  installerName = installerFilename,
  manifestName = manifestFilename,
  manifestHash = sha256(bytes),
} = {}) {
  await writeFile(path.join(directory, installerName), bytes);
  if (manifestName) {
    await writeFile(path.join(directory, manifestName), formatSha256Manifest(manifestHash, installerName));
  }
}

function validReleaseMetadata(overrides = {}) {
  return {
    id: 987654,
    tag_name: "v0.3.0",
    draft: true,
    prerelease: false,
    published_at: null,
    html_url: "https://github.com/shuangyan123/demo/releases/tag/v0.3.0",
    assets: [
      { id: 1001, name: installerFilename, size: 12 },
      { id: 1002, name: manifestFilename, size: 100 },
    ],
    ...overrides,
  };
}

function validSummary(overrides = {}) {
  return {
    packageVersion: version,
    installerFilename,
    installerByteSize: 12,
    installerSha256: "a".repeat(64),
    manifestSha256: "a".repeat(64),
    releaseFiles: [installerFilename, manifestFilename],
    ...overrides,
  };
}

test("identical canonical and GitHub-hosted asset bytes pass round-trip reconciliation", async (t) => {
  const fixture = createFixture(t);
  const bytes = Buffer.from("canonical installer bytes\n", "utf8");
  await writeReleaseDirectory(fixture.canonicalDirectory, bytes);
  await writeReleaseDirectory(fixture.roundTripDirectory, bytes);

  const result = await verifyDraftReleaseRoundTrip({
    workspaceRoot: fixture.root,
    expectedVersion: version,
    canonicalDirectory: fixture.canonicalDirectory,
    roundTripDirectory: fixture.roundTripDirectory,
  });

  assert.equal(result.canonicalEqualsRoundTrip, true);
  assert.equal(result.canonical.installerSha256, result.roundTrip.installerSha256);
  assert.equal(result.canonical.installerByteSize, result.roundTrip.installerByteSize);
  assert.deepEqual(result.canonical.releaseFiles, result.roundTrip.releaseFiles);
});

test("individually valid but different installer bytes fail cross-directory SHA reconciliation", async (t) => {
  const fixture = createFixture(t);
  await writeReleaseDirectory(fixture.canonicalDirectory, Buffer.from("canonical\n"));
  await writeReleaseDirectory(fixture.roundTripDirectory, Buffer.from("tampered!\n"));

  await assert.rejects(
    verifyDraftReleaseRoundTrip({
      workspaceRoot: fixture.root,
      expectedVersion: version,
      canonicalDirectory: fixture.canonicalDirectory,
      roundTripDirectory: fixture.roundTripDirectory,
    }),
    /Canonical and Draft release installerSha256 differ/,
  );
});

test("manifest, filename, missing-file, and extra-file mutations fail closed", async (t) => {
  const cases = [
    {
      name: "manifest hash mismatch",
      prepare: async (fixture, bytes) => {
        await writeReleaseDirectory(fixture.canonicalDirectory, bytes);
        await writeReleaseDirectory(fixture.roundTripDirectory, bytes, { manifestHash: "0".repeat(64) });
      },
      error: /records .* but staged installer hashes to/,
    },
    {
      name: "wrong installer filename",
      prepare: async (fixture, bytes) => {
        await writeReleaseDirectory(fixture.canonicalDirectory, bytes);
        await writeReleaseDirectory(fixture.roundTripDirectory, bytes, { installerName: "wrong.exe" });
      },
      error: /must contain exactly/,
    },
    {
      name: "missing checksum manifest",
      prepare: async (fixture, bytes) => {
        await writeReleaseDirectory(fixture.canonicalDirectory, bytes);
        await writeReleaseDirectory(fixture.roundTripDirectory, bytes, { manifestName: null });
      },
      error: /must contain exactly/,
    },
    {
      name: "unexpected extra asset",
      prepare: async (fixture, bytes) => {
        await writeReleaseDirectory(fixture.canonicalDirectory, bytes);
        await writeReleaseDirectory(fixture.roundTripDirectory, bytes);
        await writeFile(path.join(fixture.roundTripDirectory, "latest.yml"), "unexpected\n");
      },
      error: /must contain exactly/,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async (subtest) => {
      const fixture = createFixture(subtest);
      await testCase.prepare(fixture, Buffer.from("installer\n"));
      await assert.rejects(
        verifyDraftReleaseRoundTrip({
          workspaceRoot: fixture.root,
          expectedVersion: version,
          canonicalDirectory: fixture.canonicalDirectory,
          roundTripDirectory: fixture.roundTripDirectory,
        }),
        testCase.error,
      );
    });
  }
});

test("package version and directory identity are part of the fail-closed boundary", async (t) => {
  const fixture = createFixture(t);
  const bytes = Buffer.from("installer\n");
  await writeReleaseDirectory(fixture.canonicalDirectory, bytes);
  await writeReleaseDirectory(fixture.roundTripDirectory, bytes);

  await writeFile(path.join(fixture.root, "package.json"), JSON.stringify({ version: "0.3.1" }));
  await assert.rejects(
    verifyDraftReleaseRoundTrip({
      workspaceRoot: fixture.root,
      expectedVersion: version,
      canonicalDirectory: fixture.canonicalDirectory,
      roundTripDirectory: fixture.roundTripDirectory,
    }),
    /does not match authorized version/,
  );

  await assert.rejects(
    verifyDraftReleaseRoundTrip({
      workspaceRoot: fixture.root,
      expectedVersion: version,
      canonicalDirectory: path.join(fixture.root, "out", "same"),
      roundTripDirectory: path.join(fixture.root, "out", "same"),
    }),
    /must be distinct/,
  );
});

test("release metadata accepts only the exact Draft, stable, two-asset boundary", () => {
  const metadata = assertDraftReleaseMetadata(validReleaseMetadata(), {
    expectedTag: "v0.3.0",
    expectedReleaseSha: "b".repeat(40),
    expectedAssetNames: expectedReleaseAssetNames(version, installerFilename),
  });

  assert.equal(metadata.releaseId, 987654);
  assert.equal(metadata.isDraft, true);
  assert.equal(metadata.isPrerelease, false);
  assert.equal(metadata.publishedAt, null);
  assert.deepEqual(metadata.assets.map((asset) => asset.name), [installerFilename, manifestFilename]);

  for (const [name, overrides, expectedError] of [
    ["wrong tag", { tag_name: "v0.3.1" }, /does not match/],
    ["published release", { draft: false, published_at: "2026-09-06T00:00:00Z" }, /must remain a Draft/],
    ["prerelease", { prerelease: true }, /must not be a prerelease/],
    ["unexpected asset", { assets: [...validReleaseMetadata().assets, { id: 1003, name: "latest.yml", size: 1 }] }, /exactly/],
  ]) {
    assert.throws(
      () => assertDraftReleaseMetadata(validReleaseMetadata(overrides), {
        expectedTag: "v0.3.0",
        expectedReleaseSha: "b".repeat(40),
        expectedAssetNames: expectedReleaseAssetNames(version, installerFilename),
      }),
      expectedError,
      name,
    );
  }
});

test("round-trip evidence binds source SHA, tag commit, artifact identity, and local hashes", () => {
  const releaseMetadata = assertDraftReleaseMetadata(validReleaseMetadata(), {
    expectedTag: "v0.3.0",
    expectedReleaseSha: "b".repeat(40),
    expectedAssetNames: expectedReleaseAssetNames(version, installerFilename),
  });
  const summary = validSummary();
  const evidence = buildRoundTripEvidence({
    packageVersion: version,
    expectedTag: "v0.3.0",
    releaseSha: "b".repeat(40),
    tagCommit: "b".repeat(40),
    releaseMetadata,
    canonical: summary,
    roundTrip: { ...summary },
  });

  assert.equal(evidence.productionEvidenceSourceCommit, "b".repeat(40));
  assert.equal(evidence.actionsArtifactReleaseSha, "b".repeat(40));
  assert.equal(evidence.draftInstallerAssetId, 1001);
  assert.equal(evidence.draftManifestAssetId, 1002);
  assert.equal(evidence.canonicalEqualsRoundTrip, true);
  assert.equal(evidence.tagEqualsReleaseSha, true);
  assert.equal(evidence.exactAssetBoundary, true);
  assert.equal(evidence.pass, true);

  assert.throws(
    () => buildRoundTripEvidence({
      packageVersion: version,
      expectedTag: "v0.3.0",
      releaseSha: "b".repeat(40),
      tagCommit: "b".repeat(40),
      releaseMetadata,
      canonical: summary,
      roundTrip: { ...summary },
      actionsArtifactName: "review-workspace-windows-x64-c",
    }),
    /Actions artifact identity/,
  );

  assert.throws(
    () => buildRoundTripEvidence({
      packageVersion: version,
      expectedTag: "v0.3.0",
      releaseSha: "b".repeat(40),
      tagCommit: "c".repeat(40),
      releaseMetadata,
      canonical: summary,
      roundTrip: { ...summary },
    }),
    /tag commit does not match/,
  );
});

test("artifact comparison explicitly checks byte size, hash, manifest, filename, version, and file set", () => {
  const baseline = validSummary();
  const mutations = [
    ["packageVersion", "0.3.1", /packageVersion differ/],
    ["installerFilename", "wrong.exe", /installerFilename differ/],
    ["installerByteSize", 13, /installerByteSize differ/],
    ["installerSha256", "c".repeat(64), /installerSha256 differ/],
    ["manifestSha256", "c".repeat(64), /manifestSha256 differ/],
    ["releaseFiles", [manifestFilename], /releaseFiles differ/],
  ];

  for (const [field, value, expectedError] of mutations) {
    assert.throws(
      () => assertMatchingReleaseArtifacts(baseline, { ...baseline, [field]: value }),
      expectedError,
      field,
    );
  }
});

test("trusted workflow keeps workflow_run authority and delegates Draft operations to the fail-closed script", async () => {
  const workspaceRoot = process.cwd();
  const workflow = await readFile(path.join(workspaceRoot, ".github", "workflows", "trusted-desktop-release.yml"), "utf8");
  const script = await readFile(path.join(workspaceRoot, "scripts", "verify-draft-release-roundtrip.mjs"), "utf8");
  const combined = `${workflow}\n${script}`;

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /workflow_run\.head_sha/);
  assert.match(workflow, /release-roundtrip-evidence/);
  assert.match(workflow, /out\/release-canonical/);
  assert.match(workflow, /out\/release-roundtrip/);
  assert.match(script, /"release",\s*"create"/);
  assert.match(script, /--draft/);
  assert.match(script, /--verify-tag/);
  assert.match(script, /releases\/tags/);
  assert.match(script, /releases\/assets/);
  assert.match(script, /published_at/);
  assert.doesNotMatch(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+repository_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+tags:/m);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  assert.doesNotMatch(combined, /--clobber/);
  assert.doesNotMatch(combined, /gh\s+release\s+(upload|publish)/);
});
