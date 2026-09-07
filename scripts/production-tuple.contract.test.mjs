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
const releaseGuardSource = read("scripts/verify-desktop-release-provenance.mjs");
const workflowSource = read(".github/workflows/trusted-desktop-release.yml");
const ciSource = read(".github/workflows/ci.yml");

test("M5-G recovery candidate keeps the current production package and installer tuple", () => {
  assert.equal(packageJson.version, "0.3.1");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);

  const fallback = metadataSource.match(/process\.env\.npm_package_version\s*\?\?\s*["']([^"']+)["']/)?.[1];
  assert.equal(fallback, packageJson.version);

  assert.equal(packageJson.devDependencies.electron, "43.4.1");
  assert.equal(packageJson.devDependencies["electron-builder"], "26.16.0");
  assert.equal(nsisConfig.electronVersion, packageJson.devDependencies.electron);
  assert.equal(nsisConfig.appId, "com.squirrel.review_workspace.review-workspace");
  assert.equal(nsisConfig.productName, "错题复盘");
  assert.equal(nsisConfig.executableName, "review-workspace");
  assert.deepEqual(nsisConfig.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(nsisConfig.publish, null);
  assert.equal(nsisConfig.nsis.oneClick, false);
  assert.equal(nsisConfig.nsis.perMachine, false);
  assert.equal(nsisConfig.nsis.selectPerMachineByDefault, false);
  assert.equal(nsisConfig.nsis.runAfterFinish, false);
  assert.equal(nsisConfig.nsis.differentialPackage, false);
  assert.equal(nsisConfig.win.signExecutable, false);
  assert.equal(nsisConfig.artifactName, "ReviewWorkspace-${version}-Windows-x64-Setup.${ext}");
});

test("M5-F production evidence reads Electron embedded Node at runtime", () => {
  assert.match(electronRuntimeReaderSource, /process\.versions\.node/);
  assert.match(electronRuntimeReaderSource, /app\.whenReady\(\)/);
  assert.doesNotMatch(electronRuntimeReaderSource, /ELECTRON_RUN_AS_NODE\s*=/);
  assert.match(nsisEvidenceSource, /readElectronRuntimeVersions/);
  assert.match(nsisEvidenceSource, /embeddedNodeVersion/);
  assert.match(nsisEvidenceSource, /electronRuntime/);
});

test("M5-F prepares the verified Electron archive executable for runtime readback", () => {
  assert.match(electronArchivePreparationSource, /tar\.exe/);
  assert.match(electronArchivePreparationSource, /electronExecutablePath/);
  assert.match(electronArchivePreparationSource, /Electron runtime executable missing after extraction/);
});

test("M5-F preserves dynamic trusted main SHA and package-derived tag provenance", () => {
  assert.match(nsisEvidenceSource, /const sourceCommit = resolveSourceCommit\(\)/);
  assert.match(nsisEvidenceSource, /expectedTag: `v\$\{packageJson\.version\}`/);
  assert.match(releaseGuardSource, /const releaseTag = `v\$\{packageJson\.version\}`/);
  assert.match(workflowSource, /NSIS_SOURCE_COMMIT: \$\{\{ needs\.authorize-release\.outputs\.release_sha \}\}/);
  assert.match(workflowSource, /ReviewWorkspace-\$\{\{ needs\.authorize-release\.outputs\.package_version \}\}-Windows-x64-Setup\.exe/);
  assert.match(ciSource, /ReviewWorkspace-0\.3\.1-Windows-x64-Setup\.exe/);
  assert.doesNotMatch(`${nsisEvidenceSource}\n${releaseGuardSource}\n${workflowSource}`, /a79bd8934b1f25ac3328222d6d0c284eb6363984/);
});
