import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authenticodeHelperPath = path.join(
  workspaceRoot,
  "scripts",
  "read-windows-authenticode-signature.ps1",
);

export const RELEASE_MANIFEST_FILENAME = "SHA256SUMS.txt";

export function canonicalInstallerFilename(version) {
  if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version)) {
    throw new Error(`Package version is not safe for the canonical installer filename: ${String(version)}`);
  }

  return `ReviewWorkspace-${version}-Windows-x64-Setup.exe`;
}

export function getReleaseArtifactPaths({ workspaceRoot: root = workspaceRoot, version } = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const packageVersion = version ?? packageJson.version;
  const installerFilename = canonicalInstallerFilename(packageVersion);
  const sourceDirectory = path.join(root, "out", "builder-nsis");
  const releaseDirectory = path.join(root, "out", "release");

  return {
    workspaceRoot: root,
    packageVersion,
    sourceDirectory,
    sourceInstallerPath: path.join(sourceDirectory, installerFilename),
    releaseDirectory,
    stagedInstallerPath: path.join(releaseDirectory, installerFilename),
    manifestPath: path.join(releaseDirectory, RELEASE_MANIFEST_FILENAME),
    productionEvidencePath: path.join(sourceDirectory, "production-evidence.json"),
    installerFilename,
  };
}

export function normalizeSha256(value, label = "SHA-256") {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be exactly 64 hexadecimal characters`);
  }

  return value.toLowerCase();
}

export function formatSha256Manifest(hash, installerFilename) {
  const normalizedHash = normalizeSha256(hash, "manifest SHA-256");
  assertBareFilename(installerFilename, "manifest installer filename");
  return `${normalizedHash}  ${installerFilename}\n`;
}

export function parseSha256Manifest(contents, expectedInstallerFilename) {
  if (typeof contents !== "string") {
    throw new Error("SHA256SUMS.txt must be UTF-8 text");
  }

  let line = contents.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (line.endsWith("\n")) line = line.slice(0, -1);
  if (line.includes("\n")) {
    throw new Error("SHA256SUMS.txt must contain exactly one checksum entry");
  }

  const match = /^(?<hash>[0-9a-f]{64}) {2}(?<filename>[^\s]+)$/.exec(line);
  if (!match?.groups) {
    throw new Error("SHA256SUMS.txt has invalid canonical syntax");
  }

  const { hash, filename } = match.groups;
  assertBareFilename(filename, "manifest installer filename");
  if (expectedInstallerFilename !== undefined && filename !== expectedInstallerFilename) {
    throw new Error(
      `SHA256SUMS.txt names ${JSON.stringify(filename)} instead of ${JSON.stringify(expectedInstallerFilename)}`,
    );
  }

  return { hash, filename };
}

export function assertMatchingInstallerHashes(sourceHash, stagedHash) {
  const normalizedSourceHash = normalizeSha256(sourceHash, "source installer SHA-256");
  const normalizedStagedHash = normalizeSha256(stagedHash, "staged installer SHA-256");
  if (normalizedSourceHash !== normalizedStagedHash) {
    throw new Error(
      `Source installer SHA-256 ${normalizedSourceHash} does not match staged installer SHA-256 ${normalizedStagedHash}`,
    );
  }
}

export function assertUnsignedAuthenticodeSignature(signature) {
  if (
    !signature
    || signature.status !== "NotSigned"
    || signature.signerCertificatePresent !== false
    || signature.timestampSignerPresent !== false
  ) {
    throw new Error(
      `Production-v1 installer must be unsigned: ${JSON.stringify(signature)}`,
    );
  }
}

export function readWindowsAuthenticodeSignature(
  installerPath,
  { helperPath = authenticodeHelperPath } = {},
) {
  if (process.platform !== "win32") {
    throw new Error("Production-v1 Authenticode verification requires a Windows runner");
  }

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath,
    "-LiteralPath",
    installerPath,
  ];
  let output;
  let lastMissingHostError;
  for (const host of ["pwsh.exe", "powershell.exe"]) {
    try {
      output = execFileSync(host, args, {
        cwd: workspaceRoot,
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      break;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        lastMissingHostError = error;
        continue;
      }
      throw error;
    }
  }
  if (output === undefined) {
    throw lastMissingHostError ?? new Error("No supported PowerShell host was found");
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Windows Authenticode helper returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function verifyReleaseArtifact({
  workspaceRoot: root = workspaceRoot,
  expectedVersion,
  releaseDirectory,
} = {}) {
  const paths = getReleaseArtifactPaths({ workspaceRoot: root, version: expectedVersion });
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (expectedVersion !== undefined && packageJson.version !== expectedVersion) {
    throw new Error(
      `Checked-out package version ${packageJson.version} does not match authorized version ${expectedVersion}`,
    );
  }

  const resolvedReleaseDirectory = releaseDirectory ?? paths.releaseDirectory;
  const resolvedInstallerPath = path.join(resolvedReleaseDirectory, paths.installerFilename);
  const resolvedManifestPath = path.join(resolvedReleaseDirectory, RELEASE_MANIFEST_FILENAME);
  await assertExactReleaseDirectory(resolvedReleaseDirectory, paths.installerFilename);
  await requireRegularFile(resolvedInstallerPath, "staged release installer");
  const installerInfo = await stat(resolvedInstallerPath);
  if (installerInfo.size <= 0) throw new Error("Staged release installer must be non-empty");

  const installerSha256 = await sha256File(resolvedInstallerPath);
  const manifest = parseSha256Manifest(
    await readFile(resolvedManifestPath, "utf8"),
    paths.installerFilename,
  );
  if (manifest.hash !== installerSha256) {
    throw new Error(
      `SHA256SUMS.txt records ${manifest.hash}, but staged installer hashes to ${installerSha256}`,
    );
  }

  return {
    packageVersion: paths.packageVersion,
    installerFilename: paths.installerFilename,
    installerByteSize: installerInfo.size,
    installerSha256,
    manifestSha256: manifest.hash,
    releaseFiles: [paths.installerFilename, RELEASE_MANIFEST_FILENAME],
    releaseDirectory: resolvedReleaseDirectory,
  };
}

export async function finalizeReleaseArtifact({
  workspaceRoot: root = workspaceRoot,
  expectedVersion,
  sourceInstallerPath,
  releaseDirectory,
  productionEvidencePath,
  copyFileImplementation = copyFile,
  verifyAuthenticode = true,
  authenticodeReader = readWindowsAuthenticodeSignature,
} = {}) {
  const paths = getReleaseArtifactPaths({ workspaceRoot: root, version: expectedVersion });
  const sourcePath = sourceInstallerPath ?? paths.sourceInstallerPath;
  const resolvedReleaseDirectory = releaseDirectory ?? paths.releaseDirectory;
  const stagedPath = path.join(resolvedReleaseDirectory, paths.installerFilename);
  const evidencePath = productionEvidencePath ?? paths.productionEvidencePath;

  await requireRegularFile(sourcePath, "canonical NSIS source installer");
  assertTaskOwnedReleaseDirectory(root, resolvedReleaseDirectory);
  await rm(resolvedReleaseDirectory, { force: true, recursive: true });
  await mkdir(resolvedReleaseDirectory, { recursive: true });

  const sourceHashBeforeCopy = await sha256File(sourcePath);
  await copyFileImplementation(sourcePath, stagedPath);
  const sourceHashAfterCopy = await sha256File(sourcePath);
  const stagedHash = await sha256File(stagedPath);
  assertMatchingInstallerHashes(sourceHashBeforeCopy, sourceHashAfterCopy);
  assertMatchingInstallerHashes(sourceHashAfterCopy, stagedHash);

  const stagedByteSize = (await stat(stagedPath)).size;
  await reconcileProductionEvidence({
    evidencePath,
    expectedPackageVersion: paths.packageVersion,
    expectedInstallerFilename: paths.installerFilename,
    sourceHash: sourceHashAfterCopy,
    stagedByteSize,
  });

  await writeFile(
    path.join(resolvedReleaseDirectory, RELEASE_MANIFEST_FILENAME),
    formatSha256Manifest(stagedHash, paths.installerFilename),
    "utf8",
  );

  const verified = await verifyReleaseArtifact({
    workspaceRoot: root,
    expectedVersion: paths.packageVersion,
    releaseDirectory: resolvedReleaseDirectory,
  });

  let authenticode = null;
  if (verifyAuthenticode) {
    authenticode = await authenticodeReader(stagedPath);
    assertUnsignedAuthenticodeSignature(authenticode);
  }

  return {
    ...verified,
    sourceInstallerPath: sourcePath,
    sourceByteSize: (await stat(sourcePath)).size,
    sourceSha256: sourceHashAfterCopy,
    stagedSha256: stagedHash,
    sourceEqualsStaged: true,
    authenticode,
    authenticodeUnsigned: verifyAuthenticode,
    productionEvidenceReconciled: true,
  };
}

async function reconcileProductionEvidence({
  evidencePath,
  expectedPackageVersion,
  expectedInstallerFilename,
  sourceHash,
  stagedByteSize,
}) {
  await requireRegularFile(evidencePath, "NSIS production evidence");
  let evidence;
  try {
    evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    throw new Error(
      `NSIS production evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (evidence.packageVersion !== expectedPackageVersion) {
    throw new Error("NSIS production evidence package version does not match final staging");
  }
  if (evidence.expectedTag !== `v${expectedPackageVersion}`) {
    throw new Error("NSIS production evidence expected tag does not match package version");
  }
  if (typeof evidence.sourceCommit !== "string" || !/^[0-9a-f]{40}$/i.test(evidence.sourceCommit)) {
    throw new Error("NSIS production evidence source commit must be a full Git SHA");
  }
  if (evidence.installerFilename !== expectedInstallerFilename) {
    throw new Error("NSIS production evidence installer filename does not match final staging");
  }
  if (normalizeSha256(evidence.installerSha256, "NSIS production evidence installer SHA-256") !== sourceHash) {
    throw new Error("NSIS production evidence installer SHA-256 does not match the source installer");
  }
  if (evidence.installerByteSize !== stagedByteSize) {
    throw new Error("NSIS production evidence installer byte size does not match final staging");
  }
}

export async function assertExactReleaseDirectory(releaseDirectory, expectedInstallerFilename) {
  let entries;
  try {
    entries = await readdir(releaseDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Release staging directory is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const expected = [RELEASE_MANIFEST_FILENAME, expectedInstallerFilename].sort();
  const actual = entries.map((entry) => entry.name).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error(
      `Release staging directory must contain exactly ${expected.join(" and ")}; found ${actual.join(", ") || "nothing"}`,
    );
  }
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Release staging directory must not contain directories");
  }
}

export function assertBareFilename(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || /[\\/\s]/.test(value)
    || value === "."
    || value === ".."
  ) {
    throw new Error(`${label} must be a single filename without path components`);
  }
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function requireRegularFile(filePath, label) {
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch (error) {
    throw new Error(
      `${label} is missing: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!fileInfo.isFile()) throw new Error(`${label} is not a regular file: ${filePath}`);
}

function assertTaskOwnedReleaseDirectory(root, releaseDirectory) {
  const expected = path.resolve(root, "out", "release");
  const actual = path.resolve(releaseDirectory);
  if (actual !== expected) {
    throw new Error(`Release finalization is restricted to the task-owned staging directory: ${expected}`);
  }
}
