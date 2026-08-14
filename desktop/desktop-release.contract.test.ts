import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const electronArchive = readFileSync(new URL("../scripts/prepare-electron-archive.mjs", import.meta.url), "utf8");
const desktopHostPreparation = readFileSync(new URL("../scripts/prepare-desktop-host.mjs", import.meta.url), "utf8");
const forgeConfig = readFileSync(new URL("../forge.config.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("PR 共享门禁包含桌面编译与契约", () => {
  assert.match(ci, /npm run desktop:compile/);
  assert.match(ci, /npm run test:desktop/);
});

test("桌面发布只在 Windows x64 手动或标签触发并校验版本", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tags:[\s\S]*"v\*"/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /Tag .* does not match package\.json version/);
  assert.match(workflow, /npm run desktop:make/);
  assert.match(workflow, /npm run test:desktop:integration/);
  assert.match(workflow, /npm run test:desktop:artifact/);
});

test("标签创建正式 Release 且只发布安装器与校验清单", () => {
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /ReviewWorkspace-\$\(\$package\.version\)-Windows-x64-Setup\.exe/);
  assert.match(workflow, /out\/release\/SHA256SUMS\.txt/);
  assert.doesNotMatch(workflow, /gh release create[\s\S]*--draft/);
  assert.match(workflow, /不分发脱离 resources 目录无法独立运行的裸主程序/);
  assert.doesNotMatch(workflow, /autoUpdater|update-electron-app/);
});

test("Electron 官方归档在 runner 缓存缺失时下载并继续校验 checksum", () => {
  assert.match(electronArchive, /downloadArtifact/);
  assert.match(electronArchive, /checksums/);
  assert.match(electronArchive, /isVerifiedArchive\(archivePath\)/);
  assert.doesNotMatch(electronArchive, /请先完成 npm install/);
});

test("Forge and package metadata keep the Windows installer identity stable", () => {
  assert.equal(packageJson.name, "review-workspace");
  assert.equal(packageJson.productName, "错题复盘");
  assert.match(desktopHostPreparation, /const hostPackageJson = \{/);
  assert.match(desktopHostPreparation, /name: packageJson\.name/);
  assert.match(desktopHostPreparation, /productName: packageJson\.productName/);
  assert.match(desktopHostPreparation, /version: packageJson\.version/);
  assert.match(desktopHostPreparation, /main: "\.desktop\/main\.js"/);

  assert.match(forgeConfig, /outDir:\s*"\.\.\/out"/);
  assert.match(forgeConfig, /name:\s*"review-workspace"/);
  assert.match(forgeConfig, /executableName:\s*"review-workspace"/);
  assert.match(forgeConfig, /new MakerSquirrel\(/);
  assert.match(forgeConfig, /name:\s*"review_workspace"/);
  assert.match(
    forgeConfig,
    /setupExe: `ReviewWorkspace-\$\{process\.env\.npm_package_version \?\? "0\.2\.2"\}-Windows-x64-Setup\.exe`/,
  );

  assert.equal(packageLock.packages["node_modules/electron"].version, "43.2.0");
  assert.equal(packageLock.packages["node_modules/@electron-forge/maker-squirrel"].version, "7.11.2");
  assert.equal(packageLock.packages["node_modules/electron-winstaller"].version, "5.4.4");
});

test("userData remains separate from the Squirrel binary root", () => {
  assert.match(main, /const partition = "persist:review-workspace"/);
  assert.doesNotMatch(main, /app\.setPath\(\s*["']userData["']/);
  assert.doesNotMatch(main, /app\.setName\(/);
  assert.equal(packageJson.productName, "错题复盘");
});
