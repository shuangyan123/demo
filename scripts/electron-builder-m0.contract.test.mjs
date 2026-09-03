import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const require = createRequire(import.meta.url);
const builderConfigPath = resolve(workspaceRoot, "electron-builder.m0.cjs");
const builderConfigSource = readFileSync(builderConfigPath, "utf8");
const builderConfig = require(builderConfigPath);
const forgeConfig = readFileSync(resolve(workspaceRoot, "forge.config.ts"), "utf8");
const squirrelNuspec = readFileSync(resolve(workspaceRoot, "scripts", "squirrel.nuspec.template"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(resolve(workspaceRoot, "package-lock.json"), "utf8"));
const recallWindowsIconPath = resolve(workspaceRoot, "public", "brand", "recall", "app", "recall.ico");

test("M0 builder config is additive and targets bundled NSIS only", () => {
  assert.equal(packageJson.name, "review-workspace");
  assert.equal(packageJson.productName, "错题复盘");
  assert.equal(packageJson.version, "0.2.4");
  assert.equal(packageJson.devDependencies["electron-builder"], "26.16.0");
  assert.equal(packageLock.packages["node_modules/electron-builder"].version, "26.16.0");

  assert.equal(builderConfig.appId, "com.squirrel.review_workspace.review-workspace");
  assert.equal(builderConfig.productName, "错题复盘");
  assert.equal(builderConfig.executableName, "review-workspace");
  assert.equal(builderConfig.electronVersion, "43.4.1");
  assert.equal(builderConfig.asar, true);
  assert.deepEqual(builderConfig.files, [".desktop/**/*"]);
  assert.equal(builderConfig.directories.app, resolve(workspaceRoot, ".desktop-app"));
  assert.equal(builderConfig.directories.output, resolve(workspaceRoot, "out", "builder-m0"));
  assert.equal(builderConfig.electronDist, resolve(workspaceRoot, ".cache", "electron"));
  assert.deepEqual(builderConfig.extraResources, [{
    from: resolve(workspaceRoot, ".desktop-runtime"),
    to: ".desktop-runtime",
    filter: ["**/*"],
  }]);

  assert.deepEqual(builderConfig.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert.equal(builderConfig.win.icon, recallWindowsIconPath);
  assert.equal(builderConfig.nsis.installerIcon, recallWindowsIconPath);
  assert.equal(builderConfig.nsis.uninstallerIcon, recallWindowsIconPath);
  assert.equal(existsSync(recallWindowsIconPath), true);
  assert.equal(builderConfig.publish, null);
  assert.equal(builderConfig.artifactName, "ReviewWorkspace-${version}-NSIS-M0-POC.${ext}");
  assert.equal(builderConfig.nsis.oneClick, false);
  assert.equal(builderConfig.nsis.runAfterFinish, false);
  assert.equal(builderConfig.nsis.differentialPackage, false);
  assert.match(packageJson.scripts["desktop:builder:m0:unpacked"], /--projectDir \.desktop-app .*--config \.\.\\electron-builder\.m0\.cjs/);
  assert.match(packageJson.scripts["desktop:builder:m0"], /--projectDir \.desktop-app .*--config \.\.\\electron-builder\.m0\.cjs/);
  assert.doesNotMatch(builderConfigSource, /nsis-web|nsisWeb/);
  assert.doesNotMatch(builderConfigSource, /electron-updater|autoUpdater|latest\.yml/);
});

test("M0 fuse hook requires the complete existing Electron V1 security wire", () => {
  assert.match(builderConfigSource, /afterPack\s*:\s*applyM0Fuses/);
  assert.match(builderConfigSource, /flipFuses\(path\.join\(context\.appOutDir/);
  assert.match(builderConfigSource, /strictlyRequireAllFuses:\s*true/);
  assert.doesNotMatch(builderConfigSource, /electronFuses\s*:/);

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
    assert.match(builderConfigSource, new RegExp(`FuseV1Options\\.${fuse}`));
  }
});

test("M0 leaves the accepted Forge Squirrel production contract intact", () => {
  assert.match(forgeConfig, /new MakerSquirrel\(/);
  assert.match(forgeConfig, /name:\s*["']review_workspace["']/);
  assert.match(forgeConfig, /nuspecTemplate:\s*squirrelNuspecTemplate/);
  assert.match(forgeConfig, /setupExe: `ReviewWorkspace-\$\{process\.env\.npm_package_version \?\? "0\.2\.4"\}-Windows-x64-Setup\.exe`/);
  assert.match(squirrelNuspec, /<id><%- name %><\/id>/);
  assert.doesNotMatch(squirrelNuspec, /<iconUrl\b/i);

  assert.match(packageJson.scripts["desktop:make"], /@electron-forge\/cli\/dist\/electron-forge-make\.js/);
  assert.match(packageJson.scripts["desktop:package"], /@electron-forge\/cli\/dist\/electron-forge-package\.js/);
  assert.equal(packageJson.devDependencies["electron"], "43.4.1");
  assert.equal(packageJson.devDependencies["@electron-forge/maker-squirrel"], "7.11.2");
  assert.equal(packageJson.dependencies["electron-updater"], undefined);
  assert.doesNotMatch(JSON.stringify(packageJson), /autoUpdater|latest\.yml/);
});
