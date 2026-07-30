import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/desktop-release.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const electronArchive = readFileSync(new URL("../scripts/prepare-electron-archive.mjs", import.meta.url), "utf8");

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
