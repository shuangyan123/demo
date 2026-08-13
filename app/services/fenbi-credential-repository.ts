import type { FenbiImportCredential } from "../types/domains/fenbi-import.ts";
import { maskSecret } from "./crypto-service.ts";
import { clearDesktopCredential, hasCredentialReference, readCredentialSecret, writeCredentialSecret } from "./credential-backend.ts";
import { secretContext } from "./secret-context.ts";
import { ensureStoredSecretsMigrated } from "./secret-migration-service.ts";
import { secretStorageLocations } from "./secret-storage-locations.ts";
import { normalizeFenbiCookie } from "./fenbi-cookie.ts";
import { assertSettingsPluginEnabled } from "./settings-plugin-preferences-repository.ts";
import {
  assertDesktopCleanupAuthority,
  cleanupSourceResult,
  DESKTOP_CLEANUP_MASK,
  CredentialCleanupSourceError,
  isCredentialMaterialPresent,
} from "./credential-cleanup-source.ts";

export const FENBI_CREDENTIAL_STORAGE_KEY = secretStorageLocations.fenbiCredential;

export async function cleanupFenbiCredential() {
  const context = secretContext.fenbiCookie();
  assertDesktopCleanupAuthority(context);
  if (typeof window === "undefined") throw new CredentialCleanupSourceError("source_unavailable");
  const raw = window.localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY);
  if (!raw) return cleanupSourceResult(`${context}:cookie`, context, "already_cleaned");
  let credential: FenbiImportCredential;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid Fenbi credential");
    const record = parsed as Record<string, unknown>;
    if (typeof record.encryptedCookie !== "string" || typeof record.iv !== "string" || typeof record.maskedCookie !== "string") {
      throw new Error("invalid Fenbi credential");
    }
    credential = record as unknown as FenbiImportCredential;
  } catch {
    throw new CredentialCleanupSourceError("source_format_invalid");
  }
  if (!isCredentialMaterialPresent(credential.encryptedCookie, credential.iv, credential.maskedCookie)) {
    return cleanupSourceResult(`${context}:cookie`, context, "already_cleaned");
  }
  try {
    window.localStorage.setItem(FENBI_CREDENTIAL_STORAGE_KEY, JSON.stringify({
      ...credential,
      encryptedCookie: "",
      iv: "",
      maskedCookie: DESKTOP_CLEANUP_MASK,
      verifiedAt: undefined,
    }));
  } catch {
    throw new CredentialCleanupSourceError("source_write_failed");
  }
  return cleanupSourceResult(`${context}:cookie`, context, "cleaned");
}

function readCredential(): FenbiImportCredential | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FENBI_CREDENTIAL_STORAGE_KEY) ?? "null") as FenbiImportCredential | null;
    if (!parsed) return undefined;
    return hasCredentialReference(secretContext.fenbiCookie(), { encryptedKey: parsed.encryptedCookie, iv: parsed.iv }) ? parsed : undefined;
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
    const existing = readCredential();
    const encrypted = await writeCredentialSecret(
      secretContext.fenbiCookie(),
      existing ? { encryptedKey: existing.encryptedCookie, iv: existing.iv } : undefined,
      normalized,
    );
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
    return readCredentialSecret(secretContext.fenbiCookie(), { encryptedKey: credential.encryptedCookie, iv: credential.iv });
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
    clearDesktopCredential(secretContext.fenbiCookie());
  },
};
