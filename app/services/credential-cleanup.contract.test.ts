import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach, beforeEach } from "node:test";
import "fake-indexeddb/auto";
import { reviewDb } from "../db/review-db.ts";
import type { ApiConnectionProfile, ApiSetting } from "../types/domains/ai-connection.ts";
import type { AiQuotaPluginConfig } from "../types/domains/ai-quota.ts";
import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import {
  collectCredentialCleanupInventory,
  cleanupInventoryHasSensitiveFields,
  type CredentialCleanupInventory,
  type CredentialCleanupSource,
} from "./credential-cleanup-inventory.ts";
import {
  evaluateCredentialCleanupEligibility,
  type CredentialCleanupHostStatus,
} from "./credential-cleanup-eligibility.ts";
import { reconcileCredentialCleanup } from "./credential-cleanup-reconciliation.ts";
import {
  CREDENTIAL_CLEANUP_STORAGE_KEY,
  readCredentialCleanupJournal,
  resetCredentialCleanupJournalForTests,
  writeCredentialCleanupJournal,
} from "./credential-cleanup-state.ts";
import {
  executeCredentialCleanup,
  resetCredentialCleanupExecutorForTests,
  type CredentialCleanupExecutorDependencies,
} from "./credential-cleanup-service.ts";
import { executeDesktopCredentialCleanup } from "./credential-cleanup-execution.ts";
import {
  cleanupAiConnectionCredential,
  cleanupLegacyAiSettingCredential,
} from "./ai-connections-repository.ts";
import { cleanupQuotaCredential } from "./ai-quota-repository.ts";
import { cleanupMcpCredential } from "./mcp-settings-repository.ts";
import { cleanupFenbiCredential } from "./fenbi-credential-repository.ts";
import { cleanupLegacyLocalCryptoKey, LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME } from "./crypto-service.ts";
import { deletePrimaryWebCredentialKeyForCleanup, inspectPrimaryWebCredentialKey, resetSecureKeyStoreForTests } from "./secure-key-store.ts";
import { writeCredentialMigrationJournal, resetCredentialMigrationJournalForTests } from "./credential-migration-state.ts";
import { getDesktopCredentialStoreKey } from "./credential-backend.ts";
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
  snapshot(): Record<string, string> { return Object.fromEntries(this.values); }
}

const localStorage = new MemoryStorage();
const timestamp = "2026-08-13T00:00:00.000Z";

function setWindow(): void {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
}

function desktopStore(contexts: string[]): void {
  localStorage.setItem(getDesktopCredentialStoreKey(), JSON.stringify({
    version: 1,
    records: contexts.map((context) => ({
      version: 1,
      context,
      updatedAt: timestamp,
      envelope: {
        version: "desktop-v1",
        context,
        payload: "Y2lwaGVy",
      },
    })),
  }));
}

function migrationJournal(expectedIds: string[], authorities: Record<string, "desktop_primary"> = Object.fromEntries(expectedIds.map((id) => [id, "desktop_primary"]))) {
  return writeCredentialMigrationJournal({
    version: 1,
    state: "complete",
    backendPolicy: "desktop_preferred",
    expectedIds,
    stagedIds: expectedIds,
    verifiedIds: expectedIds,
    committedIds: expectedIds,
    authorities,
    inventoryStorageById: Object.fromEntries(expectedIds.map((id) => [id, "desktop-v1" as const])),
    inventoryVersion: "migration-fixture-v1",
    updatedAt: timestamp,
  });
}

function source(overrides: Partial<CredentialCleanupSource> & Pick<CredentialCleanupSource, "sourceId" | "kind">): CredentialCleanupSource {
  return {
    credentialId: overrides.credentialId,
    storage: "web-v2",
    storageLocation: "review-db:apiConnectionProfiles",
    classification: "per-record",
    present: true,
    recordCount: 1,
    reasonCodes: [],
    ...overrides,
  };
}

function physicalInventory(options: {
  expectedIds?: string[];
  sources?: CredentialCleanupSource[];
  webKey?: CredentialCleanupInventory["webKey"]["presence"];
  legacyJwk?: boolean;
} = {}): CredentialCleanupInventory {
  const expectedIds = options.expectedIds ?? [secretContext.aiConnection("fixture")];
  return {
    version: "credential-cleanup-physical-v1",
    sources: options.sources ?? [
      source({
        sourceId: `${expectedIds[0]}:profile`,
        credentialId: expectedIds[0],
        kind: "ai-connection",
        authority: "desktop_primary",
      }),
      source({
        sourceId: `${expectedIds[0]}:desktop-store`,
        credentialId: expectedIds[0],
        kind: "desktop-store",
        storage: "desktop-v1",
        storageLocation: "local-storage:desktop",
        authority: "desktop_primary",
      }),
    ],
    observedCredentialIds: expectedIds,
    desktopCredentialIds: expectedIds,
    canonicalAiCredentialIds: expectedIds,
    migration: {
      present: true,
      state: "complete",
      backendPolicy: "desktop_preferred",
      expectedIds,
      stagedIds: expectedIds,
      committedIds: expectedIds,
      authorities: Object.fromEntries(expectedIds.map((id) => [id, "desktop_primary"])),
      inventoryVersion: "migration-fixture-v1",
    },
    webKey: {
      sourceId: "primary-aes-gcm-v2",
      storage: "web-key",
      presence: options.webKey ?? "absent",
      classification: "shared",
      reasonCodes: [],
    },
    legacyJwk: {
      sourceId: "review_workspace_crypto_key_v1",
      storage: "legacy-jwk",
      present: options.legacyJwk ?? false,
      classification: "shared",
      reasonCodes: options.legacyJwk ? ["legacy_source_present"] : [],
    },
    inventoryVersion: "cleanup-fixture-v1",
  };
}

const desktopHost: CredentialCleanupHostStatus = { kind: "desktop", status: "available" };

beforeEach(async () => {
  setWindow();
  localStorage.clear();
  resetCredentialCleanupJournalForTests();
  resetCredentialMigrationJournalForTests();
  resetCredentialCleanupExecutorForTests();
  await reviewDb.delete();
  await reviewDb.open();
  await resetSecureKeyStoreForTests();
});

afterEach(async () => {
  reviewDb.close();
  await reviewDb.delete();
  await resetSecureKeyStoreForTests();
});

test("physical inventory observes real sources without migration, decryption, key creation, or writes", async () => {
  const context = secretContext.aiConnection("physical");
  const profile: ApiConnectionProfile = {
    id: "physical",
    label: "Physical",
    provider: "openai",
    apiFormat: "responses",
    baseUrl: "https://example.test",
    capabilities: ["text"],
    encryptedKey: "v2:AAAA",
    iv: "AAAA",
    maskedKey: "phys...ical",
    providerOptions: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await reviewDb.apiConnectionProfiles.put(profile);
  desktopStore([context]);
  const before = localStorage.snapshot();
  const inventory = await collectCredentialCleanupInventory();

  assert.equal(inventory.sources.some((item) => item.kind === "ai-connection" && item.present), true);
  assert.equal(inventory.sources.some((item) => item.kind === "desktop-store" && item.present), true);
  assert.equal(inventory.webKey.presence, "absent");
  assert.equal(inventory.migration.present, false);
  assert.deepEqual(localStorage.snapshot(), before);
  assert.equal(cleanupInventoryHasSensitiveFields(inventory), false);
  assert.doesNotMatch(JSON.stringify(inventory), /v2:AAAA|phys\.\.\.ical|ciphertext|payload|https:\/\/example\.test/);
  assert.equal(localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME), null);
  assert.equal(localStorage.getItem(CREDENTIAL_CLEANUP_STORAGE_KEY), null);
});

test("inventory distinguishes legacy, unknown, masked-only, shared key and Desktop records", async () => {
  const maskedId = secretContext.aiConnection("masked");
  const unknownId = secretContext.aiConnection("unknown");
  await reviewDb.apiConnectionProfiles.bulkPut([
    {
      id: "masked", label: "Masked", provider: "openai", apiFormat: "responses", baseUrl: "https://example.test", capabilities: ["text"],
      encryptedKey: "", iv: "", maskedKey: "****-only", providerOptions: {}, createdAt: timestamp, updatedAt: timestamp,
    },
    {
      id: "unknown", label: "Unknown", provider: "openai", apiFormat: "responses", baseUrl: "https://example.test", capabilities: ["text"],
      encryptedKey: "v9:opaque", iv: "AAAA", maskedKey: "unknown", providerOptions: {}, createdAt: timestamp, updatedAt: timestamp,
    },
  ] satisfies ApiConnectionProfile[]);
  localStorage.setItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME, "legacy-jwk-fixture");
  desktopStore([maskedId]);
  const inventory = await collectCredentialCleanupInventory();
  const byId = new Map(inventory.sources.filter((item) => item.credentialId).map((item) => [item.credentialId, item]));
  assert.equal(byId.get(maskedId)?.storage, "masked-only");
  assert.equal(byId.get(unknownId)?.storage, "unknown");
  assert.equal(inventory.legacyJwk.present, true);
  assert.equal(inventory.sources.some((item) => item.kind === "desktop-store"), true);
});

test("inventory records malformed durable storage as safe invalid sources", async () => {
  localStorage.setItem(secretStorageLocations.quotaConfigs, "{");
  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify({ profiles: {} }));
  localStorage.setItem(secretStorageLocations.fenbiCredential, "null");

  const inventory = await collectCredentialCleanupInventory();
  const invalidSources = inventory.sources.filter((item) => item.storage === "invalid");
  assert.deepEqual(invalidSources.map((item) => item.sourceId).sort(), [
    "fenbi-storage:invalid",
    "local-storage:mcp-v2:invalid",
    "quota-storage:invalid",
  ]);
  assert.ok(invalidSources.every((item) => item.present && item.recordCount === 1 && item.reasonCodes.includes("invalid_storage_format")));
  assert.equal(cleanupInventoryHasSensitiveFields(inventory), false);
});

test("malformed cleanup journal is recovery-required instead of an idle no-op", () => {
  localStorage.setItem(CREDENTIAL_CLEANUP_STORAGE_KEY, "not-json");
  const journal = readCredentialCleanupJournal();
  assert.equal(journal.state, "recovery_required");
  assert.equal(journal.reasonCode, "journal_inconsistent");
});

test("eligibility blocks every unsafe migration or physical condition and never treats Web authority as Desktop", () => {
  const expected = [secretContext.aiConnection("fixture")];
  const retained = physicalInventory({
    expectedIds: expected,
    sources: [
      source({ sourceId: `${expected[0]}:profile`, credentialId: expected[0], kind: "ai-connection", authority: "desktop_primary" }),
      source({ sourceId: `${expected[0]}:desktop-store`, credentialId: expected[0], kind: "desktop-store", storage: "desktop-v1", storageLocation: "local-storage:desktop", authority: "desktop_primary" }),
    ],
    webKey: "present",
  });
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: { ...retained, migration: { ...retained.migration, present: false } }, host: desktopHost }).reasonCode, "migration_journal_missing");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: { ...retained, migration: { ...retained.migration, state: "recovery_required" } }, host: desktopHost }).reasonCode, "migration_recovery_required");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: { ...retained, migration: { ...retained.migration, backendPolicy: "web_preferred" } }, host: desktopHost }).reasonCode, "migration_not_desktop_preferred");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: { ...retained, migration: { ...retained.migration, authorities: { [expected[0]]: "web_primary" } } }, host: desktopHost }).reasonCode, "web_primary_present");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: { ...retained, desktopCredentialIds: [] }, host: desktopHost }).reasonCode, "missing_desktop_record");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: { ...retained, sources: [source({ sourceId: `${expected[0]}:profile`, credentialId: expected[0], kind: "ai-connection", storage: "unknown", authority: "desktop_primary" })] }, host: desktopHost }).reasonCode, "unknown_storage_format");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: retained, host: { kind: "desktop", status: "unavailable" } }).reasonCode, "desktop_host_unavailable");
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: retained, host: desktopHost, confirmationInventoryVersion: "different" }).reasonCode, "physical_inventory_changed");
});

test("legacy-v1 physical source blocks cleanup before any destructive call", async () => {
  const expected = secretContext.aiConnection("legacy-v1-blocker");
  const inventory = physicalInventory({
    expectedIds: [expected],
    sources: [
      source({
        sourceId: `${expected}:profile`,
        credentialId: expected,
        kind: "ai-connection",
        storage: "legacy-v1",
        authority: "desktop_primary",
      }),
      source({
        sourceId: `${expected}:desktop-store`,
        credentialId: expected,
        kind: "desktop-store",
        storage: "desktop-v1",
        storageLocation: "local-storage:desktop",
        authority: "desktop_primary",
      }),
    ],
    webKey: "present",
    legacyJwk: true,
  });
  const eligibility = evaluateCredentialCleanupEligibility({ inventory, host: desktopHost });
  assert.equal(eligibility.decision, "blocked");
  assert.equal(eligibility.reasonCode, "legacy_source_present");

  let journal = readCredentialCleanupJournal();
  let verifyCalls = 0;
  let cleanSourceCalls = 0;
  let deleteLegacyJwkCalls = 0;
  let deleteWebKeyCalls = 0;
  const result = await executeCredentialCleanup({
    confirmed: true,
    confirmationInventoryVersion: inventory.inventoryVersion,
    dependencies: {
      collectInventory: async () => inventory,
      getHostStatus: async () => desktopHost,
      readJournal: () => journal,
      writeJournal: (next) => { journal = next; return next; },
      verifyDesktop: async (ids) => {
        verifyCalls += 1;
        return { verifiedIds: ids, failedIds: [] };
      },
      cleanSource: async (item) => {
        cleanSourceCalls += 1;
        return { sourceId: item.sourceId, credentialId: item.credentialId, outcome: "cleaned" };
      },
      deleteLegacyJwk: () => {
        deleteLegacyJwkCalls += 1;
        return { sourceId: "review_workspace_crypto_key_v1", outcome: "cleaned" };
      },
      inspectWebKey: async () => "present",
      deleteWebKey: async () => {
        deleteWebKeyCalls += 1;
        return "deleted";
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "legacy_source_present");
  assert.equal(verifyCalls, 0);
  assert.equal(cleanSourceCalls, 0);
  assert.equal(deleteLegacyJwkCalls, 0);
  assert.equal(deleteWebKeyCalls, 0);
  assert.equal(journal.state, "blocked");
});

test("executor requires explicit confirmation before any destructive call", async () => {
  const expected = secretContext.aiConnection("confirmation-boundary");
  const inventory = physicalInventory({ expectedIds: [expected], webKey: "present" });
  let journal = readCredentialCleanupJournal();
  let verifyCalls = 0;
  let sourceCalls = 0;
  let keyDeleteCalls = 0;
  const result = await executeCredentialCleanup({
    confirmationInventoryVersion: inventory.inventoryVersion,
    confirmed: false,
    dependencies: {
      collectInventory: async () => inventory,
      getHostStatus: async () => desktopHost,
      readJournal: () => journal,
      writeJournal: (next) => { journal = next; return next; },
      verifyDesktop: async () => {
        verifyCalls += 1;
        return { verifiedIds: [expected], failedIds: [] };
      },
      cleanSource: async (item) => {
        sourceCalls += 1;
        return { sourceId: item.sourceId, credentialId: item.credentialId, outcome: "cleaned" };
      },
      deleteLegacyJwk: () => ({ sourceId: "review_workspace_crypto_key_v1", outcome: "already_cleaned" }),
      inspectWebKey: async () => "present",
      deleteWebKey: async () => {
        keyDeleteCalls += 1;
        return "deleted";
      },
    },
  });
  assert.equal(result.status, "awaiting_confirmation");
  assert.equal(journal.state, "awaiting_confirmation");
  assert.equal(verifyCalls, 0);
  assert.equal(sourceCalls, 0);
  assert.equal(keyDeleteCalls, 0);
});

test("explicit resume reconciles a partial journal and does not replay an absent source", async () => {
  const expected = secretContext.aiConnection("resume-boundary");
  const sourceId = `${expected}:profile`;
  const inventory = physicalInventory({ expectedIds: [expected], webKey: "present" });
  let journal = writeCredentialCleanupJournal({
    version: 1,
    state: "partial",
    expectedIds: [expected],
    cleanedIds: [expected],
    retainedIds: [],
    inventoryVersion: inventory.inventoryVersion,
    webKeyState: "present",
    sourceStates: { [sourceId]: "cleaned" },
    reasonCode: "source_cleanup_failed",
    updatedAt: timestamp,
  });
  let sourceCalls = 0;
  let keyDeleteCalls = 0;
  let current = {
    ...inventory,
    sources: inventory.sources.filter((item) => item.sourceId !== sourceId),
    inventoryVersion: inventory.inventoryVersion,
  };
  const result = await executeCredentialCleanup({
    confirmed: true,
    resume: true,
    confirmationInventoryVersion: current.inventoryVersion,
    dependencies: {
      collectInventory: async () => current,
      getHostStatus: async () => desktopHost,
      readJournal: () => journal,
      writeJournal: (next) => { journal = next; return next; },
      verifyDesktop: async (ids) => ({ verifiedIds: ids, failedIds: [] }),
      cleanSource: async (item) => {
        sourceCalls += 1;
        return { sourceId: item.sourceId, credentialId: item.credentialId, outcome: "cleaned" };
      },
      deleteLegacyJwk: () => ({ sourceId: "review_workspace_crypto_key_v1", outcome: "already_cleaned" }),
      inspectWebKey: async () => current.webKey.presence,
      deleteWebKey: async () => {
        keyDeleteCalls += 1;
        current = { ...current, webKey: { ...current.webKey, presence: "absent" } };
        return "deleted";
      },
    },
  });
  assert.equal(result.status, "complete");
  assert.equal(sourceCalls, 0);
  assert.equal(keyDeleteCalls, 1);
  assert.equal(journal.state, "complete");
});

test("production execution facade fails closed without confirmation and hides the Web entry", async () => {
  const before = localStorage.getItem(CREDENTIAL_CLEANUP_STORAGE_KEY);
  const awaiting = await executeDesktopCredentialCleanup({
    confirmationInventoryVersion: "fixture",
    confirmationAcknowledged: false,
  });
  assert.equal(awaiting.status, "awaiting_confirmation");
  assert.equal(localStorage.getItem(CREDENTIAL_CLEANUP_STORAGE_KEY), before);

  const web = await executeDesktopCredentialCleanup({
    confirmationInventoryVersion: "fixture",
    confirmationAcknowledged: true,
  });
  assert.equal(web.status, "cancelled");
  assert.equal(web.reasonCode, "cleanup_deferred");
  assert.equal(localStorage.getItem(CREDENTIAL_CLEANUP_STORAGE_KEY), before);
});

test("executor re-reads Desktop Host after verification before the first source delete", async () => {
  const expected = secretContext.aiConnection("stale-host-source-boundary");
  const inventory = physicalInventory({ expectedIds: [expected], webKey: "present" });
  let journal = readCredentialCleanupJournal();
  let hostCalls = 0;
  let verifyCalls = 0;
  let cleanSourceCalls = 0;
  let deleteLegacyJwkCalls = 0;
  let deleteWebKeyCalls = 0;
  const result = await executeCredentialCleanup({
    confirmed: true,
    confirmationInventoryVersion: inventory.inventoryVersion,
    dependencies: {
      collectInventory: async () => inventory,
      getHostStatus: async () => {
        hostCalls += 1;
        return hostCalls === 1 ? desktopHost : { kind: "desktop", status: "unavailable" };
      },
      readJournal: () => journal,
      writeJournal: (next) => { journal = next; return next; },
      verifyDesktop: async (ids) => {
        verifyCalls += 1;
        return { verifiedIds: ids, failedIds: [] };
      },
      cleanSource: async (item) => {
        cleanSourceCalls += 1;
        return { sourceId: item.sourceId, credentialId: item.credentialId, outcome: "cleaned" };
      },
      deleteLegacyJwk: () => {
        deleteLegacyJwkCalls += 1;
        return { sourceId: "review_workspace_crypto_key_v1", outcome: "already_cleaned" };
      },
      inspectWebKey: async () => "present",
      deleteWebKey: async () => {
        deleteWebKeyCalls += 1;
        return "deleted";
      },
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "desktop_host_unavailable");
  assert.equal(hostCalls, 2);
  assert.equal(verifyCalls, 1);
  assert.equal(cleanSourceCalls, 0);
  assert.equal(deleteLegacyJwkCalls, 0);
  assert.equal(deleteWebKeyCalls, 0);
  assert.equal(journal.state, "blocked");
});

test("executor revalidates Host immediately before shared Web key deletion", async () => {
  const expected = secretContext.aiConnection("stale-host-key-boundary");
  let current = physicalInventory({ expectedIds: [expected], webKey: "present" });
  let journal = readCredentialCleanupJournal();
  let hostCalls = 0;
  let cleanSourceCalls = 0;
  let deleteLegacyJwkCalls = 0;
  let deleteWebKeyCalls = 0;
  const result = await executeCredentialCleanup({
    confirmed: true,
    confirmationInventoryVersion: current.inventoryVersion,
    dependencies: {
      collectInventory: async () => current,
      getHostStatus: async () => {
        hostCalls += 1;
        return hostCalls < 3 ? desktopHost : { kind: "desktop", status: "unavailable" };
      },
      readJournal: () => journal,
      writeJournal: (next) => { journal = next; return next; },
      verifyDesktop: async (ids) => ({ verifiedIds: ids, failedIds: [] }),
      cleanSource: async (item) => {
        cleanSourceCalls += 1;
        current = {
          ...current,
          sources: current.sources.filter((sourceItem) => sourceItem.sourceId !== item.sourceId),
          inventoryVersion: "cleanup-after-source-removal",
        };
        return { sourceId: item.sourceId, credentialId: item.credentialId, outcome: "cleaned" };
      },
      deleteLegacyJwk: () => {
        deleteLegacyJwkCalls += 1;
        return { sourceId: "review_workspace_crypto_key_v1", outcome: "already_cleaned" };
      },
      inspectWebKey: async () => current.webKey.presence,
      deleteWebKey: async () => {
        deleteWebKeyCalls += 1;
        return "deleted";
      },
    },
  });
  assert.equal(result.status, "partial");
  assert.equal(result.reasonCode, "desktop_host_unavailable");
  assert.equal(hostCalls, 3);
  assert.equal(cleanSourceCalls, 1);
  assert.equal(deleteLegacyJwkCalls, 0);
  assert.equal(deleteWebKeyCalls, 0);
  assert.equal(journal.state, "partial");
});

test("eligibility separates a future eligible cleanup from already-cleaned state", () => {
  const expected = [secretContext.aiConnection("fixture")];
  const sourceSet = [source({ sourceId: `${expected[0]}:profile`, credentialId: expected[0], kind: "ai-connection", authority: "desktop_primary" }), source({ sourceId: `${expected[0]}:desktop-store`, credentialId: expected[0], kind: "desktop-store", storage: "desktop-v1", storageLocation: "local-storage:desktop", authority: "desktop_primary" })];
  const withKey = physicalInventory({ expectedIds: expected, sources: sourceSet, webKey: "present" });
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: withKey, host: desktopHost }).decision, "eligible");
  const clear = physicalInventory({ expectedIds: expected, sources: [sourceSet[1]], webKey: "absent" });
  assert.equal(evaluateCredentialCleanupEligibility({ inventory: clear, host: desktopHost }).decision, "already_cleaned");
});

test("reconciliation turns post-cleanup reappearance and key ordering failures into recovery_required", () => {
  const expected = secretContext.aiConnection("fixture");
  const inventory = physicalInventory({ expectedIds: [expected], webKey: "present" });
  const journal = writeCredentialCleanupJournal({
    version: 1,
    state: "deleting_web_key",
    expectedIds: [expected],
    cleanedIds: [expected],
    retainedIds: [],
    inventoryVersion: inventory.inventoryVersion,
    webKeyState: "deleted",
    sourceStates: {},
    updatedAt: timestamp,
  });
  const result = reconcileCredentialCleanup(journal, inventory);
  assert.equal(result.state, "recovery_required");
  assert.equal(result.reasonCode, "source_cleanup_failed");
});

test("executor applies reconciliation before any future destructive step", async () => {
  const expected = secretContext.aiConnection("reconcile");
  const inventory = physicalInventory({ expectedIds: [expected], webKey: "present" });
  let journal = writeCredentialCleanupJournal({
    version: 1,
    state: "deleting_sources",
    expectedIds: [expected],
    cleanedIds: [],
    retainedIds: [expected],
    inventoryVersion: "stale-inventory",
    webKeyState: "present",
    sourceStates: {},
    updatedAt: timestamp,
  });
  let verifyCalls = 0;
  let sourceCalls = 0;
  let keyDeleteCalls = 0;
  const result = await executeCredentialCleanup({
    confirmed: true,
    confirmationInventoryVersion: inventory.inventoryVersion,
    dependencies: {
      collectInventory: async () => inventory,
      getHostStatus: async () => desktopHost,
      readJournal: () => journal,
      writeJournal: (next) => { journal = next; return next; },
      verifyDesktop: async () => {
        verifyCalls += 1;
        return { verifiedIds: [expected], failedIds: [] };
      },
      cleanSource: async () => {
        sourceCalls += 1;
        return { sourceId: `${expected}:profile`, credentialId: expected, outcome: "cleaned" };
      },
      deleteLegacyJwk: () => ({ sourceId: "review_workspace_crypto_key_v1", outcome: "already_cleaned" }),
      inspectWebKey: async () => "present",
      deleteWebKey: async () => {
        keyDeleteCalls += 1;
        return "deleted";
      },
    },
  });
  assert.equal(result.status, "recovery_required");
  assert.equal(journal.reasonCode, "physical_inventory_changed");
  assert.equal(verifyCalls, 0);
  assert.equal(sourceCalls, 0);
  assert.equal(keyDeleteCalls, 0);
});

test("isolated executor deletes sources before shared Web key, is idempotent, and leaves migration journal untouched", async () => {
  const expected = secretContext.aiConnection("fixture");
  migrationJournal([expected]);
  desktopStore([expected]);
  let current = physicalInventory({ expectedIds: [expected], webKey: "present" });
  let cleanupJournal = readCredentialCleanupJournal();
  const events: string[] = [];
  let cleanCalls = 0;
  let keyDeleteCalls = 0;
  const dependencies: CredentialCleanupExecutorDependencies = {
    collectInventory: async () => {
      events.push("inventory");
      return current;
    },
    getHostStatus: async () => desktopHost,
    readJournal: () => cleanupJournal,
    writeJournal: (next) => { cleanupJournal = next; return next; },
    verifyDesktop: async (ids) => {
      events.push("verify");
      return { verifiedIds: ids, failedIds: [] };
    },
    cleanSource: async (item) => {
      events.push("source");
      cleanCalls += 1;
      current = { ...current, sources: current.sources.filter((sourceItem) => sourceItem.sourceId !== item.sourceId) };
      return { sourceId: item.sourceId, credentialId: item.credentialId, outcome: "cleaned" };
    },
    deleteLegacyJwk: () => ({ sourceId: "review_workspace_crypto_key_v1", credentialId: expected, outcome: "already_cleaned" }),
    inspectWebKey: async () => current.webKey.presence,
    deleteWebKey: async () => {
      events.push("web-key");
      keyDeleteCalls += 1;
      current = { ...current, webKey: { ...current.webKey, presence: "absent" } };
      return "deleted";
    },
  };
  const first = await executeCredentialCleanup({ confirmed: true, confirmationInventoryVersion: current.inventoryVersion, dependencies });
  assert.equal(first.status, "complete");
  assert.equal(cleanCalls, 1);
  assert.equal(keyDeleteCalls, 1);
  assert.ok(events.indexOf("source") < events.indexOf("web-key"));
  assert.equal(JSON.stringify(cleanupJournal).includes("secret"), false);
  const migrationRaw = localStorage.getItem("review-workspace:credential-migration:v1");
  assert.match(migrationRaw ?? "", /desktop_preferred/);

  const second = await executeCredentialCleanup({ confirmed: true, confirmationInventoryVersion: current.inventoryVersion, dependencies });
  assert.equal(second.status, "already_cleaned");
  assert.equal(cleanCalls, 1);
  assert.equal(keyDeleteCalls, 1);
});

test("source cleanup primitives preserve nonsecret configuration and are independently idempotent", async () => {
  const aiContext = secretContext.aiConnection("primitive");
  const legacyAiContext = secretContext.legacyAiSetting();
  const quotaContext = secretContext.quotaCredential("openai", "apiKey");
  const quotaLegacyContext = secretContext.quotaLegacyCredential("openai");
  const mcpContext = secretContext.mcpToken("primitive-mcp");
  const fenbiContext = secretContext.fenbiCookie();
  migrationJournal([aiContext, legacyAiContext, quotaContext, quotaLegacyContext, mcpContext, fenbiContext]);
  await reviewDb.apiConnectionProfiles.put({
    id: "primitive", label: "Keep profile", provider: "openai", apiFormat: "responses", baseUrl: "https://example.test", capabilities: ["text"],
    encryptedKey: "v2:AAAA", iv: "AAAA", maskedKey: "key...retained", providerOptions: { region: "global" }, createdAt: timestamp, updatedAt: timestamp,
  });
  await reviewDb.apiSettings.put({ id: "default", provider: "openai", baseUrl: "https://example.test", model: "model", encryptedKey: "v2:AAAA", iv: "AAAA", maskedKey: "legacy...retained", updatedAt: timestamp } satisfies ApiSetting);
  localStorage.setItem(secretStorageLocations.quotaConfigs, JSON.stringify([{
    id: "openai", provider: "openai", label: "Quota", enabled: true, encryptedCredentials: { apiKey: { encryptedKey: "v2:AAAA", iv: "AAAA", maskedKey: "quota...retained" } },
    encryptedKey: "v2:AAAA", iv: "AAAA", maskedKey: "legacy...retained", parameters: { teamId: "retain-team" }, currency: "USD", updatedAt: timestamp,
  } satisfies AiQuotaPluginConfig]));
  const mcp: McpServerProfile = { id: "primitive-mcp", label: "Keep MCP", endpoint: "https://mcp.example", enabled: true, authMode: "bearer", encryptedToken: "v2:AAAA", encryptedTokenIv: "AAAA", toolAllowlist: ["keep"], createdAt: timestamp, updatedAt: timestamp };
  localStorage.setItem(secretStorageLocations.mcpSettings, JSON.stringify({ profiles: [mcp], discovery: {} }));
  localStorage.setItem(secretStorageLocations.legacyMcpSettings, JSON.stringify({ profiles: [{ ...mcp, encryptedToken: "v2:BBBB", encryptedTokenIv: "BBBB" }], discovery: {} }));
  localStorage.setItem(secretStorageLocations.fenbiCredential, JSON.stringify({ encryptedCookie: "v2:AAAA", iv: "AAAA", maskedCookie: "cookie...kept", verifiedAt: timestamp, lastSyncScope: "wrong-only" } satisfies FenbiImportCredential));

  await cleanupAiConnectionCredential("primitive");
  await cleanupLegacyAiSettingCredential("primitive");
  await cleanupQuotaCredential("openai", "apiKey");
  await cleanupQuotaCredential("openai", "legacy");
  await cleanupMcpCredential("primitive-mcp", "v2");
  await cleanupMcpCredential("primitive-mcp", "v1");
  await cleanupFenbiCredential();
  const profile = await reviewDb.apiConnectionProfiles.get("primitive");
  const setting = await reviewDb.apiSettings.get("default");
  const quota = JSON.parse(localStorage.getItem(secretStorageLocations.quotaConfigs) ?? "[]")[0] as AiQuotaPluginConfig;
  const mcpAfter = JSON.parse(localStorage.getItem(secretStorageLocations.mcpSettings) ?? "{}").profiles[0] as McpServerProfile;
  const fenbiAfter = JSON.parse(localStorage.getItem(secretStorageLocations.fenbiCredential) ?? "{}") as FenbiImportCredential;
  assert.equal(profile?.baseUrl, "https://example.test");
  assert.equal(profile?.encryptedKey, "");
  assert.equal(setting?.encryptedKey, "");
  assert.equal(quota.parameters?.teamId, "retain-team");
  assert.equal(quota.encryptedCredentials?.apiKey, undefined);
  assert.equal(quota.encryptedKey, undefined);
  assert.equal(mcpAfter.endpoint, "https://mcp.example");
  assert.equal(mcpAfter.authMode, "bearer");
  assert.equal(mcpAfter.encryptedToken, undefined);
  assert.equal(fenbiAfter.encryptedCookie, "");
  assert.equal(fenbiAfter.verifiedAt, undefined);
  const legacyKeyResult = cleanupLegacyLocalCryptoKey({ noLegacySourcesConfirmed: true });
  assert.equal(legacyKeyResult.outcome, "already_cleaned");
  assert.doesNotMatch(JSON.stringify({ profile, setting, quota, mcpAfter, fenbiAfter }), /AAAA|BBBB|key\.\.\.retained|legacy\.\.\.retained|quota\.\.\.retained|cookie\.\.\.kept/);
});

test("shared Web key cleanup is a separate last-step API, idempotent, and never regenerates a replacement key", async () => {
  const { encryptSecret, decryptSecret } = await import("./crypto-service.ts");
  const context = secretContext.aiConnection("key-boundary");
  const encrypted = await encryptSecret("key-boundary-secret", context);
  assert.equal(await inspectPrimaryWebCredentialKey(), "present");
  assert.equal(await deletePrimaryWebCredentialKeyForCleanup({ noWebConsumerConfirmed: true }), "deleted");
  assert.equal(await inspectPrimaryWebCredentialKey(), "absent");
  assert.equal(await deletePrimaryWebCredentialKeyForCleanup({ noWebConsumerConfirmed: true }), "already_absent");
  await assert.rejects(() => decryptSecret(encrypted.encryptedKey, encrypted.iv, context), (error: unknown) => error instanceof Error && "code" in error && error.code === "secure_key_missing");
  assert.equal(await inspectPrimaryWebCredentialKey(), "absent");
});

test("production settings imports only the narrow execution facade and keeps raw cleanup primitives out of UI", async () => {
  const [settings, panel, hook] = await Promise.all([
    readFile(new URL("../features/settings/api-connections-settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/settings/desktop-credential-cleanup-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/settings/use-desktop-credential-cleanup.ts", import.meta.url), "utf8"),
  ]);
  assert.match(settings, /<DesktopCredentialCleanupPanel \/>/);
  assert.match(hook, /reviewCredentialCleanup/);
  assert.match(hook, /executeDesktopCredentialCleanup/);
  assert.match(panel, /type="checkbox"/);
  assert.match(panel, /Confirm and clean/);
  assert.doesNotMatch(`${settings}\n${panel}\n${hook}`, /\bexecuteCredentialCleanup\b|deletePrimaryWebCredentialKeyForCleanup|deleteSecureKeyStore/i);
  assert.doesNotMatch(panel, /sourceId|credentialId|ciphertext|payload|raw|stack|path|url/i);
});
