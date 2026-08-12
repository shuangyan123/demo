import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto-service.ts";
import { secretContext } from "./secret-context.ts";
import { ensureStoredSecretsMigrated } from "./secret-migration-service.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";
import { normalizeFenbiCookie } from "./fenbi-cookie.ts";
import { assertSettingsPluginEnabled } from "./settings-plugin-preferences-repository.ts";

export const FENBI_CREDENTIAL_STORAGE_KEY = secretStorageLocations.fenbiCredential;

function readCredential(): FenbiImportCredential | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY) ?? "null") as FenbiImportCredential | null;
    return parsed?.encryptedCookie && parsed.iv ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCredential(credential: FenbiImportCredential): void {
  window.localStorage.setItem(FENBI_CREDENTIAL_STORAGE_KEY, JSON.stringify(credential));
}

/** 粉笔 Cookie 只存本机 localStorage 密文，不进入 Dexie、导出或 React 长期状态。 */
export const fenbiCredentialRepository = {
  load(): FenbiImportCredential | undefined {
    return readCredential();
  },

  async save(cookie: string): Promise<FenbiImportCredential> {
    assertSettingsPluginEnabled("fenbi-import");
    await ensureStoredSecretsMigrated();
    const normalized = normalizeFenbiCookie(cookie);
    const encrypted = await encryptSecret(normalized, secretContext.fenbiCookie());
    const credential: FenbiImportCredential = {
      encryptedCookie: encrypted.encryptedKey,
      iv: encrypted.iv,
      maskedCookie: maskSecret(normalized),
    };
    writeCredential(credential);
    return credential;
  },

  async reveal(): Promise<string> {
    assertSettingsPluginEnabled("fenbi-import");
    await ensureStoredSecretsMigrated();
    const credential = readCredential();
    if (!credential) throw new Error("请先配置粉笔 Cookie");
    return decryptSecret(credential.encryptedCookie, credential.iv, secretContext.fenbiCookie());
  },

  markVerified(verifiedAt: string): FenbiImportCredential | undefined {
    const credential = readCredential();
    if (!credential) return undefined;
    const updated = { ...credential, verifiedAt };
    writeCredential(updated);
    return updated;
  },

  markUnverified(): FenbiImportCredential | undefined {
    const credential = readCredential();
    if (!credential) return undefined;
    const updated = { ...credential, verifiedAt: undefined };
    writeCredential(updated);
    return updated;
  },

  markSynced(syncedAt: string, scope: string): FenbiImportCredential | undefined {
    const credential = readCredential();
    if (!credential) return undefined;
    const updated = { ...credential, lastSyncAt: syncedAt, lastSyncScope: scope };
    writeCredential(updated);
    return updated;
  },

  clear(): void {
    if (typeof window !== "undefined") window.localStorage.removeItem(FENBI_CREDENTIAL_STORAGE_KEY);
  },
};
