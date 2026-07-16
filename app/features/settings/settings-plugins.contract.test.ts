import assert from "node:assert/strict";
import test from "node:test";
import { settingsPluginDefinitions, type SettingsPluginRuntimeContext } from "./plugins/settings-plugin-registry.ts";
import { integrationBranding } from "../../services/integration-branding.ts";

test("settings plugin registry exposes compact directory metadata", () => {
  const ids = settingsPluginDefinitions.map((plugin) => plugin.id);
  assert.deepEqual(ids, ["declarative-marketplace", "obsidian-vault", "fenbi-import"]);
  assert.deepEqual(settingsPluginDefinitions.map((plugin) => plugin.detailPanelLoader), ["declarative-marketplace", "obsidian", "fenbi-import"]);
  assert.deepEqual(settingsPluginDefinitions.map((plugin) => plugin.category), ["study-extension", "knowledge-sync", "import-source"]);
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
  const marketplace = settingsPluginDefinitions.find((plugin) => plugin.id === "declarative-marketplace");
  assert.equal(obsidian?.statusBadgeProvider?.(context).tone, "yellow");
  assert.equal(fenbi?.statusBadgeProvider?.(context).tone, "yellow");
  assert.equal(settingsPluginDefinitions.some((plugin) => String(plugin.id) === "ai-quota"), false);
  assert.equal(settingsPluginDefinitions.some((plugin) => String(plugin.category) === "mcp"), false);
  assert.match(fenbi?.recentActivityProvider?.(context) ?? "", /2/);
  assert.equal(Boolean(obsidian?.recommendedActionProvider?.(context)), true);
  assert.match(marketplace?.privacyNote ?? "", /JavaScript/);
});

test("Obsidian 使用固定版本 Lobe 品牌资产并登记校验值", () => {
  const obsidian = settingsPluginDefinitions.find((plugin) => plugin.id === "obsidian-vault");
  assert.equal(obsidian?.icon.assetPath, integrationBranding.obsidian.assetPath);
  assert.equal(integrationBranding.obsidian.version, "1.91.0");
  assert.equal(integrationBranding.obsidian.license, "MIT");
  assert.match(integrationBranding.obsidian.sha256, /^[a-f0-9]{64}$/);
});
