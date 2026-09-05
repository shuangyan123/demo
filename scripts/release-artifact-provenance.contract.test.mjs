import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertMatchingInstallerHashes,
  assertUnsignedAuthenticodeSignature,
  canonicalInstallerFilename,
  finalizeReleaseArtifact,
  formatSha256Manifest,
  getReleaseArtifactPaths,
  parseSha256Manifest,
  sha256File,
  verifyReleaseArtifact,
} from "./release-artifact-provenance.mjs";

const version = "0.2.4";
const installerFilename = canonicalInstallerFilename(version);

function createFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "release-artifact-provenance-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const sourceDirectory = path.join(root, "out", "builder-nsis");
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }) + "\n", "utf8");
  const sourcePath = path.join(sourceDirectory, installerFilename);
  writeFileSync(sourcePath, "canonical NSIS installer bytes\n", "utf8");
  return { root, sourcePath, paths: getReleaseArtifactPaths({ workspaceRoot: root }) };
}

async function writeEvidence(fixture, overrides = {}) {
  const sourceHash = await sha256File(fixture.sourcePath);
  const evidence = {
    installerFilename,
    installerByteSize: readFileSync(fixture.sourcePath).byteLength,
    installerSha256: sourceHash,
    ...overrides,
  };
  await writeFile(fixture.paths.productionEvidencePath, `${JSON.stringify(evidence)}\n`, "utf8");
}

test("finalization copies the canonical source, hashes staged bytes, and self-verifies the public boundary", async (t) => {
  const fixture = createFixture(t);
  await writeEvidence(fixture);

  const result = await finalizeReleaseArtifact({
    workspaceRoot: fixture.root,
    verifyAuthenticode: false,
  });

  assert.equal(result.sourceEqualsStaged, true);
  assert.equal(result.sourceSha256, result.stagedSha256);
  assert.equal(result.stagedSha256, result.manifestSha256);
  assert.deepEqual(result.releaseFiles.sort(), [installerFilename, "SHA256SUMS.txt"].sort());
  assert.equal(
    await readFile(fixture.paths.manifestPath, "utf8"),
    formatSha256Manifest(result.stagedSha256, installerFilename),
  );
  const verified = await verifyReleaseArtifact({ workspaceRoot: fixture.root });
  assert.equal(verified.installerSha256, result.stagedSha256);
  assert.equal(verified.manifestSha256, result.manifestSha256);
  assert.deepEqual(verified.releaseFiles.sort(), result.releaseFiles.sort());
});

test("canonical manifest parser rejects malformed, wrong-hash, wrong-filename, and extra entries", async (t) => {
  const fixture = createFixture(t);
  await writeEvidence(fixture);
  const result = await finalizeReleaseArtifact({ workspaceRoot: fixture.root, verifyAuthenticode: false });
  const manifestPath = fixture.paths.manifestPath;

  assert.throws(
    () => parseSha256Manifest(`${result.manifestSha256} ${installerFilename}\n`, installerFilename),
    /invalid canonical syntax/,
  );
  assert.throws(
    () => parseSha256Manifest(`${result.manifestSha256}  wrong.exe\n`, installerFilename),
    /names .* instead of/,
  );
  assert.throws(
    () => parseSha256Manifest(`${result.manifestSha256}  sub\\${installerFilename}\n`, installerFilename),
    /single filename/,
  );

  await writeFile(manifestPath, `${"0".repeat(64)}  ${installerFilename}\n`, "utf8");
  await assert.rejects(
    verifyReleaseArtifact({ workspaceRoot: fixture.root }),
    /records .* but staged installer hashes to/,
  );

  await writeFile(
    manifestPath,
    `${result.manifestSha256}  ${installerFilename}\n${result.manifestSha256}  ${installerFilename}\n`,
    "utf8",
  );
  await assert.rejects(
    verifyReleaseArtifact({ workspaceRoot: fixture.root }),
    /exactly one checksum entry/,
  );
});

test("missing installer and extra release files fail closed", async (t) => {
  const fixture = createFixture(t);
  await writeEvidence(fixture);
  const result = await finalizeReleaseArtifact({ workspaceRoot: fixture.root, verifyAuthenticode: false });
  const installerPath = fixture.paths.stagedInstallerPath;

  rmSync(installerPath, { force: true });
  await assert.rejects(
    verifyReleaseArtifact({ workspaceRoot: fixture.root }),
    /must contain exactly/,
  );

  await writeFile(installerPath, "canonical NSIS installer bytes\n", "utf8");
  await writeFile(fixture.paths.manifestPath, formatSha256Manifest(result.manifestSha256, installerFilename), "utf8");
  await writeFile(path.join(fixture.paths.releaseDirectory, "latest.yml"), "unexpected\n", "utf8");
  await assert.rejects(
    verifyReleaseArtifact({ workspaceRoot: fixture.root }),
    /must contain exactly/,
  );
});

test("source and staged hash mismatches fail before manifest finalization", async (t) => {
  assert.throws(
    () => assertMatchingInstallerHashes("a".repeat(64), "b".repeat(64)),
    /does not match staged installer/,
  );

  const fixture = createFixture(t);
  await writeEvidence(fixture);
  await assert.rejects(
    finalizeReleaseArtifact({
      workspaceRoot: fixture.root,
      verifyAuthenticode: false,
      copyFileImplementation: async (_source, destination) => {
        await writeFile(destination, "mutated staged bytes\n", "utf8");
      },
    }),
    /does not match staged installer/,
  );
});

test("production-v1 Authenticode contract accepts only an actually unsigned result", () => {
  assert.doesNotThrow(() => assertUnsignedAuthenticodeSignature({
    status: "NotSigned",
    signerCertificatePresent: false,
    timestampSignerPresent: false,
  }));

  for (const signature of [
    { status: "Valid", signerCertificatePresent: true, timestampSignerPresent: true },
    { status: "UnknownError", signerCertificatePresent: false, timestampSignerPresent: false },
    { status: "NotSigned", signerCertificatePresent: true, timestampSignerPresent: false },
    { status: "NotSigned", signerCertificatePresent: false, timestampSignerPresent: true },
  ]) {
    assert.throws(() => assertUnsignedAuthenticodeSignature(signature), /must be unsigned/);
  }
});

test("production evidence must reconcile with the same final bytes", async (t) => {
  const fixture = createFixture(t);
  await writeEvidence(fixture, { installerSha256: "0".repeat(64) });
  await assert.rejects(
    finalizeReleaseArtifact({ workspaceRoot: fixture.root, verifyAuthenticode: false }),
    /production evidence installer SHA-256 does not match/,
  );
});
