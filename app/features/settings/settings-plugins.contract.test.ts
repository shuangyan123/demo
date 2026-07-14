import assert from "node:assert/strict";
import test from "node:test";
import { settingsPluginDefinitions, type SettingsPluginRuntimeContext } from "./plugins/settings-plugin-registry.ts";

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
});
