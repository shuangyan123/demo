import { reviewDb } from "../db/review-db.ts";
import type { AiQuotaPluginConfig } from "../types/domains/ai-quota.ts";
import type { ApiConnectionProfile, ApiSetting } from "../types/domains/ai-connection.ts";
import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import {
  CredentialSecurityError,
  decryptSecret,
  encryptSecret,
  isLegacyEncryptedSecret,
  LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME,
  type CredentialSecurityErrorCode,
} from "./crypto-service.ts";
import { secretContext } from "./secret-context.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";

type McpStoredSnapshot = {
  profiles?: McpServerProfile[];
  discovery?: Record<string, unknown>;
};

let migrationPromise: Promise<void> | undefined;

export type StoredSecretMigrationAttempt =
  | { status: "complete" }
  | {
      status: "partial";
      code: CredentialSecurityErrorCode | "migration_failed";
      message: string;
    };

function readLocalJson<T>(key: string): T | undefined {
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function writeLocalJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function migrateCipher(encryptedKey: string, iv: string, context: string) {
  if (!isLegacyEncryptedSecret(encryptedKey)) return { encryptedKey, iv, changed: false };
  const plainText = await decryptSecret(encryptedKey, iv, context);
  return { ...(await encryptSecret(plainText, context)), changed: true };
}

/** 迁移 Dexie 中的连接档案和旧单连接桥；转换全部成功后再批量落库。 */
async function migrateDatabaseSecrets(): Promise<void> {
  const [profiles, legacySettings] = await Promise.all([
    reviewDb.apiConnectionProfiles.toArray(),
    reviewDb.apiSettings.toArray(),
  ]);
  const nextProfiles: ApiConnectionProfile[] = [];
  for (const profile of profiles) {
    const migrated = await migrateCipher(profile.encryptedKey, profile.iv, secretContext.aiConnection(profile.id));
    if (migrated.changed) nextProfiles.push({ ...profile, encryptedKey: migrated.encryptedKey, iv: migrated.iv });
  }
  const nextLegacySettings: ApiSetting[] = [];
  for (const setting of legacySettings) {
    const migrated = await migrateCipher(setting.encryptedKey, setting.iv, secretContext.legacyAiSetting());
    if (migrated.changed) nextLegacySettings.push({ ...setting, encryptedKey: migrated.encryptedKey, iv: migrated.iv });
  }
  if (!nextProfiles.length && !nextLegacySettings.length) return;
  await reviewDb.transaction("rw", [reviewDb.apiConnectionProfiles, reviewDb.apiSettings], async () => {
    if (nextProfiles.length) await reviewDb.apiConnectionProfiles.bulkPut(nextProfiles);
    if (nextLegacySettings.length) await reviewDb.apiSettings.bulkPut(nextLegacySettings);
  });
}

/** 迁移额度插件的分字段凭据和旧单密钥字段。 */
async function migrateQuotaSecrets(): Promise<void> {
  const configs = readLocalJson<AiQuotaPluginConfig[]>(secretStorageLocations.quotaConfigs);
  if (!Array.isArray(configs)) return;
  let changed = false;
  const nextConfigs = [];
  for (const config of configs) {
    const encryptedCredentials = { ...(config.encryptedCredentials ?? {}) };
    for (const [credentialKey, credential] of Object.entries(encryptedCredentials)) {
      if (!credential) continue;
      const migrated = await migrateCipher(
        credential.encryptedKey,
        credential.iv,
        secretContext.quotaCredential(config.id, credentialKey),
      );
      if (migrated.changed) {
        changed = true;
        encryptedCredentials[credentialKey as keyof typeof encryptedCredentials] = {
          ...credential,
          encryptedKey: migrated.encryptedKey,
          iv: migrated.iv,
        };
      }
    }
    let encryptedKey = config.encryptedKey;
    let iv = config.iv;
    if (encryptedKey && iv) {
      const migrated = await migrateCipher(encryptedKey, iv, secretContext.quotaLegacyCredential(config.id));
      encryptedKey = migrated.encryptedKey;
      iv = migrated.iv;
      changed ||= migrated.changed;
    }
    nextConfigs.push({ ...config, encryptedCredentials, encryptedKey, iv });
  }
  if (changed) writeLocalJson(secretStorageLocations.quotaConfigs, nextConfigs);
}

/** 同时迁移当前和历史 MCP 设置，保证旧存储键不会阻止安全删除旧主密钥。 */
async function migrateMcpSecretsAt(storageKey: string): Promise<void> {
  const snapshot = readLocalJson<McpStoredSnapshot>(storageKey);
  if (!snapshot || !Array.isArray(snapshot.profiles)) return;
  let changed = false;
  const profiles = [];
  for (const profile of snapshot.profiles) {
    if (!profile.encryptedToken || !profile.encryptedTokenIv) {
      profiles.push(profile);
      continue;
    }
    const migrated = await migrateCipher(
      profile.encryptedToken,
      profile.encryptedTokenIv,
      secretContext.mcpToken(profile.id),
    );
    changed ||= migrated.changed;
    profiles.push({
      ...profile,
      encryptedToken: migrated.encryptedKey,
      encryptedTokenIv: migrated.iv,
    });
  }
  if (changed) writeLocalJson(storageKey, { ...snapshot, profiles });
}

async function migrateFenbiSecret(): Promise<void> {
  const credential = readLocalJson<FenbiImportCredential>(secretStorageLocations.fenbiCredential);
  if (!credential?.encryptedCookie || !credential.iv) return;
  const migrated = await migrateCipher(
    credential.encryptedCookie,
    credential.iv,
    secretContext.fenbiCookie(),
  );
  if (migrated.changed) {
    writeLocalJson(secretStorageLocations.fenbiCredential, {
      ...credential,
      encryptedCookie: migrated.encryptedKey,
      iv: migrated.iv,
    });
  }
}

/** 复核所有共享旧主密钥的存储位置，只有完全迁移后才删除可导出 JWK。 */
async function hasLegacySecrets(): Promise<boolean> {
  const [profiles, settings] = await Promise.all([
    reviewDb.apiConnectionProfiles.toArray(),
    reviewDb.apiSettings.toArray(),
  ]);
  if (profiles.some((item) => isLegacyEncryptedSecret(item.encryptedKey))) return true;
  if (settings.some((item) => isLegacyEncryptedSecret(item.encryptedKey))) return true;

  const quota = readLocalJson<AiQuotaPluginConfig[]>(secretStorageLocations.quotaConfigs);
  if (Array.isArray(quota) && quota.some((config) => {
    if (isLegacyEncryptedSecret(config.encryptedKey)) return true;
    return Object.values(config.encryptedCredentials ?? {}).some((item) => isLegacyEncryptedSecret(item?.encryptedKey));
  })) return true;

  for (const key of [secretStorageLocations.mcpSettings, secretStorageLocations.legacyMcpSettings]) {
    const snapshot = readLocalJson<McpStoredSnapshot>(key);
    if (snapshot?.profiles?.some((profile) => isLegacyEncryptedSecret(profile.encryptedToken))) return true;
  }
  const fenbi = readLocalJson<FenbiImportCredential>(secretStorageLocations.fenbiCredential);
  return isLegacyEncryptedSecret(fenbi?.encryptedCookie);
}

/** 应用启动和各凭据仓储入口共用的幂等迁移门；失败时保留旧数据和旧 JWK。 */
export function ensureStoredSecretsMigrated(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (!window.localStorage.getItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME)) return;
    await migrateDatabaseSecrets();
    await migrateQuotaSecrets();
    await migrateMcpSecretsAt(secretStorageLocations.mcpSettings);
    await migrateMcpSecretsAt(secretStorageLocations.legacyMcpSettings);
    await migrateFenbiSecret();
    if (!(await hasLegacySecrets())) {
      window.localStorage.removeItem(LEGACY_LOCAL_CRYPTO_KEY_STORAGE_NAME);
    }
  })().catch((error) => {
    migrationPromise = undefined;
    throw error;
  });
  return migrationPromise;
}

/** 尽力迁移共享旧凭据；单条旧记录损坏时允许新凭据继续使用 v2 密钥库保存。 */
export async function attemptStoredSecretsMigration(): Promise<StoredSecretMigrationAttempt> {
  try {
    await ensureStoredSecretsMigrated();
    return { status: "complete" };
  } catch (error) {
    if (error instanceof CredentialSecurityError) {
      return { status: "partial", code: error.code, message: error.message };
    }
    return {
      status: "partial",
      code: "migration_failed",
      message: "部分旧凭据暂时无法迁移，请在对应设置中重新输入后保存",
    };
  }
}

/** 测试隔离使用；不会修改任何持久化凭据。 */
export function resetSecretMigrationForTests(): void {
  migrationPromise = undefined;
}
