import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach, afterEach } from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { AiQuotaPluginConfig } from "../types/domains/ai-quota.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import {
  decryptSecret,
  encryptSecret,
  LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME,
} from "./crypto-service.ts";
import { readSecurePrimaryKey, resetSecureKeyStoreForTests } from "./secure-key-store.ts";
import {
  deserializeDesktopCredentialReference,
  detectCredentialStorageFormat,
  serializeDesktopCredentialReference,
} from "./credential-storage-format.ts";
import {
  CREDENTIAL_MIGRATION_STORAGE_KEY,
  type CredentialMigrationJournal,
  type CredentialMigrationInventoryStorage,
} from "./credential-migration-state.ts";
import {
  migrateDesktopCredentials,
  type CredentialMigrationDependencies,
} from "./credential-migration-service.ts";
import type { CredentialMigrationInventory, CredentialMigrationSource } from "./credential-migration-inventory.ts";
import { getCredentialAuthority, resetCredentialMigrationJournalForTests } from "./credential-migration-state.ts";
import { getDesktopCredentialStoreKey, readCredentialSecret, writeCredentialSecret } from "./credential-backend.ts";
import { secretContext } from "./secret-context.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const localStorage = new MemoryStorage();

function setWindow(extra: Record<string, unknown> = {}): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage, ...extra } });
}

function journal(state: CredentialMigrationJournal["state"] = "idle"): CredentialMigrationJournal {
  return {
    version: 1,
    state,
    backendPolicy: "web_preferred",
    expectedIds: [],
    stagedIds: [],
    verifiedIds: [],
    committedIds: [],
    authorities: {},
    inventoryStorageById: {},
    inventoryVersion: "",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function makeInventory(values: Record<string, string>, storage: CredentialMigrationInventoryStorage = "web-v2"): CredentialMigrationInventory {
  const expectedIds = Object.keys(values).sort();
  const records: CredentialMigrationSource[] = expectedIds.map((id) => ({
    id,
    context: id,
    kind: id.startsWith("mcp:") ? "mcp" : "ai-connection",
    storage,
    sourceVersion: `${storage}:test`,
    readWebSecret: storage === "web-v2" ? async () => values[id] : undefined,
  }));
  return {
    expectedIds,
    items: records.map(({ id }) => ({ id, storage })),
    records,
    inventoryVersion: records.map((record) => `${record.id}=${record.storage}`).join("|"),
  };
}

function desktopBridge(secrets: Map<string, string>, status: () => "available" | "temporarily_unavailable" = () => "available") {
  return {
    getStatus: async () => ({ ok: true as const, value: status() === "available" ? { status: "available" as const, backend: "os_protected" as const } : { status: "temporarily_unavailable" as const } }),
    protectCredential: async (context: string, secret: string) => {
      secrets.set(context, secret);
      return { ok: true as const, value: { version: "desktop-v1" as const, context, payload: Buffer.from(secret, "utf8").toString("base64") } };
    },
    unprotectCredential: async (context: string, envelope: { context: string }) => {
      if (envelope.context !== context || !secrets.has(context)) return { ok: false as const, error: { code: "host_context_mismatch" as const, message: "safe context failure" } };
      return { ok: true as const, value: { secret: secrets.get(context)!, shouldReProtect: false } };
    },
  };
}

beforeEach(async () => {
  localStorage.clear();
  setWindow();
  await reviewDb.delete();
  await reviewDb.open();
  await resetSecureKeyStoreForTests();
  resetCredentialMigrationJournalForTests();
});

afterEach(async () => {
  reviewDb.close();
  await reviewDb.delete();
  await resetSecureKeyStoreForTests();
});

test("storage formats are explicit and context-bound without decrypt-and-guess", () => {
  const context = secretContext.aiConnection("format-test");
  const desktop = serializeDesktopCredentialReference({ version: "desktop-v1", context, payload: "Y2lwaGVy" });
  assert.equal(detectCredentialStorageFormat("v2:Y2lwaGVy", "AAAA"), "web-v2");
  assert.equal(detectCredentialStorageFormat("legacy-ciphertext", "AAAA"), "legacy-v1");
  assert.equal(detectCredentialStorageFormat("v9:ciphertext", "AAAA"), "unknown");
  assert.equal(detectCredentialStorageFormat("v2:not-base64", "AAAA"), "invalid");
  assert.equal(detectCredentialStorageFormat(desktop, "AAAA"), "desktop-v1");
  assert.throws(
    () => deserializeDesktopCredentialReference(desktop, secretContext.mcpToken("other")),
    (error: unknown) => error instanceof Error && error.name === "CredentialStorageFormatError" && "code" in error && error.code === "context_mismatch",
  );
});

test("inventory reads multiple real sources and returns no secret-bearing inventory fields", async () => {
  const timestamp = "2026-08-12T00:00:00.000Z";
  const connectionContext = secretContext.aiConnection("inventory-profile");
  const quotaContext = secretContext.quotaCredential("openai", "adminKey");
  const mcpContext = secretContext.mcpToken("inventory-mcp");
  const fenbiContext = secretContext.fenbiCookie();
  const connection = await encryptSecret("inventory-ai-secret", connectionContext);
  const quota = await encryptSecret("inventory-quota-secret", quotaContext);
  const mcp = await encryptSecret("inventory-mcp-secret", mcpContext);
  const fenbiCipher = await encryptSecret("inventory-cookie-secret", fenbiContext);
  const profile: ApiConnectionProfile = {
    id: "inventory-profile", label: "Inventory", provider: "openai", apiFormat: "responses", baseUrl: "https://example.test", capabilities: ["text"],
    ...connection, maskedKey: "inve...cret", providerOptions: {}, createdAt: timestamp, updatedAt: timestamp,
  };
  await reviewDb.apiConnectionProfiles.put(profile);
  const quotaConfig: AiQuotaPluginConfig = {
    id: "openai", provider: "openai", label: "OpenAI", enabled: true,
    encryptedCredentials: { adminKey: { ...quota, maskedKey: "inve...cret" } }, currency: "USD", updatedAt: timestamp,
  };
  localStorage.setItem(secretStorageLocations.quotaConfigs, JSON.stringify([quotaConfig]));
  const mcpProfile: McpServerProfile = {
    id: "inventory-mcp", label: "MCP", endpoint: "https://mcp.example", enabled: true, authMode: "bearer",
    encryptedToken: mcp.encryptedKey, encryptedTokenIv: mcp.iv, createdAt: timestamp, updatedAt: timestamp,
  };
  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify({ profiles: [mcpProfile], discovery: {} }));
  const fenbi: FenbiImportCredential = { encryptedCookie: fenbiCipher.encryptedKey, iv: fenbiCipher.iv, maskedCookie: "inve...cret" };
  localStorage.setItem(secretStorageLocations.fenbiCredential, JSON.stringify(fenbi));

  const { collectCredentialMigrationInventory } = await import("./credential-migration-inventory.ts");
  const inventory = await collectCredentialMigrationInventory();
  assert.deepEqual(inventory.expectedIds, [...inventory.expectedIds].sort());
  assert.deepEqual(inventory.items.map((item) => item.storage), ["web-v2", "web-v2", "web-v2", "web-v2"]);
  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /inventory-ai-secret|inventory-quota-secret|inventory-mcp-secret|inventory-cookie-secret|"(?:encryptedKey|iv|maskedKey|secret|payload)"/);
  assert.equal(Object.keys(inventory.records[0] ?? {}).includes("readWebSecret"), false);
  assert.equal(localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME), null);
});

test("inventory classifies masked-only and unknown formats deterministically", async () => {
  const timestamp = "2026-08-12T00:00:00.000Z";
  await reviewDb.apiConnectionProfiles.bulkPut([
    {
      id: "masked", label: "Masked", provider: "openai", apiFormat: "responses", baseUrl: "https://example.test", capabilities: ["text"],
      encryptedKey: "", iv: "", maskedKey: "****-only", providerOptions: {}, createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "unknown", label: "Unknown", provider: "openai", apiFormat: "responses", baseUrl: "https://example.test", capabilities: ["text"],
      encryptedKey: "v9:opaque", iv: "AAAA", maskedKey: "unkn...own", providerOptions: {}, createdAt: timestamp, updatedAt: timestamp,
    },
  ]);
  const { collectCredentialMigrationInventory } = await import("./credential-migration-inventory.ts");
  const inventory = await collectCredentialMigrationInventory();
  assert.deepEqual(inventory.items.map((item) => [item.id, item.storage]), [
    ["ai-connection:masked:api-key", "masked-only"],
    ["ai-connection:unknown:api-key", "unknown"],
  ]);
});

test("migration stages and verifies every record before authority commit, retaining Web sources", async () => {
  const values = {
    [secretContext.aiConnection("migration-a")]: "secret-a",
    [secretContext.mcpToken("migration-b")]: "secret-b",
  };
  let current = makeInventory(values);
  let currentJournal = journal();
  const desktop = new Map<string, string>();
  const authorityOrder: string[] = [];
  const dependencies: CredentialMigrationDependencies = {
    getHost: async () => ({ kind: "desktop", availability: "available" }),
    collectInventory: async () => current,
    stage: async (context, secret) => { desktop.set(context, secret); },
    readDesktop: async (context) => desktop.get(context) ?? "",
    hasDesktop: (context) => desktop.has(context),
    readJournal: () => currentJournal,
    writeJournal: (next) => { currentJournal = next; return next; },
    setAuthority: (context, authority) => {
      if (!authority) return currentJournal;
      assert.equal(currentJournal.verifiedIds.length, currentJournal.expectedIds.length);
      authorityOrder.push(context);
      const authorities: CredentialMigrationJournal["authorities"] = { ...currentJournal.authorities };
      authorities[context] = authority;
      currentJournal = { ...currentJournal, authorities };
      current = {
        ...current,
        items: current.items.map((item) => item.id === context ? { ...item, storage: "desktop-v1" } : item),
        records: current.records.map((record) => record.id === context ? { ...record, storage: "desktop-v1", readWebSecret: undefined } : record),
        inventoryVersion: current.inventoryVersion.replace(/web-v2/g, "desktop-v1"),
      };
      return currentJournal;
    },
  };
  const result = await migrateDesktopCredentials(dependencies);
  assert.equal(result.status, "complete");
  assert.deepEqual(authorityOrder, Object.keys(values).sort());
  assert.deepEqual(currentJournal.committedIds, Object.keys(values).sort());
  assert.equal(JSON.stringify(currentJournal).includes("secret-a"), false);
  assert.equal(JSON.stringify(currentJournal).includes("secret-b"), false);
  assert.deepEqual([...desktop.keys()].sort(), Object.keys(values).sort());
  assert.equal(current.items.every((item) => item.storage === "desktop-v1"), true);
  assert.equal(current.records.some((record) => record.readWebSecret), false);
});

test("empty Desktop inventory remains a no-op and does not enable Desktop writes", async () => {
  let currentJournal = journal();
  const empty: CredentialMigrationInventory = { expectedIds: [], items: [], records: [], inventoryVersion: "" };
  const result = await migrateDesktopCredentials({
    getHost: async () => ({ kind: "desktop", availability: "available" }),
    collectInventory: async () => empty,
    readJournal: () => currentJournal,
    writeJournal: (next) => { currentJournal = next; return next; },
  });
  assert.equal(result.status, "no_op");
  assert.equal(currentJournal.state, "complete");
  assert.equal(currentJournal.backendPolicy, "web_preferred");
});

test("repeated explicit migration actions share one in-flight operation", async () => {
  let release!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let currentJournal = journal();
  const empty: CredentialMigrationInventory = { expectedIds: [], items: [], records: [], inventoryVersion: "" };
  const dependencies: CredentialMigrationDependencies = {
    getHost: async () => ({ kind: "desktop", availability: "available" }),
    collectInventory: async () => {
      markStarted();
      await gate;
      return empty;
    },
    readJournal: () => currentJournal,
    writeJournal: (next) => { currentJournal = next; return next; },
  };

  const first = migrateDesktopCredentials(dependencies);
  await started;
  const second = migrateDesktopCredentials(dependencies);
  assert.strictEqual(first, second);
  release();
  assert.equal((await first).status, "no_op");
});

test("partial staging is recovery-required and resumable without replaying completed records", async () => {
  const values = {
    [secretContext.aiConnection("resume-a")]: "secret-a",
    [secretContext.aiConnection("resume-b")]: "secret-b",
  };
  let current = makeInventory(values);
  let currentJournal = journal();
  const desktop = new Map<string, string>();
  let fail = true;
  const dependencies: CredentialMigrationDependencies = {
    getHost: async () => ({ kind: "desktop", availability: "available" }), collectInventory: async () => current,
    stage: async (context, secret) => { if (fail && context.endsWith("resume-b:api-key")) throw new Error("host protection failure"); desktop.set(context, secret); },
    readDesktop: async (context) => desktop.get(context) ?? "", hasDesktop: (context) => desktop.has(context),
    readJournal: () => currentJournal, writeJournal: (next) => { currentJournal = next; return next; },
    setAuthority: (context, authority) => { if (!authority) return currentJournal; const authorities: CredentialMigrationJournal["authorities"] = { ...currentJournal.authorities }; authorities[context] = authority; currentJournal = { ...currentJournal, authorities }; current = { ...current, items: current.items.map((item) => item.id === context ? { ...item, storage: "desktop-v1" } : item), records: current.records.map((record) => record.id === context ? { ...record, storage: "desktop-v1", readWebSecret: undefined } : record), inventoryVersion: current.inventoryVersion.replace(/web-v2/g, "desktop-v1") }; return currentJournal; },
  };
  const first = await migrateDesktopCredentials(dependencies);
  assert.equal(first.status, "recovery_required");
  assert.equal(currentJournal.committedIds.length, 0);
  assert.equal(currentJournal.stagedIds.length, 1);
  fail = false;
  const second = await migrateDesktopCredentials(dependencies);
  assert.equal(second.status, "complete");
  assert.equal(currentJournal.committedIds.length, 2);
});

test("inventory change after staging blocks commit and does not change authority", async () => {
  const id = secretContext.aiConnection("inventory-change");
  const first = makeInventory({ [id]: "secret" });
  const changed: CredentialMigrationInventory = { ...first, inventoryVersion: "changed", records: first.records.map((record) => ({ ...record, sourceVersion: "changed" })) };
  let calls = 0;
  let currentJournal = journal();
  let committed = false;
  const dependencies: CredentialMigrationDependencies = {
    getHost: async () => ({ kind: "desktop", availability: "available" }), collectInventory: async () => { calls += 1; return calls === 1 ? first : changed; },
    stage: async () => undefined, readDesktop: async () => "secret", hasDesktop: () => true,
    readJournal: () => currentJournal, writeJournal: (next) => { currentJournal = next; return next; },
    setAuthority: () => { committed = true; return currentJournal; },
  };
  const result = await migrateDesktopCredentials(dependencies);
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "migration_inventory_changed");
  assert.equal(committed, false);
});

test("post-cutover reads Desktop first and never downgrades to Web when host is unavailable", async () => {
  const context = secretContext.aiConnection("cutover");
  const web = await encryptSecret("web-secret", context);
  const secrets = new Map<string, string>();
  let available = true;
  setWindow({ reviewDesktopCredentialProtection: desktopBridge(secrets, () => available ? "available" : "temporarily_unavailable") });
  localStorage.setItem(CREDENTIAL_MIGRATION_STORAGE_KEY, JSON.stringify({
    ...journal("complete"), state: "complete", backendPolicy: "desktop_preferred", expectedIds: [context],
    inventoryStorageById: { [context]: "web-v2" }, inventoryVersion: `${context}=web-v2`,
  }));
  const written = await writeCredentialSecret(context, web, "desktop-secret");
  assert.equal(written.backend, "desktop_host");
  assert.equal(getCredentialAuthority(context), "desktop_primary");
  assert.equal(await readCredentialSecret(context, written), "desktop-secret");
  assert.doesNotMatch(localStorage.getItem(getDesktopCredentialStoreKey()) ?? "", /desktop-secret|web-secret/);
  assert.equal(await decryptSecret(web.encryptedKey, web.iv, context), "web-secret");
  available = false;
  await assert.rejects(
    readCredentialSecret(context, written),
    (error: unknown) => error instanceof Error && error.name === "CredentialBackendError" && "code" in error && error.code === "desktop_host_unavailable",
  );
  assert.equal(await readSecurePrimaryKey() !== undefined, true);
});

test("completed Desktop policy never writes Web when the host is unavailable", async () => {
  const context = secretContext.aiConnection("cutover-write-unavailable");
  const web = await encryptSecret("old-web-secret", context);
  setWindow({ reviewDesktopCredentialProtection: desktopBridge(new Map(), () => "temporarily_unavailable") });
  localStorage.setItem(CREDENTIAL_MIGRATION_STORAGE_KEY, JSON.stringify({
    ...journal("complete"), state: "complete", backendPolicy: "desktop_preferred", expectedIds: [context],
    inventoryStorageById: { [context]: "web-v2" }, inventoryVersion: `${context}=web-v2`,
  }));

  await assert.rejects(
    writeCredentialSecret(context, web, "new-secret"),
    (error: unknown) => error instanceof Error && error.name === "CredentialBackendError" && "code" in error && error.code === "desktop_host_unavailable",
  );
  assert.equal(await decryptSecret(web.encryptedKey, web.iv, context), "old-web-secret");
});

test("partial authority commit is recovery-required and resumes without replaying committed records", async () => {
  const values = {
    [secretContext.aiConnection("commit-a")]: "secret-a",
    [secretContext.aiConnection("commit-b")]: "secret-b",
  };
  const ids = Object.keys(values).sort();
  let current = makeInventory(values);
  let currentJournal = journal();
  const desktop = new Map<string, string>();
  let failSecondCommit = true;
  const committedOrder: string[] = [];
  const markDesktop = (context: string): void => {
    current = {
      ...current,
      items: current.items.map((item) => item.id === context ? { ...item, storage: "desktop-v1" } : item),
      records: current.records.map((record) => record.id === context ? { ...record, storage: "desktop-v1", readWebSecret: undefined } : record),
      inventoryVersion: current.records.map((record) => `${record.id}=${record.id === context ? "desktop-v1" : record.storage}`).join("|"),
    };
  };
  const dependencies: CredentialMigrationDependencies = {
    getHost: async () => ({ kind: "desktop", availability: "available" }),
    collectInventory: async () => current,
    stage: async (context, secret) => { desktop.set(context, secret); },
    readDesktop: async (context) => desktop.get(context) ?? "",
    hasDesktop: (context) => desktop.has(context),
    readJournal: () => currentJournal,
    writeJournal: (next) => { currentJournal = next; return next; },
    setAuthority: (context, authority) => {
      if (!authority) return currentJournal;
      if (context === ids[1] && failSecondCommit) {
        failSecondCommit = false;
        throw new Error("simulated commit failure");
      }
      committedOrder.push(context);
      markDesktop(context);
      currentJournal = { ...currentJournal, authorities: { ...currentJournal.authorities, [context]: authority } };
      return currentJournal;
    },
  };

  const first = await migrateDesktopCredentials(dependencies);
  assert.equal(first.status, "recovery_required");
  assert.equal(first.reason, "migration_commit_failed");
  assert.deepEqual(currentJournal.committedIds, [ids[0]]);
  assert.deepEqual(committedOrder, [ids[0]]);

  const second = await migrateDesktopCredentials(dependencies);
  assert.equal(second.status, "complete");
  assert.deepEqual(currentJournal.committedIds, ids);
  assert.deepEqual(committedOrder, ids);
});

test("Phase 2 retains the old Web source and has no cleanup call", () => {
  const migrationSource = readFileSync(new URL("./credential-migration-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(migrationSource, /deleteSecureKeyStore/);
});

test("decrypting a missing Web key never creates a replacement key", async () => {
  setWindow();
  const context = secretContext.aiConnection("missing-key");
  const encrypted = await encryptSecret("secret", context);
  await resetSecureKeyStoreForTests();
  await assert.rejects(decryptSecret(encrypted.encryptedKey, encrypted.iv, context));
  assert.equal(await readSecurePrimaryKey(), undefined);
});
