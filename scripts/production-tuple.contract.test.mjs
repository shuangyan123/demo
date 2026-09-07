import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const read = (relativePath) => readFileSync(resolve(workspaceRoot, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
const require = createRequire(import.meta.url);
const nsisConfig = require(resolve(workspaceRoot, "electron-builder.nsis.cjs"));
const metadataSource = read("app/config/app-metadata.ts");
const electronArchivePreparationSource = read("scripts/prepare-electron-archive.mjs");
const nsisEvidenceSource = read("scripts/electron-builder-nsis-evidence.mjs");
const electronRuntimeReaderSource = read("scripts/read-electron-runtime-version.mjs");
const nsisConfigSource = read("electron-builder.nsis.cjs");
const releaseArtifactSource = read("scripts/release-artifact-provenance.mjs");
const authenticodeReaderSource = read("scripts/read-windows-authenticode-signature.ps1");
const releaseGuardSource = read("scripts/verify-desktop-release-provenance.mjs");
const workflowSource = read(".github/workflows/trusted-desktop-release.yml");
const ciSource = read(".github/workflows/ci.yml");

const frozenProductionTuple = Object.freeze({
  version: "0.3.1",
  expectedTag: "v0.3.1",
  installerFilename: "ReviewWorkspace-0.3.1-Windows-x64-Setup.exe",
  channel: "stable",
  platform: "Windows",
  architecture: "x64",
  installerTechnology: "nsis",
  electron: "43.4.1",
  embeddedNode: "24.18.1",
  bundledNode: "24.20.0",
  electronBuilder: "26.16.0",
  appId: "com.squirrel.review_workspace.review-workspace",
  productName: "错题复盘",
  executable: "review-workspace",
  cscIdentityAutoDiscovery: "false",
  authenticode: "NotSigned",
  signerPresent: false,
  timestampSignerPresent: false,
  publish: null,
  updater: "NO AUTO-UPDATER",
  latestYmlPresent: false,
  blockmapPresent: false,
  strictlyRequireAllFuses: true,
  fuses: Object.freeze({
    RunAsNode: false,
    EnableCookieEncryption: true,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: true,
    OnlyLoadAppFromAsar: true,
    LoadBrowserProcessSpecificV8Snapshot: false,
    GrantFileProtocolExtraPrivileges: false,
    WasmTrapHandlers: true,
  }),
});

test("0.3.1 is the frozen static production tuple", () => {
  assert.equal(packageJson.version, frozenProductionTuple.version);
  assert.equal(frozenProductionTuple.expectedTag, `v${packageJson.version}`);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);

  const fallback = metadataSource.match(/process\.env\.npm_package_version\s*\?\?\s*["']([^"']+)["']/)?.[1];
  assert.equal(fallback, packageJson.version);

  assert.equal(packageJson.devDependencies.electron, frozenProductionTuple.electron);
  assert.equal(packageJson.devDependencies["electron-builder"], frozenProductionTuple.electronBuilder);
  assert.equal(nsisConfig.electronVersion, packageJson.devDependencies.electron);
  assert.equal(nsisConfig.appId, frozenProductionTuple.appId);
  assert.equal(nsisConfig.productName, frozenProductionTuple.productName);
  assert.equal(nsisConfig.executableName, frozenProductionTuple.executable);
  assert.deepEqual(nsisConfig.win.target, [{
    target: frozenProductionTuple.installerTechnology,
    arch: [frozenProductionTuple.architecture],
  }]);
  assert.equal(nsisConfig.publish, frozenProductionTuple.publish);
  assert.equal(nsisConfig.nsis.oneClick, false);
  assert.equal(nsisConfig.nsis.perMachine, false);
  assert.equal(nsisConfig.nsis.selectPerMachineByDefault, false);
  assert.equal(nsisConfig.nsis.runAfterFinish, false);
  assert.equal(nsisConfig.nsis.differentialPackage, false);
  assert.equal(nsisConfig.win.signExecutable, false);
  assert.equal(
    nsisConfig.artifactName
      .replace("$" + "{version}", frozenProductionTuple.version)
      .replace("$" + "{ext}", "exe"),
    frozenProductionTuple.installerFilename,
  );

  assert.match(nsisEvidenceSource, /channel:\s*"stable"/);
  assert.match(nsisEvidenceSource, /platform:\s*"Windows"/);
  assert.match(nsisEvidenceSource, /target:\s*"nsis"/);
  assert.match(nsisEvidenceSource, /architecture:\s*"x64"/);
  assert.match(nsisEvidenceSource, /embeddedNodeVersion,\s*"24\.18\.1"/);
  assert.match(nsisEvidenceSource, /manifest\.nodeVersion,\s*"24\.20\.0"/);
  assert.match(nsisEvidenceSource, /executablePath:\s*relativePath\(electronRuntime\.executablePath\)/);

  assert.match(workflowSource, new RegExp("CSC_IDENTITY_AUTO_DISCOVERY:\\s*\\\"" + frozenProductionTuple.cscIdentityAutoDiscovery + "\\\""));
  assert.match(nsisEvidenceSource, new RegExp("CSC_IDENTITY_AUTO_DISCOVERY,\\s*\\\"" + frozenProductionTuple.cscIdentityAutoDiscovery + "\\\""));
  assert.match(authenticodeReaderSource, /status\s*=\s*\[string\]\$signature\.Status/);
  assert.match(authenticodeReaderSource, /signerCertificatePresent\s*=\s*\$null\s*-ne\s*\$signature\.SignerCertificate/);
  assert.match(authenticodeReaderSource, /timestampSignerPresent\s*=\s*\$null\s*-ne\s*\$signature\.TimeStamperCertificate/);
  assert.match(releaseArtifactSource, /signature\.status\s*!==\s*"NotSigned"/);
  assert.match(releaseArtifactSource, /signature\.signerCertificatePresent\s*!==\s*false/);
  assert.match(releaseArtifactSource, /signature\.timestampSignerPresent\s*!==\s*false/);

  assert.match(nsisEvidenceSource, /updater:\s*"NO AUTO-UPDATER"/);
  assert.match(nsisEvidenceSource, /blockmapPresent:\s*outputFiles\.some/);
  assert.match(nsisEvidenceSource, /latestYmlPresent:\s*outputFiles\.some/);
  assert.doesNotMatch(nsisConfigSource, /electron-updater|autoUpdater|latest\.yml|\.blockmap/);

  assert.match(nsisConfigSource, /strictlyRequireAllFuses:\s*true/);
  for (const [name, expected] of Object.entries(frozenProductionTuple.fuses)) {
    assert.match(nsisConfigSource, new RegExp("\\[FuseV1Options\\." + name + "\\]:\\s*" + expected));
  }
  assert.equal(frozenProductionTuple.channel, "stable");
  assert.equal(frozenProductionTuple.platform, "Windows");
  assert.equal(frozenProductionTuple.embeddedNode, "24.18.1");
  assert.equal(frozenProductionTuple.bundledNode, "24.20.0");
  assert.equal(frozenProductionTuple.authenticode, "NotSigned");
  assert.equal(frozenProductionTuple.signerPresent, false);
  assert.equal(frozenProductionTuple.timestampSignerPresent, false);
  assert.equal(frozenProductionTuple.updater, "NO AUTO-UPDATER");
  assert.equal(frozenProductionTuple.latestYmlPresent, false);
  assert.equal(frozenProductionTuple.blockmapPresent, false);
  assert.equal(frozenProductionTuple.strictlyRequireAllFuses, true);
  assert.equal(nsisConfig.artifactName, "ReviewWorkspace-${version}-Windows-x64-Setup.${ext}");
});

test("production evidence reads Electron embedded Node at runtime", () => {
  assert.match(electronRuntimeReaderSource, /process\.versions\.node/);
  assert.match(electronRuntimeReaderSource, /app\.whenReady\(\)/);
  assert.doesNotMatch(electronRuntimeReaderSource, /ELECTRON_RUN_AS_NODE\s*=/);
  assert.match(nsisEvidenceSource, /readElectronRuntimeVersions/);
  assert.match(nsisEvidenceSource, /embeddedNodeVersion/);
  assert.match(nsisEvidenceSource, /electronRuntime/);
});

test("production archive preparation keeps the verified executable for runtime readback", () => {
  assert.match(electronArchivePreparationSource, /tar\.exe/);
  assert.match(electronArchivePreparationSource, /electronExecutablePath/);
  assert.match(electronArchivePreparationSource, /Electron runtime executable missing after extraction/);
});

test("production provenance preserves dynamic trusted main SHA and package-derived tag", () => {
  assert.match(nsisEvidenceSource, /const sourceCommit = resolveSourceCommit\(\)/);
  assert.match(nsisEvidenceSource, /expectedTag: `v\$\{packageJson\.version\}`/);
  assert.match(releaseGuardSource, /const releaseTag = `v\$\{packageJson\.version\}`/);
  assert.match(workflowSource, /NSIS_SOURCE_COMMIT: \$\{\{ needs\.authorize-release\.outputs\.release_sha \}\}/);
  assert.match(workflowSource, /ReviewWorkspace-\$\{\{ needs\.authorize-release\.outputs\.package_version \}\}-Windows-x64-Setup\.exe/);
  assert.match(ciSource, /ReviewWorkspace-0\.3\.1-Windows-x64-Setup\.exe/);
  assert.doesNotMatch(`${nsisEvidenceSource}\n${releaseGuardSource}\n${workflowSource}`, /a79bd8934b1f25ac3328222d6d0c284eb6363984/);
});
