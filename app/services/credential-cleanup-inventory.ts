import { reviewDb } from "../db/review-db.ts";
import type { AiQuotaPluginConfig, EncryptedQuotaCredential } from "../types/domains/ai-quota.ts";
import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import { inspectCredentialProtection } from "../platform/credential-protection.ts";
import {
  CREDENTIAL_MIGRATION_STORAGE_KEY,
  getCredentialAuthority,
  readCredentialMigrationJournal,
  type CredentialAuthority,
  type CredentialMigrationJournal,
} from "./credential-migration-state.ts";
import {
  CREDENTIAL_CLEANUP_STORAGE_KEY,
  type CredentialCleanupReasonCode,
} from "./credential-cleanup-state.ts";
import {
  detectCredentialStorageFormat,
  isCredentialContext,
  type CredentialStorageFormat,
} from "./credential-storage-format.ts";
import { listDesktopCredentialRecords } from "./credential-backend.ts";
import {
  inspectPrimaryWebCredentialKey,
  type SecurePrimaryWebKeyPresence,
} from "./secure-key-store.ts";
import { LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME } from "./crypto-service.ts";
import { secretContext } from "./secret-context.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";
import { DESKTOP_CLEANUP_MASK, isCredentialMaterialPresent } from "./credential-cleanup-source.ts";

export type CredentialCleanupSourceKind =
  | "ai-connection"
  | "legacy-ai-setting"
  | "quota"
  | "mcp"
  | "fenbi"
  | "desktop-store"
  | "legacy-jwk"
  | "web-key";

export type CredentialCleanupStorageFormat = CredentialStorageFormat | "masked-only" | "legacy-jwk" | "web-key";

export type CredentialCleanupSource = {
  sourceId: string;
  credentialId?: string;
  kind: CredentialCleanupSourceKind;
  storage: CredentialCleanupStorageFormat;
  storageLocation: "review-db:apiConnectionProfiles" | "review-db:apiSettings" | "local-storage:quota" | "local-storage:mcp-v1" | "local-storage:mcp-v2" | "local-storage:fenbi" | "local-storage:desktop" | "local-storage:legacy-jwk" | "indexed-db:web-key";
  classification: "per-record" | "shared";
  authority?: CredentialAuthority;
  present: boolean;
  recordCount: number;
  reasonCodes: CredentialCleanupReasonCode[];
};

export type CredentialCleanupMigrationFacts = {
  present: boolean;
  state: CredentialMigrationJournal["state"];
  backendPolicy: CredentialMigrationJournal["backendPolicy"];
  expectedIds: string[];
  stagedIds: string[];
  committedIds: string[];
  authorities: Record<string, CredentialAuthority>;
  inventoryVersion: string;
};

export type CredentialCleanupInventory = {
  version: "credential-cleanup-physical-v1";
  sources: CredentialCleanupSource[];
  observedCredentialIds: string[];
  desktopCredentialIds: string[];
  canonicalAiCredentialIds: string[];
  migration: CredentialCleanupMigrationFacts;
  webKey: {
    sourceId: "primary-aes-gcm-v2";
    storage: "web-key";
    presence: SecurePrimaryWebKeyPresence;
    classification: "shared";
    reasonCodes: CredentialCleanupReasonCode[];
  };
  legacyJwk: {
    sourceId: "review_workspace_crypto_key_v1";
    storage: "legacy-jwk";
    present: boolean;
    classification: "shared";
    reasonCodes: CredentialCleanupReasonCode[];
  };
  inventoryVersion: string;
};

type McpStoredSnapshot = { profiles?: McpServerProfile[] };
type CredentialFieldState = {
  storage: CredentialCleanupStorageFormat;
  present: boolean;
  reasonCodes: CredentialCleanupReasonCode[];
};

type LocalJsonSnapshot<T> = { present: boolean; invalid: boolean; value?: T };
type CleanupAiProfile = { id: string; encryptedKey: string; iv: string; maskedKey: string; updatedAt: string };
type CleanupLegacySetting = { encryptedKey: string; iv: string; maskedKey: string; updatedAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOptionalStringFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => value[field] === undefined || typeof value[field] === "string");
}

function isValidAiProfile(value: unknown): value is CleanupAiProfile {
  if (!isRecord(value) || typeof value.id !== "string" || !isCredentialContext(secretContext.aiConnection(value.id))) return false;
  return typeof value.encryptedKey === "string"
    && typeof value.iv === "string"
    && typeof value.maskedKey === "string"
    && typeof value.updatedAt === "string";
}

function isValidLegacySetting(value: unknown): value is CleanupLegacySetting {
  return isRecord(value)
    && typeof value.encryptedKey === "string"
    && typeof value.iv === "string"
    && typeof value.maskedKey === "string"
    && typeof value.updatedAt === "string";
}

function isValidQuotaConfig(value: unknown): value is AiQuotaPluginConfig {
  if (!isRecord(value) || typeof value.id !== "string" || !hasOptionalStringFields(value, ["encryptedKey", "iv", "maskedKey"])) return false;
  if (value.encryptedCredentials === undefined) return true;
  if (!isRecord(value.encryptedCredentials)) return false;
  return Object.entries(value.encryptedCredentials).every(([key, credential]) => (
    ["apiKey", "adminKey", "managementKey"].includes(key)
      && isRecord(credential)
      && hasOptionalStringFields(credential, ["encryptedKey", "iv", "maskedKey"])
  ));
}

function isValidMcpProfile(value: unknown): value is McpServerProfile {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.endpoint !== "string") return false;
  return hasOptionalStringFields(value, ["encryptedToken", "encryptedTokenIv"]);
}

function isValidMcpSnapshot(value: unknown): value is McpStoredSnapshot {
  return isRecord(value)
    && Array.isArray(value.profiles)
    && value.profiles.every(isValidMcpProfile);
}

function isValidFenbiCredential(value: unknown): value is FenbiImportCredential {
  return isRecord(value)
    && typeof value.encryptedCookie === "string"
    && typeof value.iv === "string"
    && typeof value.maskedCookie === "string";
}

function readLocalJson<T>(key: string): LocalJsonSnapshot<T> {
  if (typeof window === "undefined") return { present: false, invalid: false };
  const present = hasLocalStorageKey(key);
  if (!present) return { present: false, invalid: false };
  try {
    return { present: true, invalid: false, value: JSON.parse(window.localStorage.getItem(key) ?? "null") as T };
  } catch {
    return { present: true, invalid: true };
  }
}

function hasMaskedValue(value: string | undefined): boolean {
  return Boolean(value?.trim() && value.trim() !== DESKTOP_CLEANUP_MASK);
}

function authorityFor(context: string | undefined): CredentialAuthority | undefined {
  return context ? getCredentialAuthority(context) : undefined;
}

function sourceId(context: string | undefined, suffix: string): string {
  return context ? `${context}:${suffix}` : `${suffix}:invalid`;
}

function fieldState(encryptedKey?: string, iv?: string, maskedValue?: string): CredentialFieldState {
  const storage = detectCredentialStorageFormat(encryptedKey, iv);
  if (storage === "missing") {
    return hasMaskedValue(maskedValue)
      ? { storage: "masked-only", present: true, reasonCodes: ["credential_requires_reentry"] }
      : { storage, present: false, reasonCodes: [] };
  }
  const reasonCodes: CredentialCleanupReasonCode[] = storage === "legacy-v1"
    ? ["legacy_source_present"]
    : storage === "unknown"
      ? ["unknown_storage_format"]
      : storage === "invalid"
        ? ["invalid_storage_format"]
        : [];
  return { storage, present: isCredentialMaterialPresent(encryptedKey, iv, maskedValue), reasonCodes };
}

function addSource(sources: CredentialCleanupSource[], source: CredentialCleanupSource): void {
  sources.push(source);
}

function validContext(value: string): string | undefined {
  return isCredentialContext(value) ? value : undefined;
}

function hasLocalStorageKey(key: string): boolean {
  if (typeof window === "undefined") return false;
  for (let index = 0; index < window.localStorage.length; index += 1) {
    if (window.localStorage.key(index) === key) return true;
  }
  return false;
}

function addCredentialFieldSource(
  sources: CredentialCleanupSource[],
  input: {
    context: string;
    kind: Exclude<CredentialCleanupSourceKind, "desktop-store" | "legacy-jwk" | "web-key">;
    location: CredentialCleanupSource["storageLocation"];
    suffix: string;
    field: CredentialFieldState;
    authority?: CredentialAuthority;
  },
): void {
  const credentialId = validContext(input.context);
  const reasonCodes = [...input.field.reasonCodes];
  if (!credentialId) reasonCodes.push("invalid_storage_format");
  addSource(sources, {
    sourceId: sourceId(credentialId, input.suffix),
    credentialId,
    kind: input.kind,
    storage: input.field.storage,
    storageLocation: input.location,
    classification: "per-record",
    authority: input.authority,
    present: input.field.present,
    recordCount: input.field.present ? 1 : 0,
    reasonCodes: [...new Set(reasonCodes)],
  });
}

function migrationFacts(): CredentialCleanupMigrationFacts {
  const journal = readCredentialMigrationJournal();
  const rawPresent = hasLocalStorageKey(CREDENTIAL_MIGRATION_STORAGE_KEY);
  return {
    present: rawPresent,
    state: journal.state,
    backendPolicy: journal.backendPolicy,
    expectedIds: [...journal.expectedIds],
    stagedIds: [...journal.stagedIds],
    committedIds: [...journal.committedIds],
    authorities: { ...journal.authorities },
    inventoryVersion: journal.inventoryVersion,
  };
}

function addAiSources(sources: CredentialCleanupSource[], profiles: CleanupAiProfile[], legacySettings: CleanupLegacySetting[]): void {
  for (const profile of profiles) {
    const context = secretContext.aiConnection(profile.id);
    const field = fieldState(profile.encryptedKey, profile.iv, profile.maskedKey);
    addCredentialFieldSource(sources, {
      context,
      kind: "ai-connection",
      location: "review-db:apiConnectionProfiles",
      suffix: "profile",
      field,
      authority: authorityFor(context),
    });
  }
  for (const setting of legacySettings) {
    const context = secretContext.legacyAiSetting();
    addCredentialFieldSource(sources, {
      context,
      kind: "legacy-ai-setting",
      location: "review-db:apiSettings",
      suffix: "compatibility",
      field: fieldState(setting.encryptedKey, setting.iv, setting.maskedKey),
      authority: authorityFor(context),
    });
  }
}

function addQuotaSources(sources: CredentialCleanupSource[], configs: AiQuotaPluginConfig[]): void {
  for (const config of configs) {
    for (const [credentialKey, credential] of Object.entries(config.encryptedCredentials ?? {})) {
      const stored = credential as EncryptedQuotaCredential | undefined;
      const context = secretContext.quotaCredential(config.id, credentialKey);
      addCredentialFieldSource(sources, {
        context,
        kind: "quota",
        location: "local-storage:quota",
        suffix: `credential:${credentialKey}`,
        field: fieldState(stored?.encryptedKey, stored?.iv, stored?.maskedKey),
        authority: authorityFor(context),
      });
    }
    if (isCredentialMaterialPresent(config.encryptedKey, config.iv, config.maskedKey)) {
      const context = secretContext.quotaLegacyCredential(config.id);
      addCredentialFieldSource(sources, {
        context,
        kind: "quota",
        location: "local-storage:quota",
        suffix: "legacy",
        field: fieldState(config.encryptedKey, config.iv, config.maskedKey),
        authority: authorityFor(context),
      });
    }
  }
}

function addMcpSources(sources: CredentialCleanupSource[], storageKey: typeof secretStorageLocations.mcpSettings | typeof secretStorageLocations.legacyMcpSettings, profiles: McpServerProfile[]): void {
  const location = storageKey === secretStorageLocations.mcpSettings ? "local-storage:mcp-v2" : "local-storage:mcp-v1";
  for (const profile of profiles) {
    if (!isCredentialMaterialPresent(profile.encryptedToken, profile.encryptedTokenIv)) continue;
    const context = secretContext.mcpToken(profile.id);
    addCredentialFieldSource(sources, {
      context,
      kind: "mcp",
      location,
      suffix: `profile:${storageKey.endsWith(":v2") ? "v2" : "v1"}`,
      field: fieldState(profile.encryptedToken, profile.encryptedTokenIv),
      authority: authorityFor(context),
    });
  }
}

function addFenbiSource(sources: CredentialCleanupSource[], credential: FenbiImportCredential | undefined): void {
  if (!credential || !isCredentialMaterialPresent(credential.encryptedCookie, credential.iv, credential.maskedCookie)) return;
  const context = secretContext.fenbiCookie();
  addCredentialFieldSource(sources, {
    context,
    kind: "fenbi",
    location: "local-storage:fenbi",
    suffix: "cookie",
    field: fieldState(credential.encryptedCookie, credential.iv, credential.maskedCookie),
    authority: authorityFor(context),
  });
}

function addInvalidStorageSource(
  sources: CredentialCleanupSource[],
  invalidSourceId: string,
  kind: Exclude<CredentialCleanupSourceKind, "legacy-jwk" | "web-key">,
  location: CredentialCleanupSource["storageLocation"],
): void {
  addSource(sources, {
    sourceId: invalidSourceId,
    kind,
    storage: "invalid",
    storageLocation: location,
    classification: "shared",
    present: true,
    recordCount: 1,
    reasonCodes: ["invalid_storage_format"],
  });
}

function sourceFacts(source: CredentialCleanupSource): string {
  return [source.sourceId, source.credentialId ?? "", source.kind, source.storage, source.storageLocation, source.authority ?? "none", String(source.present), String(source.recordCount), source.reasonCodes.join(",")].join("=");
}

function buildInventoryVersion(sources: CredentialCleanupSource[], migration: CredentialCleanupMigrationFacts, webKey: SecurePrimaryWebKeyPresence, legacyJwkPresent: boolean): string {
  return [
    ...sources.map(sourceFacts).sort(),
    `migration=${migration.present}:${migration.state}:${migration.backendPolicy}:${migration.expectedIds.join(",")}:${migration.committedIds.join(",")}:${migration.inventoryVersion}`,
    `web-key=${webKey}`,
    `legacy-jwk=${legacyJwkPresent}`,
  ].join("|");
}

/** 只读取各 durable source；不会解密、迁移、生成 key、改 journal 或删除任何记录。*/
export async function collectCredentialCleanupInventory(): Promise<CredentialCleanupInventory> {
  const migration = migrationFacts();
  const sources: CredentialCleanupSource[] = [];
  let desktopStoreInvalid = false;
  let apiProfilesInvalid = false;
  let apiSettingsInvalid = false;
  const [profiles, legacySettings, webKey, desktopRecords] = await Promise.all([
    reviewDb.apiConnectionProfiles.toArray().catch(() => {
      apiProfilesInvalid = true;
      return [];
    }),
    reviewDb.apiSettings.toArray().catch(() => {
      apiSettingsInvalid = true;
      return [];
    }),
    inspectPrimaryWebCredentialKey(),
    Promise.resolve().then(() => listDesktopCredentialRecords()).catch(() => {
      desktopStoreInvalid = true;
      return [];
    }),
  ]);
  if (apiProfilesInvalid || profiles.some((profile) => !isValidAiProfile(profile))) {
    addInvalidStorageSource(sources, "review-db:apiConnectionProfiles:invalid", "ai-connection", "review-db:apiConnectionProfiles");
  }
  if (apiSettingsInvalid || legacySettings.some((setting) => !isValidLegacySetting(setting))) {
    addInvalidStorageSource(sources, "review-db:apiSettings:invalid", "legacy-ai-setting", "review-db:apiSettings");
  }
  addAiSources(sources, profiles.filter(isValidAiProfile), legacySettings.filter(isValidLegacySetting));
  const quotaSnapshot = readLocalJson<AiQuotaPluginConfig[]>(secretStorageLocations.quotaConfigs);
  if (quotaSnapshot.invalid || (quotaSnapshot.present && (!Array.isArray(quotaSnapshot.value) || quotaSnapshot.value.some((config) => !isValidQuotaConfig(config))))) {
    addInvalidStorageSource(sources, "quota-storage:invalid", "quota", "local-storage:quota");
  } else {
    addQuotaSources(sources, quotaSnapshot.value ?? []);
  }
  for (const storageKey of [secretStorageLocations.mcpSettings, secretStorageLocations.legacyMcpSettings]) {
    const snapshot = readLocalJson<McpStoredSnapshot>(storageKey);
    const location = storageKey === secretStorageLocations.mcpSettings ? "local-storage:mcp-v2" : "local-storage:mcp-v1";
    if (snapshot.invalid || (snapshot.present && !isValidMcpSnapshot(snapshot.value))) {
      addInvalidStorageSource(sources, `${location}:invalid`, "mcp", location);
    } else {
      addMcpSources(sources, storageKey, snapshot.value?.profiles ?? []);
    }
  }
  const fenbiSnapshot = readLocalJson<FenbiImportCredential>(secretStorageLocations.fenbiCredential);
  if (fenbiSnapshot.invalid || (fenbiSnapshot.present && !isValidFenbiCredential(fenbiSnapshot.value))) {
    addInvalidStorageSource(sources, "fenbi-storage:invalid", "fenbi", "local-storage:fenbi");
  } else {
    addFenbiSource(sources, fenbiSnapshot.value);
  }

  const legacyJwkPresent = hasLocalStorageKey(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME);
  addSource(sources, {
    sourceId: "primary-aes-gcm-v2",
    kind: "web-key",
    storage: "web-key",
    storageLocation: "indexed-db:web-key",
    classification: "shared",
    present: webKey === "present",
    recordCount: webKey === "present" ? 1 : 0,
    reasonCodes: webKey === "unavailable" ? ["invalid_storage_format"] : [],
  });
  // Use the already-read Desktop snapshot so inventory remains one physical observation.
  if (desktopStoreInvalid) {
    addInvalidStorageSource(sources, "desktop-store:invalid", "desktop-store", "local-storage:desktop");
  }
  for (const record of desktopRecords) {
    const context = validContext(record.context);
    addSource(sources, {
      sourceId: sourceId(context, "desktop-store"),
      credentialId: context,
      kind: "desktop-store",
      storage: "desktop-v1",
      storageLocation: "local-storage:desktop",
      classification: "per-record",
      authority: context ? migration.authorities[context] : undefined,
      present: Boolean(context),
      recordCount: context ? 1 : 0,
      reasonCodes: context ? [] : ["invalid_storage_format"],
    });
  }
  // The shared JWK is discovered by presence only; its content is never read.
  addSource(sources, {
    sourceId: "review_workspace_crypto_key_v1",
    kind: "legacy-jwk",
    storage: "legacy-jwk",
    storageLocation: "local-storage:legacy-jwk",
    classification: "shared",
    present: legacyJwkPresent,
    recordCount: legacyJwkPresent ? 1 : 0,
    reasonCodes: legacyJwkPresent ? ["legacy_source_present"] : [],
  });

  const observedCredentialIds = [...new Set(sources.flatMap((source) => source.present && source.credentialId ? [source.credentialId] : []))].sort();
  const desktopCredentialIds = [...new Set(sources.flatMap((source) => source.kind === "desktop-store" && source.present && source.credentialId ? [source.credentialId] : []))].sort();
  const canonicalAiCredentialIds = [...new Set(sources.flatMap((source) => source.kind === "ai-connection" && source.present && source.credentialId ? [source.credentialId] : []))].sort();
  return {
    version: "credential-cleanup-physical-v1",
    sources: sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    observedCredentialIds,
    desktopCredentialIds,
    canonicalAiCredentialIds,
    migration,
    webKey: {
      sourceId: "primary-aes-gcm-v2",
      storage: "web-key",
      presence: webKey,
      classification: "shared",
      reasonCodes: webKey === "unavailable" ? ["invalid_storage_format"] : [],
    },
    legacyJwk: {
      sourceId: "review_workspace_crypto_key_v1",
      storage: "legacy-jwk",
      present: legacyJwkPresent,
      classification: "shared",
      reasonCodes: legacyJwkPresent ? ["legacy_source_present"] : [],
    },
    inventoryVersion: buildInventoryVersion(sources, migration, webKey, legacyJwkPresent),
  };
}

export function isRetainedWebSource(source: CredentialCleanupSource): boolean {
  return source.present && source.kind !== "desktop-store" && source.kind !== "web-key" && source.kind !== "legacy-jwk"
    && (source.storage === "web-v2" || source.storage === "legacy-v1" || source.storage === "masked-only" || source.storage === "invalid" || source.storage === "unknown" || source.storage === "missing");
}

export function isCredentialCleanupJournalPresent(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(CREDENTIAL_CLEANUP_STORAGE_KEY) !== null;
}

export function cleanupInventoryHasSensitiveFields(inventory: CredentialCleanupInventory): boolean {
  return /(?:encryptedKey|encryptedToken|encryptedCookie|ciphertext|payload|secret|iv|hash|path|url)/i.test(JSON.stringify(inventory));
}

export async function getCleanupHostStatus(): Promise<{ kind: "desktop" | "web" | "server"; status: "available" | "unavailable" | "unsupported" | "temporarily_unavailable" }> {
  if (typeof window === "undefined") return { kind: "server", status: "unavailable" };
  try {
    const inspection = await inspectCredentialProtection();
    if (inspection.backend !== "desktop_host") return { kind: "web", status: "available" };
    return { kind: "desktop", status: inspection.status };
  } catch {
    return { kind: "desktop", status: "unavailable" };
  }
}
