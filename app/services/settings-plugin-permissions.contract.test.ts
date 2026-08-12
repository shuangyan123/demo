import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const localStorage = new MemoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

const { assertSettingsPluginEnabled, SettingsPluginDisabledError, settingsPluginPreferencesRepository } = await import("./settings-plugin-preferences-repository.ts");
const { fenbiImportProviderPlugin } = await import("./import-provider-plugins.ts");
const { obsidianKnowledgeRepository } = await import("./obsidian-knowledge-repository.ts");
const { obsidianVaultAdapter } = await import("./obsidian-vault-adapter.ts");

test("停用内置插件会在执行边界之前阻断并保留凭据/数据状态", async () => {
  settingsPluginPreferencesRepository.setEnabled("fenbi-import", false);
  assert.equal(settingsPluginPreferencesRepository.isEnabled("fenbi-import"), false);
  assert.throws(
    () => assertSettingsPluginEnabled("fenbi-import"),
    (error: unknown) => error instanceof SettingsPluginDisabledError && error.reason === "plugin_disabled",
  );
  await assert.rejects(
    () => fenbiImportProviderPlugin.parseText({ mode: "local", rawText: "【题目】不会执行" }),
    (error: unknown) => error instanceof SettingsPluginDisabledError && error.pluginId === "fenbi-import",
  );

  let vaultPermissionCalls = 0;
  const originalPermission = obsidianVaultAdapter.permission;
  obsidianVaultAdapter.permission = async () => {
    vaultPermissionCalls += 1;
    return "granted";
  };
  settingsPluginPreferencesRepository.setEnabled("obsidian-vault", false);
  try {
    await assert.rejects(
      () => obsidianKnowledgeRepository.sync(),
      (error: unknown) => error instanceof SettingsPluginDisabledError && error.pluginId === "obsidian-vault",
    );
    assert.equal(vaultPermissionCalls, 0);
  } finally {
    obsidianVaultAdapter.permission = originalPermission;
    settingsPluginPreferencesRepository.setEnabled("fenbi-import", true);
    settingsPluginPreferencesRepository.setEnabled("obsidian-vault", true);
  }
});
