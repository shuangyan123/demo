import { resolveHost } from "../platform/host.ts";
import { DesktopCredentialProtectionError, type DesktopCredentialEnvelope } from "../platform/capabilities.ts";
import { decryptSecret, encryptSecret, type CredentialSecurityError } from "./crypto-service.ts";
import { getCredentialAuthority, readCredentialMigrationJournal, setCredentialAuthority } from "./credential-migration-state.ts";
import {
  DESKTOP_CREDENTIAL_STORAGE_PREFIX,
  CredentialStorageFormatError,
  deserializeDesktopCredentialReference,
  detectCredentialStorageFormat,
  isCredentialContext,
  serializeDesktopCredentialReference,
  type CredentialStorageFormat,
} from "./credential-storage-format.ts";

export type CredentialReference = { encryptedKey?: string; iv?: string };
export type CredentialWriteResult = { encryptedKey: string; iv: string; backend: "web_crypto" | "desktop_host" };
export type DesktopCredentialRecordMetadata = { context: string; updatedAt: string };

export type CredentialBackendErrorCode =
  | "desktop_host_unavailable"
  | "desktop_credential_unreadable"
  | "desktop_context_mismatch"
  | "credential_requires_reentry"
  | "credential_format_invalid"
  | "credential_format_unknown"
  | "credential_missing";

const DESKTOP_CREDENTIAL_STORE_KEY = "review-workspace:desktop-credentials:v1";

export class CredentialBackendError extends Error {
  readonly code: CredentialBackendErrorCode;

  constructor(code: CredentialBackendErrorCode, message: string) {
    super(message);
    this.name = "CredentialBackendError";
    this.code = code;
  }
}

type StoredDesktopCredential = DesktopCredentialRecordMetadata & {
  version: 1;
  envelope: DesktopCredentialEnvelope;
};

function safeMessage(code: CredentialBackendErrorCode): string {
  return {
    desktop_host_unavailable: "Desktop credential protection is unavailable. Retry later.",
    desktop_credential_unreadable: "The Desktop credential cannot be verified. Re-enter it.",
    desktop_context_mismatch: "The Desktop credential does not belong to this record.",
    credential_requires_reentry: "This credential must be entered again.",
    credential_format_invalid: "The stored credential format is invalid.",
    credential_format_unknown: "The stored credential format is unsupported.",
    credential_missing: "This credential is not configured.",
  }[code];
}

function backendError(code: CredentialBackendErrorCode): CredentialBackendError {
  return new CredentialBackendError(code, safeMessage(code));
}

function mapHostError(error: unknown): CredentialBackendError {
  if (error instanceof DesktopCredentialProtectionError) {
    if (error.code === "host_unavailable") return backendError("desktop_host_unavailable");
    if (error.code === "host_context_mismatch") return backendError("desktop_context_mismatch");
    return backendError("desktop_credential_unreadable");
  }
  return backendError("desktop_credential_unreadable");
}

function readStore(): StoredDesktopCredential[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(DESKTOP_CREDENTIAL_STORE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; records?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) throw new Error("invalid");
    const contexts = new Set<string>();
    return parsed.records.map((item): StoredDesktopCredential => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw backendError("credential_format_invalid");
      const record = item as Record<string, unknown>;
      const envelope = record.envelope as Record<string, unknown> | undefined;
      if (typeof record.context === "string" && contexts.has(record.context)) throw backendError("credential_format_invalid");
      if (!(record.version === 1
        && typeof record.context === "string"
        && isCredentialContext(record.context)
        && typeof record.updatedAt === "string"
        && envelope?.version === "desktop-v1"
        && envelope.context === record.context
        && typeof envelope.payload === "string")) throw backendError("credential_format_invalid");
      contexts.add(record.context);
      try {
        deserializeDesktopCredentialReference(serializeDesktopCredentialReference(envelope as DesktopCredentialEnvelope), record.context);
      } catch {
        throw backendError("credential_format_invalid");
      }
      return { version: 1, context: record.context, updatedAt: record.updatedAt, envelope: envelope as DesktopCredentialEnvelope };
    });
  } catch {
    throw backendError("credential_format_invalid");
  }
}

function writeStore(records: StoredDesktopCredential[]): void {
  if (typeof window === "undefined") throw backendError("desktop_host_unavailable");
  window.localStorage.setItem(DESKTOP_CREDENTIAL_STORE_KEY, JSON.stringify({ version: 1, records }));
}

function readDesktopRecord(context: string): StoredDesktopCredential | undefined {
  const record = readStore().find((item) => item.context === context);
  if (!record) return undefined;
  try {
    deserializeDesktopCredentialReference(serializeDesktopCredentialReference(record.envelope), context);
  } catch (error) {
    if (error instanceof Error && error.name === "CredentialStorageFormatError") throw backendError("credential_format_invalid");
    throw error;
  }
  return record;
}

export function listDesktopCredentialRecords(): DesktopCredentialRecordMetadata[] {
  return readStore().map(({ context, updatedAt }) => ({ context, updatedAt }));
}

export function hasDesktopCredential(context: string): boolean {
  return Boolean(readDesktopRecord(context));
}

function getDesktopCapability() {
  const runtime = resolveHost();
  if (runtime.kind !== "desktop") return undefined;
  return runtime.capabilities.credentialProtection;
}

async function requireDesktopCapability() {
  const capability = getDesktopCapability();
  if (!capability) throw backendError("desktop_host_unavailable");
  try {
    const status = await capability.getStatus();
    if (status.status !== "available") throw backendError("desktop_host_unavailable");
  } catch (error) {
    if (error instanceof CredentialBackendError) throw error;
    throw mapHostError(error);
  }
  return capability;
}

async function protectAndStore(context: string, secret: string): Promise<void> {
  const capability = await requireDesktopCapability();
  let envelope: DesktopCredentialEnvelope;
  try {
    envelope = await capability.protectCredential(context, secret);
  } catch (error) {
    throw mapHostError(error);
  }
  const records = readStore().filter((record) => record.context !== context);
  records.push({ version: 1, context, envelope, updatedAt: new Date().toISOString() });
  writeStore(records.sort((left, right) => left.context.localeCompare(right.context)));
}

async function unprotectEnvelope(context: string, envelope: DesktopCredentialEnvelope): Promise<string> {
  const capability = await requireDesktopCapability();
  try {
    const result = await capability.unprotectCredential(context, envelope);
    if (result.shouldReProtect) {
      // 旧 envelope 在新 envelope 成功写入前保持有效，失败时下一次读取仍可恢复。
      const replacement = await capability.protectCredential(context, result.secret);
      const records = readStore().filter((record) => record.context !== context);
      records.push({ version: 1, context, envelope: replacement, updatedAt: new Date().toISOString() });
      writeStore(records.sort((left, right) => left.context.localeCompare(right.context)));
    }
    return result.secret;
  } catch (error) {
    throw mapHostError(error);
  }
}

function formatError(format: CredentialStorageFormat): CredentialBackendError {
  return backendError(format === "unknown" ? "credential_format_unknown" : "credential_format_invalid");
}

function mapStorageFormatError(error: unknown): CredentialBackendError {
  if (error instanceof CredentialStorageFormatError && error.code === "context_mismatch") return backendError("desktop_context_mismatch");
  if (error instanceof CredentialStorageFormatError && error.code === "unknown") return backendError("credential_format_unknown");
  return backendError("credential_format_invalid");
}

export async function readDesktopCredential(context: string): Promise<string> {
  const record = readDesktopRecord(context);
  if (!record) throw backendError("credential_missing");
  return unprotectEnvelope(context, record.envelope);
}

export async function stageDesktopCredential(context: string, secret: string): Promise<void> {
  await protectAndStore(context, secret);
}

export async function readCredentialSecret(context: string, reference: CredentialReference): Promise<string> {
  const authority = getCredentialAuthority(context);
  if (authority === "desktop_primary") return readDesktopCredential(context);
  if (authority === "requires_reentry") throw backendError("credential_requires_reentry");
  if (reference.encryptedKey?.startsWith(DESKTOP_CREDENTIAL_STORAGE_PREFIX)) {
    try {
      const envelope = deserializeDesktopCredentialReference(reference.encryptedKey, context);
      return unprotectEnvelope(context, envelope);
    } catch (error) {
      if (error instanceof CredentialBackendError) throw error;
      throw mapStorageFormatError(error);
    }
  }
  if (!reference.encryptedKey || !reference.iv) throw backendError("credential_missing");
  const format = detectCredentialStorageFormat(reference.encryptedKey, reference.iv);
  if (format === "invalid" || format === "unknown" || format === "desktop-v1") throw formatError(format);
  try {
    return await decryptSecret(reference.encryptedKey, reference.iv, context);
  } catch (error) {
    if (error instanceof Error && (error as Partial<CredentialSecurityError>).name === "CredentialSecurityError") throw error;
    throw backendError("credential_requires_reentry");
  }
}

export async function writeCredentialSecret(context: string, current: CredentialReference | undefined, secret: string): Promise<CredentialWriteResult> {
  const authority = getCredentialAuthority(context);
  const runtime = resolveHost();
  if (authority === "desktop_primary") {
    if (runtime.kind !== "desktop") throw backendError("desktop_host_unavailable");
    await protectAndStore(context, secret);
    return { backend: "desktop_host", encryptedKey: current?.encryptedKey ?? "", iv: current?.iv ?? "" };
  }
  const journal = readCredentialMigrationJournal();
  const desktopPreferred = journal.state === "complete" && journal.backendPolicy === "desktop_preferred";
  if (desktopPreferred) {
    if (runtime.kind !== "desktop") throw backendError("desktop_host_unavailable");
    await protectAndStore(context, secret);
    setCredentialAuthority(context, "desktop_primary");
    return { backend: "desktop_host", encryptedKey: current?.encryptedKey ?? "", iv: current?.iv ?? "" };
  }
  const encrypted = await encryptSecret(secret, context);
  if (authority === "requires_reentry") setCredentialAuthority(context, "web_primary");
  return { backend: "web_crypto", encryptedKey: encrypted.encryptedKey, iv: encrypted.iv };
}

export function hasCredentialReference(context: string, reference: CredentialReference | undefined): boolean {
  if (getCredentialAuthority(context) === "desktop_primary") return hasDesktopCredential(context);
  return Boolean(reference?.encryptedKey && ["web-v2", "legacy-v1", "desktop-v1"].includes(detectCredentialStorageFormat(reference.encryptedKey, reference.iv)));
}

export function clearDesktopCredential(context: string): void {
  const current = readStore();
  if (current.some((record) => record.context === context)) writeStore(current.filter((record) => record.context !== context));
  setCredentialAuthority(context, undefined);
}

export function getDesktopCredentialStoreKey(): string {
  return DESKTOP_CREDENTIAL_STORE_KEY;
}
