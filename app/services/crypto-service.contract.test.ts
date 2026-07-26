import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import "fake-indexeddb/auto";
import { reviewDb } from "../db/review-db.ts";
import type { ApiConnectionProfile, ApiSetting } from "../types/domains/ai-connection.ts";
import type { AiQuotaPluginConfig } from "../types/domains/ai-quota.ts";
import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import {
  decryptSecret,
  encryptSecret,
  LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME,
} from "./crypto-service.ts";
import { getOrCreateSecurePrimaryKey, resetSecureKeyStoreForTests } from "./secure-key-store.ts";
import { secretContext } from "./secret-context.ts";
import { ensureStoredSecretsMigrated, resetSecretMigrationForTests } from "./secret-migration-service.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const localStorage = new MemoryStorage();

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function createLegacyCipher(plainText: string): Promise<{ encryptedKey: string; iv: string }> {
  const saved = localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME);
  const key = saved
    ? await crypto.subtle.importKey("jwk", JSON.parse(saved) as JsonWebKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
    : await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  if (!saved) {
    localStorage.setItem(
      LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME,
      JSON.stringify(await crypto.subtle.exportKey("jwk", key)),
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
  return { encryptedKey: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

beforeEach(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  localStorage.clear();
  resetSecretMigrationForTests();
  await reviewDb.delete();
  await reviewDb.open();
  await resetSecureKeyStoreForTests();
});
afterEach(async () => {
  await reviewDb.delete();
  await resetSecureKeyStoreForTests();
});

test("v2 主密钥不可导出且 AAD 不允许跨记录解密", async () => {
  const key = await getOrCreateSecurePrimaryKey();
  await assert.rejects(crypto.subtle.exportKey("jwk", key), /extractable|InvalidAccess/i);
  const encrypted = await encryptSecret("secret-value", secretContext.aiConnection("one"));
  assert.match(encrypted.encryptedKey, /^v2:/);
  assert.equal(
    await decryptSecret(encrypted.encryptedKey, encrypted.iv, secretContext.aiConnection("one")),
    "secret-value",
  );
  await assert.rejects(
    decryptSecret(encrypted.encryptedKey, encrypted.iv, secretContext.aiConnection("two")),
    /重新输入/,
  );
});

test("共享旧 JWK 的全部凭据可恢复迁移，完成后才删除旧主密钥", async () => {
  const connectionCipher = await createLegacyCipher("connection-secret");
  const legacySettingCipher = await createLegacyCipher("legacy-setting-secret");
  const quotaCipher = await createLegacyCipher("quota-secret");
  const mcpCipher = await createLegacyCipher("mcp-secret");
  const fenbiCipher = await createLegacyCipher("fenbi-secret");
  const timestamp = "2026-07-26T00:00:00.000Z";
  const profile: ApiConnectionProfile = {
    id: "profile-one",
    label: "测试连接",
    provider: "openai",
    apiFormat: "responses",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["text"],
    ...connectionCipher,
    maskedKey: "test...cret",
    providerOptions: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const legacySetting: ApiSetting = {
    id: "default",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-test",
    ...legacySettingCipher,
    maskedKey: "test...cret",
    updatedAt: timestamp,
  };
  await reviewDb.apiConnectionProfiles.put(profile);
  await reviewDb.apiSettings.put(legacySetting);

  const quotaConfig: AiQuotaPluginConfig = {
    id: "openai",
    provider: "openai",
    label: "OpenAI",
    enabled: true,
    encryptedCredentials: { adminKey: { ...quotaCipher, maskedKey: "quot...cret" } },
    currency: "USD",
    updatedAt: timestamp,
  };
  localStorage.setItem(secretStorageLocations.quotaConfigs, JSON.stringify([quotaConfig]));
  const mcpProfile: McpServerProfile = {
    id: "mcp-one",
    label: "MCP",
    endpoint: "https://mcp.example",
    enabled: true,
    authMode: "bearer",
    encryptedToken: mcpCipher.encryptedKey,
    encryptedTokenIv: mcpCipher.iv,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify({ profiles: [mcpProfile], discovery: {} }));
  const fenbi: FenbiImportCredential = {
    encryptedCookie: fenbiCipher.encryptedKey,
    iv: fenbiCipher.iv,
    maskedCookie: "fenb...cret",
  };
  localStorage.setItem(secretStorageLocations.fenbiCredential, JSON.stringify(fenbi));

  await ensureStoredSecretsMigrated();

  const migratedProfile = await reviewDb.apiConnectionProfiles.get(profile.id);
  const migratedSetting = await reviewDb.apiSettings.get("default");
  const migratedQuota = JSON.parse(localStorage.getItem(secretStorageLocations.quotaConfigs) ?? "[]") as AiQuotaPluginConfig[];
  const migratedMcp = JSON.parse(localStorage.getItem(secretStorageLocations.mcpSettings) ?? "{}") as { profiles: McpServerProfile[] };
  const migratedFenbi = JSON.parse(localStorage.getItem(secretStorageLocations.fenbiCredential) ?? "{}") as FenbiImportCredential;
  assert.match(migratedProfile?.encryptedKey ?? "", /^v2:/);
  assert.match(migratedSetting?.encryptedKey ?? "", /^v2:/);
  assert.match(migratedQuota[0]?.encryptedCredentials?.adminKey?.encryptedKey ?? "", /^v2:/);
  assert.match(migratedMcp.profiles[0]?.encryptedToken ?? "", /^v2:/);
  assert.match(migratedFenbi.encryptedCookie, /^v2:/);
  assert.equal(localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME), null);
  assert.equal(
    await decryptSecret(migratedProfile!.encryptedKey, migratedProfile!.iv, secretContext.aiConnection(profile.id)),
    "connection-secret",
  );
});

test("迁移中任一密文损坏时保留旧 JWK，并允许修复后幂等继续", async () => {
  const connectionCipher = await createLegacyCipher("connection-secret");
  const validMcpCipher = await createLegacyCipher("mcp-secret");
  const timestamp = "2026-07-26T00:00:00.000Z";
  await reviewDb.apiConnectionProfiles.put({
    id: "profile-one",
    label: "测试连接",
    provider: "openai",
    apiFormat: "responses",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["text"],
    ...connectionCipher,
    maskedKey: "test...cret",
    providerOptions: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const brokenProfile: McpServerProfile = {
    id: "mcp-one",
    label: "MCP",
    endpoint: "https://mcp.example",
    enabled: true,
    authMode: "bearer",
    encryptedToken: "broken-cipher",
    encryptedTokenIv: validMcpCipher.iv,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify({ profiles: [brokenProfile], discovery: {} }));

  await assert.rejects(ensureStoredSecretsMigrated(), /重新输入/);
  assert.notEqual(localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME), null);
  assert.match((await reviewDb.apiConnectionProfiles.get("profile-one"))?.encryptedKey ?? "", /^v2:/);

  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify({
    profiles: [{ ...brokenProfile, encryptedToken: validMcpCipher.encryptedKey }],
    discovery: {},
  }));
  resetSecretMigrationForTests();
  await ensureStoredSecretsMigrated();
  assert.equal(localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME), null);
});
