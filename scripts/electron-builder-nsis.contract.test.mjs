import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const require = createRequire(import.meta.url);
const configPath = resolve(workspaceRoot, "electron-builder.nsis.cjs");
const configSource = readFileSync(configPath, "utf8");
const config = require(configPath);
const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(workspaceRoot, "package-lock.json"), "utf8"));

test("M1 builder config is an opt-in bundled NSIS candidate path", () => {
  assert.equal(packageJson.name, "review-workspace");
  assert.equal(packageJson.productName, "错题复盘");
  assert.equal(packageJson.version, "0.2.4");
  assert.equal(packageJson.devDependencies["electron-builder"], "26.15.3");
  assert.equal(packageLock.packages["node_modules/electron-builder"].version, "26.15.3");

  assert.equal(config.appId, "com.squirrel.review_workspace.review-workspace");
  assert.equal(config.productName, "错题复盘");
  assert.equal(config.executableName, "review-workspace");
  assert.equal(config.electronVersion, "43.2.0");
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
  assert.equal(config.win.icon, undefined, "M1 must not introduce an unapproved icon asset");

  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.selectPerMachineByDefault, false);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(config.nsis.differentialPackage, false);
  assert.equal(config.nsis.shortcutName, "错题复盘");
  assert.equal(config.nsis.uninstallDisplayName, "错题复盘");
  assert.equal(config.nsis.createDesktopShortcut, true);
  assert.equal(config.nsis.createStartMenuShortcut, true);
  assert.equal(config.nsis.installerIcon, undefined);
  assert.equal(config.nsis.uninstallerIcon, undefined);

  assert.match(packageJson.scripts["desktop:builder:nsis:unpacked"], /--projectDir \.desktop-app .*--config \.\.\\electron-builder\.nsis\.cjs/);
  assert.match(packageJson.scripts["desktop:builder:nsis:bundle"], /--projectDir \.desktop-app .*--config \.\.\\electron-builder\.nsis\.cjs/);
  assert.match(packageJson.scripts["desktop:builder:nsis"], /desktop:prepare/);
  assert.match(packageJson.scripts["generate:desktop:builder:nsis:evidence"], /generate-electron-builder-nsis-evidence/);
  assert.match(packageJson.scripts["test:desktop:builder:nsis:artifact"], /DESKTOP_BUILDER_NSIS_ARTIFACT_REQUIRED=1/);

  assert.doesNotMatch(configSource, /nsis-web|nsisWeb|appPackageUrl/);
  assert.doesNotMatch(configSource, /electron-updater|autoUpdater|latest\.yml|\.blockmap/);
  assert.doesNotMatch(configSource, /app\.setAppUserModelId/);
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
