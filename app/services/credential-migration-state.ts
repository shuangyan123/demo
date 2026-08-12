import { isCredentialContext } from "./credential-storage-format.ts";

export type CredentialMigrationState =
  | "idle"
  | "preflight"
  | "staging"
  | "verifying"
  | "ready_to_commit"
  | "committing"
  | "complete"
  | "blocked"
  | "recovery_required"
  | "cancelled";

export type CredentialAuthority = "web_primary" | "desktop_primary" | "requires_reentry";
export type CredentialBackendPolicy = "web_preferred" | "desktop_preferred";
export type CredentialMigrationInventoryStorage = "desktop-v1" | "web-v2" | "legacy-v1" | "missing" | "invalid" | "masked-only" | "unavailable" | "unknown";

export type CredentialMigrationJournal = {
  version: 1;
  state: CredentialMigrationState;
  backendPolicy: CredentialBackendPolicy;
  expectedIds: string[];
  stagedIds: string[];
  verifiedIds: string[];
  committedIds: string[];
  authorities: Record<string, CredentialAuthority>;
  inventoryStorageById: Record<string, CredentialMigrationInventoryStorage>;
  inventoryVersion: string;
  startedAt?: string;
  updatedAt: string;
  reason?: string;
};

export const CREDENTIAL_MIGRATION_STORAGE_KEY = "review-workspace:credential-migration:v1";

const STATES = new Set<CredentialMigrationState>([
  "idle",
  "preflight",
  "staging",
  "verifying",
  "ready_to_commit",
  "committing",
  "complete",
  "blocked",
  "recovery_required",
  "cancelled",
]);
const AUTHORITIES = new Set<CredentialAuthority>(["web_primary", "desktop_primary", "requires_reentry"]);

function now(): string {
  return new Date().toISOString();
}

function sortedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && isCredentialContext(item)))].sort();
}

function authorities(value: unknown): Record<string, CredentialAuthority> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, authority]) => (
    isCredentialContext(id) && typeof authority === "string" && AUTHORITIES.has(authority as CredentialAuthority)
      ? [[id, authority as CredentialAuthority]]
      : []
  )));
}

function inventoryStorageById(value: unknown): Record<string, CredentialMigrationInventoryStorage> {
  const valid = new Set<CredentialMigrationInventoryStorage>(["desktop-v1", "web-v2", "legacy-v1", "missing", "invalid", "masked-only", "unavailable", "unknown"]);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, storage]) => (
    isCredentialContext(id) && typeof storage === "string" && valid.has(storage as CredentialMigrationInventoryStorage)
      ? [[id, storage as CredentialMigrationInventoryStorage]]
      : []
  )));
}

function defaultJournal(): CredentialMigrationJournal {
  return {
    version: 1,
    state: "idle",
    backendPolicy: "web_preferred",
    expectedIds: [],
    stagedIds: [],
    verifiedIds: [],
    committedIds: [],
    authorities: {},
    inventoryStorageById: {},
    inventoryVersion: "",
    updatedAt: now(),
  };
}

function normalize(value: unknown): CredentialMigrationJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultJournal();
  const record = value as Partial<CredentialMigrationJournal>;
  if (record.version !== 1 || typeof record.updatedAt !== "string" || !STATES.has(record.state as CredentialMigrationState)) return defaultJournal();
  const expectedIds = sortedIds(record.expectedIds);
  const expected = new Set(expectedIds);
  const filterExpected = (items: unknown): string[] => sortedIds(items).filter((id) => expected.has(id));
  const normalizedAuthorities = Object.fromEntries(Object.entries(authorities(record.authorities)).filter(([id]) => expected.has(id)));
  const normalizedStorage = Object.fromEntries(Object.entries(inventoryStorageById(record.inventoryStorageById)).filter(([id]) => expected.has(id)));
  return {
    version: 1,
    state: record.state as CredentialMigrationState,
    backendPolicy: record.backendPolicy === "desktop_preferred" ? "desktop_preferred" : "web_preferred",
    expectedIds,
    stagedIds: filterExpected(record.stagedIds),
    verifiedIds: filterExpected(record.verifiedIds),
    committedIds: filterExpected(record.committedIds),
    authorities: normalizedAuthorities,
    inventoryStorageById: normalizedStorage,
    inventoryVersion: typeof record.inventoryVersion === "string" ? record.inventoryVersion : "",
    startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
    updatedAt: record.updatedAt,
    reason: typeof record.reason === "string" ? record.reason : undefined,
  };
}

export function readCredentialMigrationJournal(): CredentialMigrationJournal {
  if (typeof window === "undefined") return defaultJournal();
  try {
    return normalize(JSON.parse(window.localStorage.getItem(CREDENTIAL_MIGRATION_STORAGE_KEY) ?? "null"));
  } catch {
    return defaultJournal();
  }
}

export function writeCredentialMigrationJournal(value: CredentialMigrationJournal): CredentialMigrationJournal {
  const next = normalize({ ...value, updatedAt: now() });
  if (typeof window !== "undefined") window.localStorage.setItem(CREDENTIAL_MIGRATION_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function getCredentialAuthority(context: string): CredentialAuthority | undefined {
  return readCredentialMigrationJournal().authorities[context];
}

export function setCredentialAuthority(context: string, authority: CredentialAuthority | undefined): CredentialMigrationJournal {
  if (!isCredentialContext(context)) return readCredentialMigrationJournal();
  const current = readCredentialMigrationJournal();
  const nextAuthorities = { ...current.authorities };
  if (authority) nextAuthorities[context] = authority;
  else delete nextAuthorities[context];
  const expectedIds = authority && !current.expectedIds.includes(context)
    ? [...current.expectedIds, context]
    : current.expectedIds.filter((id) => id !== context || Boolean(authority));
  return writeCredentialMigrationJournal({ ...current, expectedIds, authorities: nextAuthorities });
}

export function resetCredentialMigrationJournalForTests(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(CREDENTIAL_MIGRATION_STORAGE_KEY);
}
