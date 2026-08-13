import { isCredentialContext } from "./credential-storage-format.ts";

export type CredentialCleanupState =
  | "idle"
  | "preflight"
  | "awaiting_confirmation"
  | "verifying"
  | "deleting_sources"
  | "deleting_web_key"
  | "complete"
  | "blocked"
  | "partial"
  | "recovery_required"
  | "cancelled";

export type CredentialCleanupSourceState = "pending" | "cleaned" | "retained" | "failed";
export type CredentialCleanupWebKeyState = "unknown" | "present" | "absent" | "deleted";

/** 只允许安全、可枚举的 cleanup 原因进入 durable journal。*/
export type CredentialCleanupReasonCode =
  | "migration_journal_missing"
  | "migration_incomplete"
  | "migration_not_desktop_preferred"
  | "authority_not_desktop_primary"
  | "web_primary_present"
  | "mixed_authority"
  | "physical_inventory_changed"
  | "unknown_storage_format"
  | "invalid_storage_format"
  | "missing_desktop_record"
  | "migration_recovery_required"
  | "migration_partial_commit"
  | "new_credential_since_confirmation"
  | "desktop_host_unavailable"
  | "desktop_verification_required"
  | "desktop_verification_failed"
  | "credential_requires_reentry"
  | "legacy_source_present"
  | "orphan_legacy_source"
  | "canonical_profile_missing"
  | "web_key_still_has_consumer"
  | "source_cleanup_failed"
  | "web_key_delete_failed"
  | "journal_inconsistent"
  | "already_cleaned"
  | "cleanup_complete"
  | "cleanup_deferred"
  | "cleanup_cancelled";

export type CredentialCleanupJournal = {
  version: 1;
  state: CredentialCleanupState;
  expectedIds: string[];
  cleanedIds: string[];
  retainedIds: string[];
  inventoryVersion: string;
  webKeyState: CredentialCleanupWebKeyState;
  reasonCode?: CredentialCleanupReasonCode;
  sourceStates: Record<string, CredentialCleanupSourceState>;
  startedAt?: string;
  updatedAt: string;
};

export const CREDENTIAL_CLEANUP_STORAGE_KEY = "review-workspace:credential-cleanup:v1";

const STATES = new Set<CredentialCleanupState>([
  "idle",
  "preflight",
  "awaiting_confirmation",
  "verifying",
  "deleting_sources",
  "deleting_web_key",
  "complete",
  "blocked",
  "partial",
  "recovery_required",
  "cancelled",
]);
const SOURCE_STATES = new Set<CredentialCleanupSourceState>(["pending", "cleaned", "retained", "failed"]);
const WEB_KEY_STATES = new Set<CredentialCleanupWebKeyState>(["unknown", "present", "absent", "deleted"]);
const REASON_CODES = new Set<CredentialCleanupReasonCode>([
  "migration_journal_missing",
  "migration_incomplete",
  "migration_not_desktop_preferred",
  "authority_not_desktop_primary",
  "web_primary_present",
  "mixed_authority",
  "physical_inventory_changed",
  "unknown_storage_format",
  "invalid_storage_format",
  "missing_desktop_record",
  "migration_recovery_required",
  "migration_partial_commit",
  "new_credential_since_confirmation",
  "desktop_host_unavailable",
  "desktop_verification_required",
  "desktop_verification_failed",
  "credential_requires_reentry",
  "legacy_source_present",
  "orphan_legacy_source",
  "canonical_profile_missing",
  "web_key_still_has_consumer",
  "source_cleanup_failed",
  "web_key_delete_failed",
  "journal_inconsistent",
  "already_cleaned",
  "cleanup_complete",
  "cleanup_deferred",
  "cleanup_cancelled",
]);

function now(): string {
  return new Date().toISOString();
}

function sortedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && isCredentialContext(item)))].sort();
}

function isCleanupSourceId(value: string): boolean {
  return isCredentialContext(value)
    || value === "primary-aes-gcm-v2"
    || value === "review_workspace_crypto_key_v1"
    || ["quota-storage:invalid", "local-storage:mcp-v1:invalid", "local-storage:mcp-v2:invalid", "fenbi-storage:invalid", "desktop-store:invalid", "review-db:apiConnectionProfiles:invalid", "review-db:apiSettings:invalid"].includes(value);
}

function defaultJournal(): CredentialCleanupJournal {
  return {
    version: 1,
    state: "idle",
    expectedIds: [],
    cleanedIds: [],
    retainedIds: [],
    inventoryVersion: "",
    webKeyState: "unknown",
    sourceStates: {},
    updatedAt: now(),
  };
}

function normalize(value: unknown): CredentialCleanupJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultJournal();
  const record = value as Partial<CredentialCleanupJournal>;
  if (record.version !== 1 || typeof record.updatedAt !== "string" || !STATES.has(record.state as CredentialCleanupState)) {
    return defaultJournal();
  }
  const expectedIds = sortedIds(record.expectedIds);
  const expected = new Set(expectedIds);
  const filterExpected = (items: unknown): string[] => sortedIds(items).filter((id) => expected.has(id));
  const sourceStates = Object.fromEntries(Object.entries(record.sourceStates ?? {}).flatMap(([id, state]) => (
    isCleanupSourceId(id) && typeof state === "string" && SOURCE_STATES.has(state as CredentialCleanupSourceState)
      ? [[id, state as CredentialCleanupSourceState]]
      : []
  )));
  const reasonCode = typeof record.reasonCode === "string" && REASON_CODES.has(record.reasonCode as CredentialCleanupReasonCode)
    ? record.reasonCode as CredentialCleanupReasonCode
    : undefined;
  return {
    version: 1,
    state: record.state as CredentialCleanupState,
    expectedIds,
    cleanedIds: filterExpected(record.cleanedIds),
    retainedIds: filterExpected(record.retainedIds),
    inventoryVersion: typeof record.inventoryVersion === "string" ? record.inventoryVersion : "",
    webKeyState: typeof record.webKeyState === "string" && WEB_KEY_STATES.has(record.webKeyState as CredentialCleanupWebKeyState)
      ? record.webKeyState as CredentialCleanupWebKeyState
      : "unknown",
    reasonCode,
    sourceStates,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
    updatedAt: record.updatedAt,
  };
}

export function readCredentialCleanupJournal(): CredentialCleanupJournal {
  if (typeof window === "undefined") return defaultJournal();
  const raw = window.localStorage.getItem(CREDENTIAL_CLEANUP_STORAGE_KEY);
  if (raw === null) return defaultJournal();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid cleanup journal");
    const record = parsed as Partial<CredentialCleanupJournal>;
    if (record.version !== 1 || typeof record.updatedAt !== "string" || !STATES.has(record.state as CredentialCleanupState)) {
      throw new Error("invalid cleanup journal");
    }
    return normalize(parsed);
  } catch {
    return {
      ...defaultJournal(),
      state: "recovery_required",
      reasonCode: "journal_inconsistent",
    };
  }
}

export function writeCredentialCleanupJournal(value: CredentialCleanupJournal): CredentialCleanupJournal {
  const next = normalize({ ...value, updatedAt: now() });
  if (typeof window !== "undefined") window.localStorage.setItem(CREDENTIAL_CLEANUP_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function resetCredentialCleanupJournalForTests(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(CREDENTIAL_CLEANUP_STORAGE_KEY);
}
