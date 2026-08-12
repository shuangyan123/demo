import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";

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
const { FENBI_CREDENTIAL_STORAGE_KEY, fenbiCredentialRepository } = await import("./fenbi-credential-repository.ts");
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
  await assert.rejects(
    () => fenbiCredentialRepository.reveal(),
    (error: unknown) => error instanceof SettingsPluginDisabledError && error.pluginId === "fenbi-import",
  );

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    throw new Error("disabled plugin must not reach provider");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => fenbiImportProviderPlugin.parseText({ mode: "ai", rawText: "不会发送", textConnection: {} as never }),
      (error: unknown) => error instanceof SettingsPluginDisabledError && error.pluginId === "fenbi-import",
    );
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }

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

test("停用内置插件只撤销 enabled，不删除已有凭据或 Vault 配置记录", async () => {
  settingsPluginPreferencesRepository.setEnabled("fenbi-import", true);
  const credential = await fenbiCredentialRepository.save("session=acceptance-cookie");
  const persistedCredential = localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY);
  assert.ok(persistedCredential);
  const previousVaultConfig = await reviewDb.obsidianVaultConfigs.get("default");
  const vaultConfig = {
    id: "default" as const,
    vaultName: "acceptance-vault",
    managedRoot: "AI Knowledge",
    directoryHandle: { name: "acceptance-vault" } as unknown as FileSystemDirectoryHandle,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
  await reviewDb.obsidianVaultConfigs.put(vaultConfig);

  try {
    settingsPluginPreferencesRepository.setEnabled("fenbi-import", false);
    settingsPluginPreferencesRepository.setEnabled("obsidian-vault", false);
    assert.equal(localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY), persistedCredential);
    assert.equal(fenbiCredentialRepository.load()?.encryptedCookie, credential.encryptedCookie);
    assert.deepEqual(await reviewDb.obsidianVaultConfigs.get("default"), vaultConfig);
  } finally {
    settingsPluginPreferencesRepository.setEnabled("fenbi-import", true);
    settingsPluginPreferencesRepository.setEnabled("obsidian-vault", true);
    fenbiCredentialRepository.clear();
    if (previousVaultConfig) await reviewDb.obsidianVaultConfigs.put(previousVaultConfig);
    else await reviewDb.obsidianVaultConfigs.delete("default");
  }
});
