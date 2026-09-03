import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const require = createRequire(import.meta.url);
const expectedElectronBuilderVersion = "26.16.0";
const configPath = resolve(workspaceRoot, "electron-builder.nsis.cjs");
const configSource = readFileSync(configPath, "utf8");
const config = require(configPath);
const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(workspaceRoot, "package-lock.json"), "utf8"));
const appBuilderLibPackagePath = require.resolve("app-builder-lib/package.json");
const appBuilderLibPackage = JSON.parse(readFileSync(appBuilderLibPackagePath, "utf8"));
const allowOnlyOneInstallerInstanceTemplatePath = resolve(
  appBuilderLibPackagePath,
  "..",
  "templates",
  "nsis",
  "include",
  "allowOnlyOneInstallerInstance.nsh",
);
const allowOnlyOneInstallerInstanceTemplate = readFileSync(allowOnlyOneInstallerInstanceTemplatePath, "utf8");
const recallWindowsIconPath = resolve(workspaceRoot, "public", "brand", "recall", "app", "recall.ico");

test("M1 builder config is an opt-in bundled NSIS candidate path", () => {
  assert.equal(packageJson.name, "review-workspace");
  assert.equal(packageJson.productName, "错题复盘");
  assert.equal(packageJson.version, "0.2.4");
  assert.equal(packageJson.devDependencies["electron-builder"], expectedElectronBuilderVersion);
  assert.equal(packageLock.packages["node_modules/electron-builder"].version, expectedElectronBuilderVersion);

  assert.equal(config.appId, "com.squirrel.review_workspace.review-workspace");
  assert.equal(config.productName, "错题复盘");
  assert.equal(config.executableName, "review-workspace");
  assert.equal(config.electronVersion, "43.4.1");
  assert.equal(config.asar, true);
  assert.deepEqual(config.files, [".desktop/**/*"]);
  assert.equal(config.directories.app, resolve(workspaceRoot, ".desktop-app"));
  assert.equal(config.directories.output, resolve(workspaceRoot, "out", "builder-nsis"));
  assert.equal(config.electronDist, resolve(workspaceRoot, ".cache", "electron"));
  assert.deepEqual(config.extraResources, [{
    from: resolve(workspaceRoot, ".desktop-runtime"),
    to: ".desktop-runtime",
    filter: ["**/*"],
  }]);

  assert.deepEqual(config.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(config.publish, null);
  assert.equal(config.artifactName, "ReviewWorkspace-${version}-Windows-x64-NSIS-M1-Candidate.${ext}");
  assert.equal(config.win.signAndEditExecutable, true);
  assert.equal(config.win.signExecutable, false);
  assert.equal(config.win.icon, recallWindowsIconPath);
  assert.equal(existsSync(recallWindowsIconPath), true);

  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.selectPerMachineByDefault, false);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(config.nsis.differentialPackage, false);
  assert.equal(config.nsis.shortcutName, "错题复盘");
  assert.equal(config.nsis.uninstallDisplayName, "错题复盘");
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.installerIcon, recallWindowsIconPath);
  assert.equal(config.nsis.uninstallerIcon, recallWindowsIconPath);

  assert.match(packageJson.scripts["desktop:builder:nsis:unpacked"], /--projectDir \.desktop-app .*--config \.\.\\electron-builder\.nsis\.cjs/);
  assert.match(packageJson.scripts["desktop:builder:nsis:bundle"], /--projectDir \.desktop-app .*--config \.\.\\electron-builder\.nsis\.cjs/);
  assert.match(packageJson.scripts["desktop:builder:nsis"], /desktop:prepare/);
  assert.match(packageJson.scripts["generate:desktop:builder:nsis:evidence"], /generate-electron-builder-nsis-evidence/);
  assert.match(packageJson.scripts["test:desktop:builder:nsis:artifact"], /DESKTOP_BUILDER_NSIS_ARTIFACT_REQUIRED=1/);

  assert.doesNotMatch(configSource, /nsis-web|nsisWeb|appPackageUrl/);
  assert.doesNotMatch(configSource, /electron-updater|autoUpdater|latest\.yml|\.blockmap/);
  assert.doesNotMatch(configSource, /app\.setAppUserModelId/);
});

test("installed v26 NSIS template hardens every PowerShell process check", () => {
  assert.equal(appBuilderLibPackage.version, expectedElectronBuilderVersion);
  assert.match(allowOnlyOneInstallerInstanceTemplate, /!macro CHECK_APP_RUNNING/);
  assert.match(allowOnlyOneInstallerInstanceTemplate, /!macro FIND_PROCESS/);
  assert.match(allowOnlyOneInstallerInstanceTemplate, /!macro KILL_PROCESS/);

  const powershellInvocations = [
    ...allowOnlyOneInstallerInstanceTemplate.matchAll(/nsExec::Exec `"\$PowerShellPath"[\s\S]*?`/g),
  ].map(([invocation]) => invocation);
  assert.ok(powershellInvocations.length >= 4, "expected the PowerShell availability and process checks");

  for (const invocation of powershellInvocations) {
    assert.match(invocation, /-NoProfile\b/);
    assert.match(invocation, /-NonInteractive\b/);
  }
});

test("M1 preserves the complete strict Electron 43 fuse writer", () => {
  assert.match(configSource, /afterPack\s*:\s*applyM1Fuses/);
  assert.match(configSource, /flipFuses\(path\.join\(context\.appOutDir/);
  assert.match(configSource, /strictlyRequireAllFuses:\s*true/);
  assert.doesNotMatch(configSource, /electronFuses\s*:/);

  for (const fuse of [
    "RunAsNode",
    "EnableCookieEncryption",
    "EnableNodeOptionsEnvironmentVariable",
    "EnableNodeCliInspectArguments",
    "EnableEmbeddedAsarIntegrityValidation",
    "OnlyLoadAppFromAsar",
    "LoadBrowserProcessSpecificV8Snapshot",
    "GrantFileProtocolExtraPrivileges",
    "WasmTrapHandlers",
  ]) {
    assert.match(configSource, new RegExp(`FuseV1Options\\.${fuse}`));
  }
});
