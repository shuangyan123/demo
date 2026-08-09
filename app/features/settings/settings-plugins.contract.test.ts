import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { settingsPluginDefinitions, type SettingsPluginRuntimeContext } from "./plugins/settings-plugin-registry.ts";
import { buildPluginDirectory } from "./plugins/settings-plugin-directory.ts";
import { integrationBranding } from "../../services/integration-branding.ts";

test("settings plugin registry exposes compact directory metadata", () => {
  const ids = settingsPluginDefinitions.map((plugin) => plugin.id);
  assert.deepEqual(ids, ["obsidian-vault", "fenbi-import"]);
  assert.deepEqual(settingsPluginDefinitions.map((plugin) => plugin.detailPanelLoader), ["obsidian", "fenbi-import"]);
  assert.deepEqual(settingsPluginDefinitions.map((plugin) => plugin.category), ["knowledge-sync", "import-source"]);
  assert.equal(settingsPluginDefinitions.every((plugin) => plugin.icon.label.length > 0), true);
  assert.equal(settingsPluginDefinitions.every((plugin) => plugin.shortDescription.length > 0 && plugin.shortDescription.length <= 18), true);
  assert.equal(settingsPluginDefinitions.every((plugin) => plugin.primaryAction.label.length > 0), true);
  assert.equal(settingsPluginDefinitions.every((plugin) => plugin.menuActions.length > 0), true);
  assert.equal(settingsPluginDefinitions.some((plugin) => "installed" in plugin), false);
  assert.equal(settingsPluginDefinitions.some((plugin) => plugin.primaryAction.kind === ("install" as never)), false);
});

test("settings plugin directory keeps MCP out of plugin categories", () => {
  const context: SettingsPluginRuntimeContext = {
    entryCount: 0,
    importJobCount: 2,
    knowledgeDraftCount: 3,
    mistakeCount: 1,
    hasTextConnection: true,
    hasVisionConnection: false,
  };
  const obsidian = settingsPluginDefinitions.find((plugin) => plugin.id === "obsidian-vault");
  const fenbi = settingsPluginDefinitions.find((plugin) => plugin.id === "fenbi-import");
  assert.equal(obsidian?.statusBadgeProvider?.(context).tone, "yellow");
  assert.equal(fenbi?.statusBadgeProvider?.(context).tone, "yellow");
  assert.equal(settingsPluginDefinitions.some((plugin) => String(plugin.id) === "ai-quota"), false);
  assert.equal(settingsPluginDefinitions.some((plugin) => String(plugin.category) === "mcp"), false);
  assert.match(fenbi?.recentActivityProvider?.(context) ?? "", /2/);
  assert.equal(Boolean(obsidian?.recommendedActionProvider?.(context)), true);
  assert.equal(settingsPluginDefinitions.some((plugin) => String(plugin.id) === "declarative-marketplace"), false);
});

test("插件联合目录默认启用内置项且只把真实安装包提升为声明式插件", () => {
  const directory = buildPluginDirectory(
    settingsPluginDefinitions,
    { "obsidian-vault": true, "fenbi-import": false },
    [{ id: "org.example.theme", kind: "theme", enabled: true } as never],
  );
  assert.deepEqual(directory.map((item) => item.kind), ["builtin", "builtin", "declarative"]);
  assert.deepEqual(directory.map((item) => item.enabled), [true, false, true]);
  assert.equal(directory.find((item) => item.kind === "builtin" && item.id === "obsidian-vault")?.kind, "builtin");
  assert.equal(directory.find((item) => item.kind === "declarative")?.id, "org.example.theme");
});

test("Obsidian 使用固定版本 Lobe 品牌资产并登记校验值", () => {
  const obsidian = settingsPluginDefinitions.find((plugin) => plugin.id === "obsidian-vault");
  assert.equal(obsidian?.icon.assetPath, integrationBranding.obsidian.assetPath);
  assert.equal(integrationBranding.obsidian.version, "1.91.0");
  assert.equal(integrationBranding.obsidian.license, "MIT");
  assert.match(integrationBranding.obsidian.sha256, /^[a-f0-9]{64}$/);
});

test("插件目录保持无分隔线开放列表并提供键盘焦点与整页详情", async () => {
  const [styles, importStyles, view, marketplace] = await Promise.all([
    readFile(new URL("./plugins/settings-plugins-view.module.css", import.meta.url), "utf8"),
    readFile(new URL("../import/review-import-view.module.css", import.meta.url), "utf8"),
    readFile(new URL("./plugins/settings-plugins-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("./plugins/declarative-extension-marketplace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(styles, /\.list\s*\{[\s\S]*gap:\s*0\.35rem/);
  assert.doesNotMatch(styles, /\.row[^}]*border-bottom/);
  assert.match(styles, /\.moreButton:focus-visible/);
  assert.match(styles, /\.detailPage\s*\{[\s\S]*width:\s*min\(57\.5rem, 100%\)/);
  assert.match(importStyles, /@media \(max-width: 640px\)/);
  assert.match(importStyles, /data-step="confirm"/);
  assert.match(view, /useState<ActivePlugin \| undefined>/);
  assert.match(view, /插件市场/);
  assert.match(view, /className=\{styles\.rowMain\}/);
  assert.match(view, /className=\{styles\.toggle\}/);
  assert.match(view, /className=\{styles\.moreButton\}/);
  assert.match(styles, /\.detailControls/);
  assert.match(marketplace, /className=\{styles\.rowMain\}/);
  assert.match(marketplace, /搜索插件名称、作用或作者/);
  assert.doesNotMatch(marketplace, /<h[1-6][^>]*>已安装/);
});
