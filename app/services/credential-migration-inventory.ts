import { reviewDb } from "../db/review-db.ts";
import type { AiQuotaPluginConfig, EncryptedQuotaCredential } from "../types/domains/ai-quota.ts";
import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import {
  LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME,
  CredentialSecurityError,
  decryptSecret,
} from "./crypto-service.ts";
import { readSecurePrimaryKey } from "./secure-key-store.ts";
import {
  CredentialBackendError,
  hasDesktopCredential,
  listDesktopCredentialRecords,
  readCredentialSecret,
  type CredentialReference,
} from "./credential-backend.ts";
import {
  detectCredentialStorageFormat,
  type CredentialStorageFormat,
} from "./credential-storage-format.ts";
import {
  getCredentialAuthority,
  type CredentialAuthority,
} from "./credential-migration-state.ts";
import type { CredentialInventoryItem, CredentialInventoryStorage } from "./credential-migration-planner.ts";
import { secretContext } from "./secret-context.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";
import { attemptStoredSecretsMigration } from "./secret-migration-service.ts";

type InventorySourceKind = "ai-connection" | "legacy-ai-setting" | "quota" | "mcp" | "fenbi" | "desktop-store";

export type CredentialMigrationSource = {
  id: string;
  context: string;
  kind: InventorySourceKind;
  storage: CredentialInventoryStorage;
  sourceVersion: string;
  authority?: CredentialAuthority;
  readWebSecret?: () => Promise<string>;
};

export type CredentialMigrationInventory = {
  expectedIds: string[];
  items: CredentialInventoryItem[];
  records: CredentialMigrationSource[];
  inventoryVersion: string;
};

type McpStoredSnapshot = { profiles?: McpServerProfile[] };

function readLocalJson<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as T;
  } catch {
    return undefined;
  }
}

function hasReference(reference: CredentialReference | undefined): boolean {
  return Boolean(reference?.encryptedKey || reference?.iv);
}

function hasMaskedValue(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return !["未配置", "未配置密钥", "无密钥", "无 Cookie", "未设置", "无鉴权"].includes(value.trim());
}

function referenceOf(encryptedKey: string | undefined, iv: string | undefined): CredentialReference {
  return { encryptedKey, iv };
}

function formatVersion(format: CredentialStorageFormat, updatedAt?: string): string {
  return `${format}:${updatedAt ?? "unknown"}`;
}

function sourcePriority(kind: InventorySourceKind, storage: CredentialInventoryStorage): number {
  const kindPriority = { "ai-connection": 0, "legacy-ai-setting": 1, quota: 2, mcp: 3, fenbi: 4, "desktop-store": 5 }[kind];
  const storagePriority = { "desktop-v1": 0, "web-v2": 1, "legacy-v1": 2, missing: 3, unavailable: 4, "masked-only": 5, invalid: 6, unknown: 7 }[storage];
  return kindPriority * 10 + storagePriority;
}

function mapFormat(format: CredentialStorageFormat, masked: boolean, available: boolean): CredentialInventoryStorage {
  if (format === "missing") return masked ? "masked-only" : "missing";
  if ((format === "web-v2" || format === "legacy-v1") && !available) return "unavailable";
  return format;
}

async function keyAvailable(format: CredentialStorageFormat): Promise<boolean> {
  try {
    if (format === "web-v2") return Boolean(await readSecurePrimaryKey());
    if (format === "legacy-v1") return Boolean(typeof window !== "undefined" && window.localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME));
  } catch {
    return false;
  }
  return true;
}

function sourceReader(context: string, reference: CredentialReference, storage: CredentialInventoryStorage): (() => Promise<string>) | undefined {
  if (storage === "missing" || storage === "masked-only" || storage === "invalid" || storage === "unknown" || storage === "unavailable") return undefined;
  if (storage === "desktop-v1") return () => readCredentialSecret(context, reference);
  return () => decryptSecret(reference.encryptedKey!, reference.iv!, context);
}

function desktopSource(context: string, updatedAt: string, authority?: CredentialAuthority): CredentialMigrationSource {
  return {
    id: context,
    context,
    kind: "desktop-store",
    storage: "desktop-v1",
    sourceVersion: formatVersion("desktop-v1", updatedAt),
    authority,
  };
}

export async function collectCredentialMigrationInventory(): Promise<CredentialMigrationInventory> {
  await attemptStoredSecretsMigration();

  const recordsById = new Map<string, { source: CredentialMigrationSource; priority: number }>();
  const webKeyAvailability = new Map<CredentialStorageFormat, boolean>();

  const addReference = async (input: {
    context: string;
    kind: Exclude<InventorySourceKind, "desktop-store">;
    reference: CredentialReference;
    masked: boolean;
    updatedAt?: string;
  }): Promise<void> => {
    const authority = getCredentialAuthority(input.context);
    if (authority === "desktop_primary") {
      if (hasDesktopCredential(input.context)) {
        const desktop = listDesktopCredentialRecords().find((record) => record.context === input.context);
        const source = desktopSource(input.context, desktop?.updatedAt ?? input.updatedAt ?? "unknown", authority);
        recordsById.set(input.context, { source, priority: sourcePriority(source.kind, source.storage) });
      } else {
        const source: CredentialMigrationSource = {
          id: input.context,
          context: input.context,
          kind: input.kind,
          storage: "missing",
          sourceVersion: "desktop-authority-missing",
          authority,
        };
        recordsById.set(input.context, { source, priority: sourcePriority(source.kind, source.storage) });
      }
      return;
    }

    const format = detectCredentialStorageFormat(input.reference.encryptedKey, input.reference.iv);
    if (!webKeyAvailability.has(format)) webKeyAvailability.set(format, await keyAvailable(format));
    const storage = mapFormat(format, input.masked, webKeyAvailability.get(format)!);
    const source: CredentialMigrationSource = {
      id: input.context,
      context: input.context,
      kind: input.kind,
      storage,
      sourceVersion: formatVersion(format, input.updatedAt),
      authority,
    };
    const reader = sourceReader(input.context, input.reference, storage);
    if (reader) Object.defineProperty(source, "readWebSecret", { value: reader, enumerable: false });
    const priority = sourcePriority(source.kind, source.storage);
    const current = recordsById.get(input.context);
    if (!current || priority < current.priority) recordsById.set(input.context, { source, priority });
  };

  const [profiles, legacySettings] = await Promise.all([
    reviewDb.apiConnectionProfiles.toArray(),
    reviewDb.apiSettings.toArray(),
  ]);
  for (const profile of profiles) {
    await addReference({
      context: secretContext.aiConnection(profile.id),
      kind: "ai-connection",
      reference: referenceOf(profile.encryptedKey, profile.iv),
      masked: hasMaskedValue(profile.maskedKey),
      updatedAt: profile.updatedAt,
    });
  }
  for (const setting of legacySettings) {
    await addReference({
      context: secretContext.legacyAiSetting(),
      kind: "legacy-ai-setting",
      reference: referenceOf(setting.encryptedKey, setting.iv),
      masked: hasMaskedValue(setting.maskedKey),
      updatedAt: setting.updatedAt,
    });
  }

  const quotaConfigs = readLocalJson<AiQuotaPluginConfig[]>(secretStorageLocations.quotaConfigs) ?? [];
  for (const config of Array.isArray(quotaConfigs) ? quotaConfigs : []) {
    for (const [key, credential] of Object.entries(config.encryptedCredentials ?? {})) {
      const stored = credential as EncryptedQuotaCredential | undefined;
      if (!stored && !getCredentialAuthority(secretContext.quotaCredential(config.id, key))) continue;
      await addReference({
        context: secretContext.quotaCredential(config.id, key),
        kind: "quota",
        reference: referenceOf(stored?.encryptedKey, stored?.iv),
        masked: hasMaskedValue(stored?.maskedKey),
        updatedAt: config.updatedAt,
      });
    }
    if (hasReference(referenceOf(config.encryptedKey, config.iv)) || hasMaskedValue(config.maskedKey)) {
      await addReference({
        context: secretContext.quotaLegacyCredential(config.id),
        kind: "quota",
        reference: referenceOf(config.encryptedKey, config.iv),
        masked: hasMaskedValue(config.maskedKey),
        updatedAt: config.updatedAt,
      });
    }
  }

  for (const storageKey of [secretStorageLocations.mcpSettings, secretStorageLocations.legacyMcpSettings]) {
    const snapshot = readLocalJson<McpStoredSnapshot>(storageKey);
    for (const profile of snapshot?.profiles ?? []) {
      if (profile.authMode !== "bearer" && !hasReference(referenceOf(profile.encryptedToken, profile.encryptedTokenIv))) continue;
      await addReference({
        context: secretContext.mcpToken(profile.id),
        kind: "mcp",
        reference: referenceOf(profile.encryptedToken, profile.encryptedTokenIv),
        masked: false,
        updatedAt: profile.updatedAt,
      });
    }
  }

  const fenbi = readLocalJson<FenbiImportCredential>(secretStorageLocations.fenbiCredential);
  if (fenbi && (hasReference(referenceOf(fenbi.encryptedCookie, fenbi.iv)) || hasMaskedValue(fenbi.maskedCookie))) {
    await addReference({
      context: secretContext.fenbiCookie(),
      kind: "fenbi",
      reference: referenceOf(fenbi.encryptedCookie, fenbi.iv),
      masked: hasMaskedValue(fenbi.maskedCookie),
      updatedAt: fenbi.lastSyncAt ?? fenbi.verifiedAt,
    });
  }

  for (const desktop of listDesktopCredentialRecords()) {
    if (!recordsById.has(desktop.context)) recordsById.set(desktop.context, { source: desktopSource(desktop.context, desktop.updatedAt), priority: sourcePriority("desktop-store", "desktop-v1") });
  }

  const records = [...recordsById.values()].map(({ source }) => source).sort((left, right) => left.id.localeCompare(right.id));
  const expectedIds = records.map((record) => record.id);
  const items = records.map(({ id, storage }) => ({ id, storage } satisfies CredentialInventoryItem));
  const inventoryVersion = records.map((record) => `${record.id}=${record.storage}:${record.sourceVersion}:${record.authority ?? "web"}`).join("|");
  return { expectedIds, items, records, inventoryVersion };
}

export function inventoryReadFailure(error: unknown): "requires_reentry" | "invalid" {
  if (error instanceof CredentialBackendError || error instanceof CredentialSecurityError) return "requires_reentry";
  return "invalid";
}
