import { inspectCredentialProtection } from "../platform/credential-protection.ts";
import type { CredentialMigrationHost, CredentialMigrationPlan } from "./credential-migration-planner.ts";
import { planCredentialMigration } from "./credential-migration-planner.ts";
import {
  collectCredentialMigrationInventory,
  type CredentialMigrationInventory,
  type CredentialMigrationSource,
} from "./credential-migration-inventory.ts";
import {
  readCredentialMigrationJournal,
  writeCredentialMigrationJournal,
  type CredentialMigrationInventoryStorage,
  type CredentialMigrationJournal,
} from "./credential-migration-state.ts";
import {
  hasDesktopCredential,
  readDesktopCredential,
  stageDesktopCredential,
} from "./credential-backend.ts";
import { setCredentialAuthority } from "./credential-migration-state.ts";

export type CredentialMigrationResult = {
  status: "web_mode" | "complete" | "no_op" | "blocked" | "requires_reentry" | "recovery_required";
  state: CredentialMigrationJournal["state"];
  reason: string;
  expectedIds: string[];
};

type MigrationHost = CredentialMigrationHost | { kind: "server" };

type MigrationFailurePhase = "stage" | "verify" | "commit";

export type CredentialMigrationDependencies = {
  getHost?: () => Promise<MigrationHost>;
  collectInventory?: () => Promise<CredentialMigrationInventory>;
  stage?: (context: string, secret: string) => Promise<void>;
  readDesktop?: (context: string) => Promise<string>;
  hasDesktop?: (context: string) => boolean;
  readJournal?: () => CredentialMigrationJournal;
  writeJournal?: (journal: CredentialMigrationJournal) => CredentialMigrationJournal;
  setAuthority?: typeof setCredentialAuthority;
};

function now(): string {
  return new Date().toISOString();
}

async function defaultHost(): Promise<MigrationHost> {
  if (typeof window === "undefined") return { kind: "server" };
  const inspection = await inspectCredentialProtection();
  return inspection.backend === "web_crypto"
    ? { kind: "web" }
    : { kind: "desktop", availability: inspection.status };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function storageById(inventory: CredentialMigrationInventory): Record<string, CredentialMigrationInventoryStorage> {
  return Object.fromEntries(inventory.items.map((item) => [item.id, item.storage]));
}

function activeState(state: CredentialMigrationJournal["state"]): boolean {
  return ["preflight", "staging", "verifying", "ready_to_commit", "committing", "recovery_required", "complete"].includes(state);
}

function recoveryCompatible(journal: CredentialMigrationJournal, inventory: CredentialMigrationInventory): boolean {
  if (!sameIds(journal.expectedIds, inventory.expectedIds)) return false;
  if (journal.inventoryVersion === inventory.inventoryVersion) return true;
  if (journal.state !== "committing" && journal.state !== "recovery_required") return false;
  const currentStorage = storageById(inventory);
  return journal.expectedIds.every((id) => {
    const current = currentStorage[id];
    const previous = journal.inventoryStorageById[id];
    return journal.committedIds.includes(id) ? current === "desktop-v1" : current === previous;
  });
}

function withInventory(journal: CredentialMigrationJournal, inventory: CredentialMigrationInventory): CredentialMigrationJournal {
  return {
    ...journal,
    expectedIds: inventory.expectedIds,
    inventoryVersion: inventory.inventoryVersion,
    inventoryStorageById: storageById(inventory),
  };
}

function result(journal: CredentialMigrationJournal, status: CredentialMigrationResult["status"], reason: string): CredentialMigrationResult {
  return { status, state: journal.state, reason, expectedIds: journal.expectedIds };
}

function save(
  journal: CredentialMigrationJournal,
  dependencies: Required<Pick<CredentialMigrationDependencies, "writeJournal">>,
  patch: Partial<CredentialMigrationJournal>,
): CredentialMigrationJournal {
  return dependencies.writeJournal({ ...journal, ...patch, updatedAt: now() });
}

function addId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id].sort();
}

function allIdsIncluded(ids: readonly string[], expected: readonly string[]): boolean {
  return expected.every((id) => ids.includes(id));
}

function safeFailureReason(error: unknown, phase: MigrationFailurePhase): string {
  if (error instanceof Error && error.name === "CredentialBackendError") {
    if ((error as { code?: string }).code === "desktop_host_unavailable") return "migration_host_unavailable";
    return "credential_backend_failed";
  }
  if (error instanceof Error && error.name === "CredentialSecurityError") return "credential_requires_reentry";
  return `migration_${phase}_failed`;
}

function secretsEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

async function verifyStableInventory(
  expected: CredentialMigrationInventory,
  dependencies: Required<Pick<CredentialMigrationDependencies, "collectInventory">>,
): Promise<CredentialMigrationInventory | undefined> {
  const current = await dependencies.collectInventory();
  return current.inventoryVersion === expected.inventoryVersion && sameIds(current.expectedIds, expected.expectedIds) ? current : undefined;
}

async function verifyRecoveryInventory(
  journal: CredentialMigrationJournal,
  dependencies: Required<Pick<CredentialMigrationDependencies, "collectInventory">>,
): Promise<CredentialMigrationInventory | undefined> {
  const current = await dependencies.collectInventory();
  return recoveryCompatible(journal, current) ? current : undefined;
}

function sourceFor(inventory: CredentialMigrationInventory, id: string): CredentialMigrationSource {
  const source = inventory.records.find((record) => record.id === id);
  if (!source) throw new Error("inventory_record_missing");
  return source;
}

/** Desktop 凭据迁移的唯一编排入口：所有记录先 staging/verify，最后才改变 authority。 */
async function runDesktopCredentialMigration(input: CredentialMigrationDependencies = {}): Promise<CredentialMigrationResult> {
  const dependencies = {
    getHost: input.getHost ?? defaultHost,
    collectInventory: input.collectInventory ?? collectCredentialMigrationInventory,
    stage: input.stage ?? stageDesktopCredential,
    readDesktop: input.readDesktop ?? readDesktopCredential,
    hasDesktop: input.hasDesktop ?? hasDesktopCredential,
    readJournal: input.readJournal ?? readCredentialMigrationJournal,
    writeJournal: input.writeJournal ?? writeCredentialMigrationJournal,
    setAuthority: input.setAuthority ?? setCredentialAuthority,
  };
  const host = await dependencies.getHost();
  if (host.kind === "web" || host.kind === "server") {
    return { status: "web_mode", state: "idle", reason: "web_mode", expectedIds: [] };
  }

  const inventory = await dependencies.collectInventory();
  let journal = dependencies.readJournal();
  if (activeState(journal.state) && journal.expectedIds.length && !recoveryCompatible(journal, inventory)) {
    journal = save(journal, dependencies, { state: "blocked", reason: "migration_inventory_changed" });
    return result(journal, "blocked", "migration_inventory_changed");
  }

  const sameInventory = sameIds(journal.expectedIds, inventory.expectedIds)
    && (journal.inventoryVersion === inventory.inventoryVersion || recoveryCompatible(journal, inventory));
  if (!sameInventory || ["idle", "blocked", "cancelled"].includes(journal.state)) {
    journal = save({
      ...journal,
      state: "preflight",
      backendPolicy: "web_preferred",
      expectedIds: inventory.expectedIds,
      stagedIds: [],
      verifiedIds: [],
      committedIds: [],
      authorities: {},
      inventoryVersion: inventory.inventoryVersion,
      inventoryStorageById: storageById(inventory),
      startedAt: now(),
      reason: undefined,
    }, dependencies, {});
  } else {
    journal = save(withInventory(journal, inventory), dependencies, {});
  }

  const plan: CredentialMigrationPlan = planCredentialMigration({
    host,
    expectedIds: inventory.expectedIds,
    inventory: inventory.items,
    state: journal.state === "recovery_required" || journal.state === "committing" ? "staging" : journal.state,
  });
  if (plan.decision === "requires_reentry") {
    journal = save(journal, dependencies, { state: "blocked", reason: plan.reason });
    return result(journal, "requires_reentry", plan.reason);
  }
  if (plan.decision === "blocked") {
    journal = save(journal, dependencies, { state: "blocked", reason: plan.reason });
    return result(journal, "blocked", plan.reason);
  }
  if (plan.decision === "no_op" && inventory.items.length > 0 && inventory.items.every((item) => item.storage === "desktop-v1")) {
    for (const id of inventory.expectedIds) dependencies.setAuthority(id, "desktop_primary");
    journal = save(journal, dependencies, {
      state: "complete",
      backendPolicy: "desktop_preferred",
      stagedIds: inventory.expectedIds,
      verifiedIds: inventory.expectedIds,
      committedIds: inventory.expectedIds,
      authorities: Object.fromEntries(inventory.expectedIds.map((id) => [id, "desktop_primary"])),
      inventoryStorageById: Object.fromEntries(inventory.expectedIds.map((id) => [id, "desktop-v1"])),
      reason: undefined,
    });
    return result(journal, "complete", "already_host_protected");
  }
  if (plan.decision === "no_op") {
    journal = save(journal, dependencies, { state: "complete", reason: plan.reason });
    return result(journal, "no_op", plan.reason);
  }

  journal = save(journal, dependencies, { state: "staging", backendPolicy: "web_preferred" });
  for (const id of inventory.expectedIds) {
    if (journal.stagedIds.includes(id) || journal.committedIds.includes(id)) continue;
    const source = sourceFor(inventory, id);
    try {
      if (source.storage === "desktop-v1" || dependencies.hasDesktop(source.context)) {
        journal = save(journal, dependencies, { stagedIds: addId(journal.stagedIds, id) });
        continue;
      }
      if (!source.readWebSecret) throw new Error("credential_requires_reentry");
      let secret = await source.readWebSecret();
      try {
        await dependencies.stage(source.context, secret);
      } finally {
        secret = "";
      }
      journal = save(journal, dependencies, { stagedIds: addId(journal.stagedIds, id) });
    } catch (error) {
      journal = save(journal, dependencies, { state: "recovery_required", reason: safeFailureReason(error, "stage") });
      return result(journal, "recovery_required", journal.reason ?? "credential_migration_failed");
    }
  }

  const stableAfterStage = journal.state === "recovery_required" || journal.committedIds.length > 0
    ? await verifyRecoveryInventory(journal, dependencies)
    : await verifyStableInventory(inventory, dependencies);
  if (!stableAfterStage) {
    journal = save(journal, dependencies, { state: "blocked", reason: "migration_inventory_changed" });
    return result(journal, "blocked", "migration_inventory_changed");
  }
  journal = save(journal, dependencies, { state: "verifying" });
  for (const id of inventory.expectedIds) {
    if (journal.verifiedIds.includes(id) || journal.committedIds.includes(id)) continue;
    const source = sourceFor(stableAfterStage, id);
    try {
      let desktopSecret = await dependencies.readDesktop(source.context);
      try {
        if (source.readWebSecret) {
          let webSecret = await source.readWebSecret();
          try {
            if (!secretsEqual(desktopSecret, webSecret)) throw new Error("credential_verification_failed");
          } finally {
            webSecret = "";
          }
        }
      } finally {
        desktopSecret = "";
      }
      journal = save(journal, dependencies, { verifiedIds: addId(journal.verifiedIds, id) });
    } catch (error) {
      journal = save(journal, dependencies, { state: "recovery_required", reason: safeFailureReason(error, "verify") });
      return result(journal, "recovery_required", journal.reason ?? "credential_migration_failed");
    }
  }

  if (!allIdsIncluded(journal.stagedIds, journal.expectedIds) || !allIdsIncluded(journal.verifiedIds, journal.expectedIds)) {
    journal = save(journal, dependencies, { state: "recovery_required", reason: "migration_incomplete" });
    return result(journal, "recovery_required", "migration_incomplete");
  }
  const stableBeforeCommit = await verifyStableInventory(stableAfterStage, dependencies);
  if (!stableBeforeCommit) {
    journal = save(journal, dependencies, { state: "blocked", reason: "migration_inventory_changed" });
    return result(journal, "blocked", "migration_inventory_changed");
  }

  journal = save(journal, dependencies, { state: "ready_to_commit" });
  journal = save(journal, dependencies, { state: "committing" });
  for (const id of journal.expectedIds) {
    if (journal.committedIds.includes(id)) continue;
    const source = sourceFor(stableBeforeCommit, id);
    try {
      dependencies.setAuthority(source.context, "desktop_primary");
      journal = save(journal, dependencies, {
        committedIds: addId(journal.committedIds, id),
        authorities: { ...journal.authorities, [id]: "desktop_primary" },
      });
    } catch (error) {
      journal = save(journal, dependencies, { state: "recovery_required", reason: safeFailureReason(error, "commit") });
      return result(journal, "recovery_required", journal.reason ?? "credential_migration_failed");
    }
  }

  const postCommit = await dependencies.collectInventory();
  const complete = sameIds(postCommit.expectedIds, journal.expectedIds)
    && postCommit.items.every((item) => item.storage === "desktop-v1")
    && journal.expectedIds.every((id) => journal.authorities[id] === "desktop_primary");
  if (!complete) {
    journal = save(journal, dependencies, { state: "recovery_required", reason: "post_commit_verification_failed" });
    return result(journal, "recovery_required", "post_commit_verification_failed");
  }
  journal = save(journal, dependencies, {
    state: "complete",
    backendPolicy: "desktop_preferred",
    committedIds: journal.expectedIds,
    authorities: Object.fromEntries(journal.expectedIds.map((id) => [id, "desktop_primary"])),
    inventoryVersion: postCommit.inventoryVersion,
    inventoryStorageById: storageById(postCommit),
    reason: undefined,
  });
  return result(journal, "complete", "migration_complete");
}

let migrationPromise: Promise<CredentialMigrationResult> | undefined;

/** A renderer-local single-flight prevents duplicate user actions from staging or committing the same journal concurrently. */
export function migrateDesktopCredentials(input: CredentialMigrationDependencies = {}): Promise<CredentialMigrationResult> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = runDesktopCredentialMigration(input).finally(() => {
    migrationPromise = undefined;
  });
  return migrationPromise;
}
