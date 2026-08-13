import {
  cleanupAiConnectionCredential,
  cleanupLegacyAiSettingCredential,
} from "./ai-connections-repository.ts";
import { cleanupQuotaCredential } from "./ai-quota-repository.ts";
import {
  collectCredentialCleanupInventory,
  getCleanupHostStatus,
  isRetainedWebSource,
  type CredentialCleanupInventory,
  type CredentialCleanupSource,
} from "./credential-cleanup-inventory.ts";
import {
  evaluateCredentialCleanupEligibility,
  type CredentialCleanupEligibility,
} from "./credential-cleanup-eligibility.ts";
import { cleanupFenbiCredential } from "./fenbi-credential-repository.ts";
import { cleanupMcpCredential } from "./mcp-settings-repository.ts";
import { cleanupLegacyLocalCryptoKey } from "./crypto-service.ts";
import {
  deletePrimaryWebCredentialKeyForCleanup,
  inspectPrimaryWebCredentialKey,
  type SecurePrimaryWebKeyCleanupResult,
} from "./secure-key-store.ts";
import {
  CREDENTIAL_CLEANUP_STORAGE_KEY,
  readCredentialCleanupJournal,
  writeCredentialCleanupJournal,
  type CredentialCleanupJournal,
  type CredentialCleanupReasonCode,
  type CredentialCleanupSourceState,
} from "./credential-cleanup-state.ts";
import { reconcileCredentialCleanup } from "./credential-cleanup-reconciliation.ts";
import { readDesktopCredential } from "./credential-backend.ts";
import { secretContext } from "./secret-context.ts";
import {
  CredentialCleanupSourceError,
  cleanupSourceResult,
} from "./credential-cleanup-source.ts";

const LEGACY_JWK_SOURCE_ID = "review_workspace_crypto_key_v1";
const WEB_KEY_SOURCE_ID = "primary-aes-gcm-v2";

export type CredentialCleanupExecutionStatus = "awaiting_confirmation" | "blocked" | "complete" | "partial" | "recovery_required" | "cancelled" | "already_cleaned";

export type CredentialCleanupExecutionResult = {
  status: CredentialCleanupExecutionStatus;
  state: CredentialCleanupJournal["state"];
  reasonCode?: CredentialCleanupReasonCode;
  cleanedCount: number;
  retainedCount: number;
  webKeyState: CredentialCleanupJournal["webKeyState"];
};

export type CredentialCleanupExecutorDependencies = {
  collectInventory: () => Promise<CredentialCleanupInventory>;
  getHostStatus: typeof getCleanupHostStatus;
  readJournal: typeof readCredentialCleanupJournal;
  writeJournal: typeof writeCredentialCleanupJournal;
  verifyDesktop: (expectedIds: string[]) => Promise<{ verifiedIds: string[]; failedIds: string[] }>;
  cleanSource: (source: CredentialCleanupSource, inventory: CredentialCleanupInventory) => Promise<ReturnType<typeof cleanupSourceResult>>;
  deleteLegacyJwk: typeof cleanupLegacyLocalCryptoKey;
  inspectWebKey: typeof inspectPrimaryWebCredentialKey;
  deleteWebKey: (options: { noWebConsumerConfirmed: true }) => Promise<SecurePrimaryWebKeyCleanupResult>;
};

const defaultDependencies: CredentialCleanupExecutorDependencies = {
  collectInventory: collectCredentialCleanupInventory,
  getHostStatus: getCleanupHostStatus,
  readJournal: readCredentialCleanupJournal,
  writeJournal: writeCredentialCleanupJournal,
  verifyDesktop: async (expectedIds) => {
    const verifiedIds: string[] = [];
    const failedIds: string[] = [];
    for (const id of expectedIds) {
      try {
        await readDesktopCredential(id);
        verifiedIds.push(id);
      } catch {
        failedIds.push(id);
      }
    }
    return { verifiedIds, failedIds };
  },
  cleanSource: cleanCredentialSource,
  deleteLegacyJwk: cleanupLegacyLocalCryptoKey,
  inspectWebKey: inspectPrimaryWebCredentialKey,
  deleteWebKey: deletePrimaryWebCredentialKeyForCleanup,
};

let executionPromise: Promise<CredentialCleanupExecutionResult> | undefined;

function now(): string {
  return new Date().toISOString();
}

function webKeyState(presence: Awaited<ReturnType<typeof inspectPrimaryWebCredentialKey>>): CredentialCleanupJournal["webKeyState"] {
  return presence === "present" ? "present" : presence === "absent" ? "absent" : "unknown";
}

function sourceStateMap(inventory: CredentialCleanupInventory, state: CredentialCleanupSourceState): Record<string, CredentialCleanupSourceState> {
  return Object.fromEntries(inventory.sources
    .filter((source) => source.kind !== "desktop-store")
    .map((source) => [source.sourceId, state]));
}

function journalBase(
  inventory: CredentialCleanupInventory,
  state: CredentialCleanupJournal["state"],
  reasonCode: CredentialCleanupReasonCode | undefined,
  keyState: CredentialCleanupJournal["webKeyState"],
  current: CredentialCleanupJournal,
): CredentialCleanupJournal {
  const pendingStates = sourceStateMap(inventory, "pending");
  const sourceStates = Object.fromEntries(Object.entries(pendingStates).map(([sourceId, pending]) => [
    sourceId,
    current.sourceStates[sourceId] ?? pending,
  ]));
  return {
    ...current,
    state,
    expectedIds: [...inventory.migration.expectedIds],
    inventoryVersion: inventory.inventoryVersion,
    webKeyState: keyState,
    reasonCode,
    sourceStates: { ...current.sourceStates, ...sourceStates },
    startedAt: current.startedAt ?? now(),
    updatedAt: now(),
  };
}

function blockedResult(
  dependencies: CredentialCleanupExecutorDependencies,
  inventory: CredentialCleanupInventory,
  eligibility: CredentialCleanupEligibility,
  current: CredentialCleanupJournal,
): CredentialCleanupExecutionResult {
  const state = eligibility.decision === "already_cleaned" ? "complete" : eligibility.decision === "deferred" ? "cancelled" : "blocked";
  dependencies.writeJournal(journalBase(inventory, state, eligibility.reasonCode, webKeyState(inventory.webKey.presence), current));
  return {
    status: eligibility.decision === "already_cleaned" ? "already_cleaned" : eligibility.decision === "deferred" ? "cancelled" : "blocked",
    state,
    reasonCode: eligibility.reasonCode,
    cleanedCount: 0,
    retainedCount: eligibility.impact.sourceCount,
    webKeyState: webKeyState(inventory.webKey.presence),
  };
}

function extractConnectionId(context: string | undefined): string | undefined {
  const match = context?.match(/^ai-connection:([^:]+):api-key$/);
  return match?.[1];
}

function extractQuotaParts(context: string | undefined): { configId: string; credentialKey: "apiKey" | "adminKey" | "managementKey" | "legacy" } | undefined {
  const match = context?.match(/^quota:([^:]+):(apiKey|adminKey|managementKey|legacy)$/);
  if (!match) return undefined;
  return { configId: match[1], credentialKey: match[2] as "apiKey" | "adminKey" | "managementKey" | "legacy" };
}

function extractMcpId(context: string | undefined): string | undefined {
  return context?.match(/^mcp:([^:]+):bearer-token$/)?.[1];
}

async function cleanCredentialSource(source: CredentialCleanupSource, inventory: CredentialCleanupInventory) {
  const context = source.credentialId;
  if (source.kind === "ai-connection") {
    const id = extractConnectionId(context);
    if (!id) throw new CredentialCleanupSourceError("source_format_invalid");
    return cleanupAiConnectionCredential(id);
  }
  if (source.kind === "legacy-ai-setting") {
    const canonicalContext = inventory.canonicalAiCredentialIds.find((id) => id !== secretContext.legacyAiSetting());
    return cleanupLegacyAiSettingCredential(extractConnectionId(canonicalContext));
  }
  if (source.kind === "quota") {
    const parts = extractQuotaParts(context);
    if (!parts) throw new CredentialCleanupSourceError("source_format_invalid");
    return cleanupQuotaCredential(parts.configId as Parameters<typeof cleanupQuotaCredential>[0], parts.credentialKey);
  }
  if (source.kind === "mcp") {
    const id = extractMcpId(context);
    if (!id) throw new CredentialCleanupSourceError("source_format_invalid");
    return cleanupMcpCredential(id, source.storageLocation === "local-storage:mcp-v1" ? "v1" : "v2");
  }
  if (source.kind === "fenbi") return cleanupFenbiCredential();
  throw new CredentialCleanupSourceError("source_format_invalid");
}

function withUpdatedSource(
  journal: CredentialCleanupJournal,
  source: CredentialCleanupSource,
  state: CredentialCleanupSourceState,
  credentialId?: string,
): CredentialCleanupJournal {
  const cleanedIds = state === "cleaned" && credentialId
    ? [...new Set([...journal.cleanedIds, credentialId])].sort()
    : journal.cleanedIds;
  const retainedIds = state === "retained" && credentialId
    ? [...new Set([...journal.retainedIds, credentialId])].sort()
    : journal.retainedIds;
  return {
    ...journal,
    cleanedIds,
    retainedIds,
    sourceStates: { ...journal.sourceStates, [source.sourceId]: state },
    updatedAt: now(),
  };
}

function executionResultFromJournal(journal: CredentialCleanupJournal, status: CredentialCleanupExecutionStatus): CredentialCleanupExecutionResult {
  return {
    status,
    state: journal.state,
    reasonCode: journal.reasonCode,
    cleanedCount: journal.cleanedIds.length,
    retainedCount: journal.retainedIds.length,
    webKeyState: journal.webKeyState,
  };
}

async function runCredentialCleanup(
  confirmationInventoryVersion: string | undefined,
  confirmed: boolean,
  dependencies: CredentialCleanupExecutorDependencies,
): Promise<CredentialCleanupExecutionResult> {
  const inventory = await dependencies.collectInventory();
  const host = await dependencies.getHostStatus();
  const current = dependencies.readJournal();
  const reconciliation = reconcileCredentialCleanup(current, inventory);
  if (reconciliation.state === "recovery_required") {
    const recovery = dependencies.writeJournal({
      ...current,
      state: "recovery_required",
      expectedIds: [...inventory.migration.expectedIds],
      cleanedIds: reconciliation.cleanedIds,
      retainedIds: reconciliation.retainedIds,
      inventoryVersion: inventory.inventoryVersion,
      webKeyState: reconciliation.webKeyState,
      reasonCode: reconciliation.reasonCode ?? "journal_inconsistent",
      sourceStates: reconciliation.sourceStates,
      updatedAt: now(),
    });
    return executionResultFromJournal(recovery, "recovery_required");
  }
  const initial = evaluateCredentialCleanupEligibility({
    inventory,
    host,
    cleanupJournal: current,
    confirmationInventoryVersion,
  });
  if (initial.decision !== "eligible") return blockedResult(dependencies, inventory, initial, current);
  if (!confirmed || !confirmationInventoryVersion) {
    const awaiting = dependencies.writeJournal(journalBase(inventory, "awaiting_confirmation", "cleanup_deferred", webKeyState(inventory.webKey.presence), current));
    return executionResultFromJournal(awaiting, "awaiting_confirmation");
  }

  let journal = dependencies.writeJournal(journalBase(inventory, "preflight", undefined, webKeyState(inventory.webKey.presence), current));
  const verification = await dependencies.verifyDesktop(inventory.migration.expectedIds);
  const verifiedInventory = await dependencies.collectInventory();
  const verifiedEligibility = evaluateCredentialCleanupEligibility({
    inventory: verifiedInventory,
    host,
    cleanupJournal: journal,
    confirmationInventoryVersion,
    requireDesktopVerification: true,
    verifiedDesktopIds: verification.verifiedIds,
    failedDesktopIds: verification.failedIds,
  });
  if (verifiedEligibility.decision !== "eligible") {
    const blocked = dependencies.writeJournal(journalBase(verifiedInventory, "blocked", verifiedEligibility.reasonCode, webKeyState(verifiedInventory.webKey.presence), journal));
    return executionResultFromJournal(blocked, "blocked");
  }

  journal = dependencies.writeJournal(journalBase(verifiedInventory, "verifying", undefined, webKeyState(verifiedInventory.webKey.presence), journal));
  journal = dependencies.writeJournal({ ...journal, state: "deleting_sources", sourceStates: { ...journal.sourceStates, ...sourceStateMap(verifiedInventory, "pending") }, updatedAt: now() });
  for (const source of verifiedInventory.sources.filter((item) => isRetainedWebSource(item))) {
    if (journal.sourceStates[source.sourceId] === "cleaned") continue;
    try {
      const result = await dependencies.cleanSource(source, verifiedInventory);
      journal = withUpdatedSource(journal, source, "cleaned", result.credentialId);
      journal = dependencies.writeJournal(journal);
    } catch (error) {
      const reasonCode = error instanceof CredentialCleanupSourceError ? error.reasonCode : "source_cleanup_failed";
      const failed = dependencies.writeJournal({
        ...withUpdatedSource(journal, source, "failed", source.credentialId),
        state: "partial",
        reasonCode,
        updatedAt: now(),
      });
      return executionResultFromJournal(failed, "partial");
    }
  }

  const afterSources = await dependencies.collectInventory();
  const remainingSources = afterSources.sources.filter((source) => isRetainedWebSource(source));
  if (remainingSources.length > 0) {
    const partial = dependencies.writeJournal({
      ...journalBase(afterSources, "partial", "source_cleanup_failed", webKeyState(afterSources.webKey.presence), journal),
      retainedIds: [...new Set(remainingSources.flatMap((source) => source.credentialId ? [source.credentialId] : []))].sort(),
    });
    return executionResultFromJournal(partial, "partial");
  }

  if (afterSources.legacyJwk.present) {
    try {
      dependencies.writeJournal(journalBase(afterSources, "deleting_sources", undefined, webKeyState(afterSources.webKey.presence), journal));
      dependencies.deleteLegacyJwk({ noLegacySourcesConfirmed: true });
      journal = dependencies.writeJournal({
        ...journal,
        sourceStates: { ...journal.sourceStates, [LEGACY_JWK_SOURCE_ID]: "cleaned" },
        updatedAt: now(),
      });
    } catch {
      const partial = dependencies.writeJournal({
        ...journalBase(afterSources, "partial", "source_cleanup_failed", webKeyState(afterSources.webKey.presence), journal),
        sourceStates: { ...journal.sourceStates, [LEGACY_JWK_SOURCE_ID]: "failed" },
      });
      return executionResultFromJournal(partial, "partial");
    }
  } else {
    journal = dependencies.writeJournal({
      ...journal,
      sourceStates: { ...journal.sourceStates, [LEGACY_JWK_SOURCE_ID]: "cleaned" },
      updatedAt: now(),
    });
  }

  const beforeKey = await dependencies.collectInventory();
  if (beforeKey.sources.some((source) => isRetainedWebSource(source)) || beforeKey.legacyJwk.present) {
    const partial = dependencies.writeJournal(journalBase(beforeKey, "partial", "web_key_still_has_consumer", webKeyState(beforeKey.webKey.presence), journal));
    return executionResultFromJournal(partial, "partial");
  }

  journal = dependencies.writeJournal(journalBase(beforeKey, "deleting_web_key", undefined, webKeyState(beforeKey.webKey.presence), journal));
  try {
    await dependencies.deleteWebKey({ noWebConsumerConfirmed: true });
    journal = dependencies.writeJournal({
      ...journal,
      webKeyState: "deleted",
      sourceStates: { ...journal.sourceStates, [WEB_KEY_SOURCE_ID]: "cleaned" },
      updatedAt: now(),
    });
  } catch {
    const partial = dependencies.writeJournal({
      ...journalBase(beforeKey, "partial", "web_key_delete_failed", "present", journal),
      sourceStates: { ...journal.sourceStates, [WEB_KEY_SOURCE_ID]: "failed" },
    });
    return executionResultFromJournal(partial, "partial");
  }
  const finalInventory = await dependencies.collectInventory();
  const finalKey = await dependencies.inspectWebKey();
  if (finalInventory.sources.some((source) => isRetainedWebSource(source)) || finalInventory.legacyJwk.present || finalKey === "present") {
    const recovery = dependencies.writeJournal({
      ...journalBase(finalInventory, "recovery_required", "journal_inconsistent", webKeyState(finalKey), journal),
      sourceStates: { ...journal.sourceStates, [WEB_KEY_SOURCE_ID]: finalKey === "present" ? "failed" : "cleaned" },
    });
    return executionResultFromJournal(recovery, "recovery_required");
  }
  const complete = dependencies.writeJournal({
    ...journalBase(finalInventory, "complete", "cleanup_complete", webKeyState(finalKey), journal),
    cleanedIds: [...new Set([...journal.cleanedIds, ...finalInventory.migration.expectedIds])].sort(),
    retainedIds: [],
    updatedAt: now(),
  });
  return executionResultFromJournal(complete, "complete");
}

/**
 * Future acceptance-only destructive entrypoint. Production UI deliberately has no import or call path to this function.
 */
export function executeCredentialCleanup(options: {
  confirmationInventoryVersion?: string;
  confirmed?: boolean;
  dependencies?: Partial<CredentialCleanupExecutorDependencies>;
} = {}): Promise<CredentialCleanupExecutionResult> {
  if (executionPromise) return executionPromise;
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  executionPromise = runCredentialCleanup(options.confirmationInventoryVersion, options.confirmed === true, dependencies)
    .finally(() => { executionPromise = undefined; });
  return executionPromise;
}

export function resetCredentialCleanupExecutorForTests(): void {
  executionPromise = undefined;
  if (typeof window !== "undefined") window.localStorage.removeItem(CREDENTIAL_CLEANUP_STORAGE_KEY);
}
