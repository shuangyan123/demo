import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { reviewDb } from "../db/review-db.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { aiQuotaRepository } from "./ai-quota-repository.ts";
import { mcpSettingsRepository } from "./mcp-settings-repository.ts";
import { fenbiCredentialRepository } from "./fenbi-credential-repository.ts";
import { settingsPluginPreferencesRepository } from "./settings-plugin-preferences-repository.ts";
import { readCredentialSecret, getDesktopCredentialStoreKey } from "./credential-backend.ts";
import { CREDENTIAL_MIGRATION_STORAGE_KEY, type CredentialMigrationJournal } from "./credential-migration-state.ts";
import { secretContext } from "./secret-context.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  valuesSnapshot(): string[] { return [...this.values.values()]; }
}

const localStorage = new MemoryStorage();
const today = new Date("2026-08-12T00:00:00.000Z");
let desktopSecrets = new Map<string, string>();
let hostAvailable = true;
let protectCalls = 0;
let unprotectCalls = 0;

function setWindow(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      reviewDesktopCredentialProtection: {
        getStatus: async () => hostAvailable
          ? { ok: true as const, value: { status: "available" as const, backend: "os_protected" as const } }
          : { ok: true as const, value: { status: "temporarily_unavailable" as const } },
        protectCredential: async (context: string, secret: string) => {
          protectCalls += 1;
          desktopSecrets.set(context, secret);
          return { ok: true as const, value: { version: "desktop-v1" as const, context, payload: Buffer.from(`protected:${context}`, "utf8").toString("base64") } };
        },
        unprotectCredential: async (context: string) => {
          unprotectCalls += 1;
          return { ok: true as const, value: { secret: desktopSecrets.get(context) ?? "", shouldReProtect: false } };
        },
      },
    },
  });
}

function completeJournal(): CredentialMigrationJournal {
  return {
    version: 1,
    state: "complete",
    backendPolicy: "desktop_preferred",
    expectedIds: [],
    stagedIds: [],
    verifiedIds: [],
    committedIds: [],
    authorities: {},
    inventoryStorageById: {},
    inventoryVersion: "",
    updatedAt: today.toISOString(),
  };
}

function persistCompleteJournal(): void {
  localStorage.setItem(CREDENTIAL_MIGRATION_STORAGE_KEY, JSON.stringify(completeJournal()));
}

beforeEach(async () => {
  localStorage.clear();
  desktopSecrets = new Map();
  hostAvailable = true;
  protectCalls = 0;
  unprotectCalls = 0;
  setWindow();
  persistCompleteJournal();
  settingsPluginPreferencesRepository.setEnabled("fenbi-import", true);
  await reviewDb.delete();
  await reviewDb.open();
});

afterEach(async () => {
  settingsPluginPreferencesRepository.setEnabled("fenbi-import", true);
  reviewDb.close();
  await reviewDb.delete();
});

test("AI, quota, MCP and Fenbi repositories use Desktop preferred single-write after cutover", async () => {
  const profile = await aiConnectionsRepository.saveProfile({
    label: "Desktop AI", provider: "openai", baseUrl: "https://api.example.test/v1", apiKey: "repo-ai-secret", today,
  });
  assert.equal(profile.encryptedKey, "");
  assert.equal(profile.iv, "");
  assert.equal(await aiConnectionsRepository.resolveSecret(profile), "repo-ai-secret");

  const quota = await aiQuotaRepository.saveConfig({ id: "openai", enabled: true, credentials: { adminKey: "repo-quota-secret" }, today });
  assert.equal(quota.encryptedCredentials?.adminKey?.encryptedKey, "");
  assert.equal(await readCredentialSecret(secretContext.quotaCredential("openai", "adminKey"), quota.encryptedCredentials?.adminKey ?? {}), "repo-quota-secret");
  assert.equal(aiQuotaRepository.isConfigured("openai"), true);

  const mcp = await mcpSettingsRepository.saveProfile({
    label: "Desktop MCP", endpoint: "https://mcp.example.test", enabled: false, authMode: "bearer", token: "repo-mcp-secret",
  });
  assert.equal(mcp.encryptedToken, undefined);
  assert.equal(await readCredentialSecret(secretContext.mcpToken(mcp.id), { encryptedKey: mcp.encryptedToken, iv: mcp.encryptedTokenIv }), "repo-mcp-secret");

  const fenbi = await fenbiCredentialRepository.save("session=repo-fenbi-secret");
  assert.equal(fenbi.encryptedCookie, "");
  assert.equal(await fenbiCredentialRepository.reveal(), "session=repo-fenbi-secret");

  assert.ok(protectCalls >= 4);
  assert.equal(localStorage.valuesSnapshot().some((value) => /repo-ai-secret|repo-quota-secret|repo-mcp-secret|repo-fenbi-secret/.test(value)), false);
  assert.ok(localStorage.getItem(getDesktopCredentialStoreKey()));
});

test("after cutover unavailable Desktop host never falls back to the retained Web source", async () => {
  const profile = await aiConnectionsRepository.saveProfile({
    label: "Unavailable Desktop", provider: "openai", baseUrl: "https://api.example.test/v1", apiKey: "desktop-only-secret", today,
  });
  hostAvailable = false;
  await assert.rejects(
    aiConnectionsRepository.resolveSecret(profile),
    (error: unknown) => error instanceof Error && error.name === "CredentialBackendError" && "code" in error && error.code === "desktop_host_unavailable",
  );
  assert.equal(unprotectCalls, 0);
  await assert.rejects(
    aiConnectionsRepository.saveProfile({ ...profile, id: profile.id, provider: profile.provider, label: profile.label, baseUrl: profile.baseUrl, today, apiKey: "new-secret" }),
    (error: unknown) => error instanceof Error && error.name === "CredentialBackendError" && "code" in error && error.code === "desktop_host_unavailable",
  );
});

test("MCP denied path and disabled Fenbi path do not resolve Desktop credentials", async () => {
  const mcp = await mcpSettingsRepository.saveProfile({ label: "Denied MCP", endpoint: "https://mcp.example.test", enabled: false, authMode: "bearer", token: "denied-secret" });
  const snapshot = {
    profiles: [{ ...mcp, enabled: true } satisfies McpServerProfile],
    discovery: {
      [mcp.id]: {
        serverId: mcp.id, status: "ready", tools: ["blocked"], resources: [], prompts: [],
        toolDescriptors: [{ name: "blocked", permission: "deny" }], checkedAt: today.toISOString(),
      },
    },
  };
  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify(snapshot));
  await assert.rejects(() => mcpSettingsRepository.callTool(mcp, "blocked", {}, { mode: "interactive", confirmed: true }), /禁止|denied/i);
  assert.equal(unprotectCalls, 0);

  await fenbiCredentialRepository.save("session=disabled-secret");
  settingsPluginPreferencesRepository.setEnabled("fenbi-import", false);
  await assert.rejects(() => fenbiCredentialRepository.reveal(), /插件|plugin|disabled/i);
  assert.equal(unprotectCalls, 0);
});
