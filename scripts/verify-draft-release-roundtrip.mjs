import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import {
  RELEASE_MANIFEST_FILENAME,
  canonicalInstallerFilename,
  verifyReleaseArtifact,
} from "./release-artifact-provenance.mjs";
const ROUND_TRIP_COMPARISON_FIELDS = [
  "packageVersion",
  "installerFilename",
  "installerByteSize",
  "installerSha256",
  "manifestSha256",
  "releaseFiles",
];

function expectedActionsArtifactName(releaseSha) {
  return `review-workspace-windows-x64-${releaseSha}`;
}

function requireValue(name, value) {
  if (!value) throw new Error(`Missing required release input: ${name}`);
  return value;
}

function assertFullSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`${label} must be a full Git SHA`);
  }
  return value.toLowerCase();
}

function assertRepositoryName(value) {
  if (typeof value !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(value)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/name repository identifier");
  }
  return value;
}

function assertSafeOutputPath(workspaceRoot, directory, label) {
  const outputRoot = path.resolve(workspaceRoot, "out");
  const resolved = path.resolve(directory);
  const relative = path.relative(outputRoot, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a child path of ${outputRoot}`);
  }
  return resolved;
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => value === right[index]);
  }
  return Object.is(left, right);
}

export function expectedReleaseAssetNames(version, installerFilename) {
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Package version is required to derive expected Release assets");
  }
  const expectedInstallerFilename = installerFilename
    ?? canonicalInstallerFilename(version);
  return [expectedInstallerFilename, RELEASE_MANIFEST_FILENAME].sort();
}

export function assertMatchingReleaseArtifacts(canonical, roundTrip) {
  for (const field of ROUND_TRIP_COMPARISON_FIELDS) {
    if (!valuesEqual(canonical?.[field], roundTrip?.[field])) {
      throw new Error(`Canonical and Draft release ${field} differ`);
    }
  }

  if (canonical.installerSha256 !== roundTrip.installerSha256) {
    throw new Error("Canonical installer SHA-256 does not match Draft-downloaded installer SHA-256");
  }

  return true;
}

export async function verifyDraftReleaseRoundTrip({
  workspaceRoot = process.cwd(),
  expectedVersion,
  canonicalDirectory,
  roundTripDirectory,
} = {}) {
  const resolvedCanonicalDirectory = assertSafeOutputPath(
    workspaceRoot,
    requireValue("RELEASE_CANONICAL_DIRECTORY", canonicalDirectory),
    "Canonical release directory",
  );
  const resolvedRoundTripDirectory = assertSafeOutputPath(
    workspaceRoot,
    requireValue("RELEASE_ROUND_TRIP_DIRECTORY", roundTripDirectory),
    "Draft round-trip directory",
  );
  if (resolvedCanonicalDirectory === resolvedRoundTripDirectory) {
    throw new Error("Canonical and Draft round-trip directories must be distinct");
  }

  const canonical = await verifyReleaseArtifact({
    workspaceRoot,
    expectedVersion,
    releaseDirectory: resolvedCanonicalDirectory,
  });
  const roundTrip = await verifyReleaseArtifact({
    workspaceRoot,
    expectedVersion,
    releaseDirectory: resolvedRoundTripDirectory,
  });
  assertMatchingReleaseArtifacts(canonical, roundTrip);

  return {
    canonical,
    roundTrip,
    canonicalEqualsRoundTrip: true,
  };
}

export function assertDraftReleaseMetadata(
  release,
  { expectedTag, expectedReleaseSha, expectedAssetNames } = {},
) {
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    throw new Error("GitHub Release metadata must be an object");
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new Error("GitHub Draft Release metadata must contain a valid release identity");
  }
  if (typeof expectedTag !== "string" || expectedTag.length === 0) {
    throw new Error("Expected Draft Release tag is required");
  }
  if (!Array.isArray(expectedAssetNames) || expectedAssetNames.length === 0) {
    throw new Error("Expected Draft Release asset names are required");
  }
  if (release.tag_name !== expectedTag) {
    throw new Error(
      `GitHub Release tag ${JSON.stringify(release.tag_name)} does not match ${JSON.stringify(expectedTag)}`,
    );
  }
  if (expectedReleaseSha !== undefined) assertFullSha(expectedReleaseSha, "expectedReleaseSha");
  if (release.draft !== true) {
    throw new Error("GitHub Release must remain a Draft during M5-G");
  }
  if (release.prerelease !== false) {
    throw new Error("GitHub Release must not be a prerelease during M5-G");
  }
  if (release.published_at !== null && release.published_at !== undefined) {
    throw new Error("GitHub Release must not be published during M5-G");
  }

  const actualAssets = release.assets;
  if (!Array.isArray(actualAssets)) {
    throw new Error("GitHub Release metadata must contain an assets array");
  }
  const expectedNames = [...expectedAssetNames].sort();
  const actualNames = actualAssets.map((asset) => asset?.name).sort();
  if (
    actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(
      `GitHub Draft Release must contain exactly ${expectedNames.join(" and ")}; found ${actualNames.join(", ") || "nothing"}`,
    );
  }
  if (new Set(actualNames).size !== actualNames.length) {
    throw new Error("GitHub Draft Release must not contain duplicate asset names");
  }

  const assets = actualAssets.map((asset) => {
    if (!Number.isSafeInteger(asset?.id) || asset.id <= 0) {
      throw new Error(`GitHub Release asset ${JSON.stringify(asset?.name)} must contain a valid asset identity`);
    }
    if (typeof asset.name !== "string" || asset.name.length === 0) {
      throw new Error("GitHub Release assets must have names");
    }
    return {
      id: asset.id,
      name: asset.name,
      size: Number.isSafeInteger(asset.size) && asset.size >= 0 ? asset.size : null,
    };
  });

  return {
    releaseId: release.id,
    tagName: release.tag_name,
    isDraft: release.draft,
    isPrerelease: release.prerelease,
    publishedAt: release.published_at ?? null,
    url: typeof release.html_url === "string" ? release.html_url : null,
    assets,
    expectedReleaseSha,
  };
}

export function buildRoundTripEvidence({
  packageVersion,
  expectedTag,
  releaseSha,
  tagCommit,
  releaseMetadata,
  canonical,
  roundTrip,
  actionsArtifactName,
} = {}) {
  const normalizedReleaseSha = assertFullSha(releaseSha, "releaseSha");
  const normalizedTagCommit = assertFullSha(tagCommit, "tagCommit");
  if (typeof packageVersion !== "string" || packageVersion.length === 0) {
    throw new Error("packageVersion is required for Draft Release evidence");
  }
  if (canonical?.packageVersion !== packageVersion || roundTrip?.packageVersion !== packageVersion) {
    throw new Error("Draft Release evidence package version does not match both verified artifact directories");
  }
  if (expectedTag !== `v${packageVersion}`) {
    throw new Error("Draft Release evidence tag does not match the package version");
  }
  if (normalizedTagCommit !== normalizedReleaseSha) {
    throw new Error("tag commit does not match the authorized release SHA");
  }
  if (releaseMetadata?.tagName !== expectedTag || releaseMetadata?.isDraft !== true) {
    throw new Error("Draft Release evidence does not match the authorized tag and Draft state");
  }
  assertMatchingReleaseArtifacts(canonical, roundTrip);

  const normalizedActionsArtifactName = actionsArtifactName
    ?? expectedActionsArtifactName(normalizedReleaseSha);
  if (normalizedActionsArtifactName !== expectedActionsArtifactName(normalizedReleaseSha)) {
    throw new Error("Actions artifact identity does not match the authorized release SHA");
  }

  const installerAsset = releaseMetadata.assets.find((asset) => asset.name === canonical.installerFilename);
  const manifestAsset = releaseMetadata.assets.find((asset) => asset.name === RELEASE_MANIFEST_FILENAME);
  return {
    schemaVersion: 1,
    packageVersion,
    expectedTag,
    releaseSha: normalizedReleaseSha,
    tagCommit: normalizedTagCommit,
    productionEvidenceSourceCommit: normalizedReleaseSha,
    actionsArtifactName: normalizedActionsArtifactName,
    actionsArtifactReleaseSha: normalizedReleaseSha,
    draftReleaseId: releaseMetadata.releaseId,
    draftReleaseTag: releaseMetadata.tagName,
    draftReleaseIsDraft: releaseMetadata.isDraft,
    draftReleaseIsPrerelease: releaseMetadata.isPrerelease,
    draftReleasePublishedAt: releaseMetadata.publishedAt,
    draftReleaseUrl: releaseMetadata.url,
    releaseAssets: releaseMetadata.assets,
    installerFilename: canonical.installerFilename,
    canonicalByteSize: canonical.installerByteSize,
    canonicalSha256: canonical.installerSha256,
    canonicalManifestSha256: canonical.manifestSha256,
    roundTripByteSize: roundTrip.installerByteSize,
    roundTripSha256: roundTrip.installerSha256,
    roundTripManifestSha256: roundTrip.manifestSha256,
    draftInstallerAssetId: installerAsset?.id ?? null,
    draftManifestAssetId: manifestAsset?.id ?? null,
    releaseFiles: canonical.releaseFiles,
    canonicalEqualsRoundTrip: true,
    tagEqualsReleaseSha: true,
    exactAssetBoundary: true,
    pass: true,
  };
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || `git exited with status ${result.status}`;
    throw new Error(`Git command failed: ${detail}`);
  }
  return result.stdout.trim();
}

function resolveTagCommit(workspaceRoot, tag) {
  return assertFullSha(
    runGit(workspaceRoot, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]),
    `refs/tags/${tag}^{commit}`,
  );
}

function runGhApiJson(repository, endpoint) {
  const result = spawnSync("gh", ["api", `repos/${repository}/${endpoint}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status === 0) {
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `GitHub API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const detail = result.stderr?.trim() || result.error?.message || `gh exited with status ${result.status}`;
  if (result.status === 1 && /\b404\b|not found/i.test(detail)) return null;
  throw new Error(`GitHub API request failed for ${endpoint}: ${detail}`);
}

function runGhReleaseCreate({ repository, tag, installerPath, manifestPath, notes }) {
  const result = spawnSync(
    "gh",
    [
      "release",
      "create",
      "--repo",
      repository,
      tag,
      "--draft",
      "--verify-tag",
      "--title",
      `错题复盘 ${tag}`,
      "--notes",
      notes,
      installerPath,
      manifestPath,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || `gh exited with status ${result.status}`;
    throw new Error(`GitHub Draft Release creation failed: ${detail}`);
  }
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function downloadReleaseAsset({ repository, asset, destination }) {
  const child = spawn(
    "gh",
    [
      "api",
      "--header",
      "Accept: application/octet-stream",
      `repos/${repository}/releases/assets/${asset.id}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    const [processResult] = await Promise.all([
      pipeline(child.stdout, createWriteStream(destination, { flags: "wx" })),
      waitForProcess(child),
    ]);
    if (processResult.code !== 0) {
      throw new Error(
        `GitHub Release asset download failed for ${asset.name}: ${stderr.trim() || `exit status ${processResult.code}`}`,
      );
    }
  } catch (error) {
    child.kill();
    await rm(destination, { force: true });
    throw error;
  }

  const fileInfo = await stat(destination);
  if (!fileInfo.isFile()) throw new Error(`Downloaded Release asset is not a regular file: ${asset.name}`);
}

async function resetDirectory(workspaceRoot, directory) {
  const resolved = assertSafeOutputPath(workspaceRoot, directory, "Draft round-trip directory");
  await rm(resolved, { force: true, recursive: true });
  await mkdir(resolved, { recursive: true });
  return resolved;
}

function releaseNotes({ packageVersion, tag, releaseSha, installerFilename, installerSha256 }) {
  return [
    "Windows x64 production-v1 Draft Release; publication is not authorized by this workflow.",
    "",
    `Version: ${packageVersion}`,
    `Tag: ${tag}`,
    `Exact source SHA: ${releaseSha}`,
    "Architecture: Windows x64",
    `Installer: ${installerFilename}`,
    `Installer SHA-256: ${installerSha256}`,
    "Unsigned status: intentionally unsigned; Windows may show Unknown Publisher or SmartScreen warnings.",
    "Updater: NO AUTO-UPDATER",
    "M5-H Level 3 acceptance, M5-I runbook completion, and M5-J publication are not claimed.",
  ].join("\n");
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function run() {
  const workspaceRoot = path.resolve(process.env.RELEASE_WORKSPACE_ROOT ?? process.cwd());
  const expectedVersion = requireValue(
    "RELEASE_EXPECTED_PACKAGE_VERSION",
    process.env.RELEASE_EXPECTED_PACKAGE_VERSION,
  );
  const expectedTag = requireValue("RELEASE_EXPECTED_TAG", process.env.RELEASE_EXPECTED_TAG);
  const releaseSha = assertFullSha(requireValue("RELEASE_SHA", process.env.RELEASE_SHA), "RELEASE_SHA");
  const repository = assertRepositoryName(requireValue("GITHUB_REPOSITORY", process.env.GITHUB_REPOSITORY));
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required for Draft Release operations");
  }

  const canonicalDirectory = assertSafeOutputPath(
    workspaceRoot,
    path.resolve(
      workspaceRoot,
      requireValue("RELEASE_CANONICAL_DIRECTORY", process.env.RELEASE_CANONICAL_DIRECTORY),
    ),
    "Canonical release directory",
  );
  const roundTripDirectory = assertSafeOutputPath(
    workspaceRoot,
    path.resolve(
      workspaceRoot,
      requireValue("RELEASE_ROUND_TRIP_DIRECTORY", process.env.RELEASE_ROUND_TRIP_DIRECTORY),
    ),
    "Draft round-trip directory",
  );
  if (canonicalDirectory === roundTripDirectory) {
    throw new Error("Canonical and Draft round-trip directories must be distinct");
  }
  const evidencePath = assertSafeOutputPath(
    workspaceRoot,
    path.resolve(
      workspaceRoot,
      requireValue("RELEASE_EVIDENCE_PATH", process.env.RELEASE_EVIDENCE_PATH),
    ),
    "Release evidence path",
  );
  const actionsArtifactName = process.env.RELEASE_ACTIONS_ARTIFACT_NAME
    ?? expectedActionsArtifactName(releaseSha);
  if (actionsArtifactName !== expectedActionsArtifactName(releaseSha)) {
    throw new Error("RELEASE_ACTIONS_ARTIFACT_NAME must include the authorized release SHA");
  }
  const canonical = await verifyReleaseArtifact({
    workspaceRoot,
    expectedVersion,
    releaseDirectory: canonicalDirectory,
  });
  if (expectedTag !== `v${canonical.packageVersion}`) {
    throw new Error(`Expected Release tag ${expectedTag} does not match package version ${canonical.packageVersion}`);
  }

  const tagCommitBeforeRelease = resolveTagCommit(workspaceRoot, expectedTag);
  if (tagCommitBeforeRelease !== releaseSha) {
    throw new Error(`Tag ${expectedTag} resolves to ${tagCommitBeforeRelease}, not authorized SHA ${releaseSha}`);
  }

  const expectedAssetNames = expectedReleaseAssetNames(canonical.packageVersion, canonical.installerFilename);
  let release = runGhApiJson(repository, `releases/tags/${expectedTag}`);
  if (release) {
    assertDraftReleaseMetadata(release, {
      expectedTag,
      expectedReleaseSha: releaseSha,
      expectedAssetNames,
    });
    console.log(`Resuming existing Draft Release ${release.id}; no Release assets will be replaced.`);
  } else {
    runGhReleaseCreate({
      repository,
      tag: expectedTag,
      installerPath: path.join(canonicalDirectory, canonical.installerFilename),
      manifestPath: path.join(canonicalDirectory, RELEASE_MANIFEST_FILENAME),
      notes: releaseNotes({
        packageVersion: canonical.packageVersion,
        tag: expectedTag,
        releaseSha,
        installerFilename: canonical.installerFilename,
        installerSha256: canonical.installerSha256,
      }),
    });
    console.log(`Created Draft Release ${expectedTag}; publication remains disabled.`);
  }

  release = runGhApiJson(repository, `releases/tags/${expectedTag}`);
  if (!release) throw new Error(`Draft Release ${expectedTag} was not found after creation/readback`);
  const releaseMetadata = assertDraftReleaseMetadata(release, {
    expectedTag,
    expectedReleaseSha: releaseSha,
    expectedAssetNames,
  });
  const tagCommitBeforeDownload = resolveTagCommit(workspaceRoot, expectedTag);
  if (tagCommitBeforeDownload !== releaseSha) {
    throw new Error(`Tag ${expectedTag} changed to ${tagCommitBeforeDownload}; refusing to verify a different source SHA`);
  }

  const resolvedRoundTripDirectory = await resetDirectory(workspaceRoot, roundTripDirectory);
  for (const asset of releaseMetadata.assets) {
    await downloadReleaseAsset({
      repository,
      asset,
      destination: path.join(resolvedRoundTripDirectory, asset.name),
    });
  }

  const verified = await verifyDraftReleaseRoundTrip({
    workspaceRoot,
    expectedVersion: canonical.packageVersion,
    canonicalDirectory,
    roundTripDirectory: resolvedRoundTripDirectory,
  });
  const tagCommit = resolveTagCommit(workspaceRoot, expectedTag);
  if (tagCommit !== releaseSha) {
    throw new Error(`Tag ${expectedTag} changed to ${tagCommit}; refusing to record a different source SHA`);
  }
  const evidence = buildRoundTripEvidence({
    packageVersion: canonical.packageVersion,
    expectedTag,
    releaseSha,
    tagCommit,
    releaseMetadata,
    canonical: verified.canonical,
    roundTrip: verified.roundTrip,
    actionsArtifactName,
  });
  await writeJson(evidencePath, evidence);
  console.log(JSON.stringify(evidence, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : "Draft Release round-trip verification failed");
    process.exitCode = 1;
  });
}
