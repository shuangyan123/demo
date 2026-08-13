import { isRetainedWebSource, type CredentialCleanupInventory } from "./credential-cleanup-inventory.ts";
import type {
  CredentialCleanupJournal,
  CredentialCleanupReasonCode,
  CredentialCleanupSourceState,
  CredentialCleanupState,
  CredentialCleanupWebKeyState,
} from "./credential-cleanup-state.ts";

export type CredentialCleanupReconciliation = {
  state: CredentialCleanupState;
  reasonCode?: CredentialCleanupReasonCode;
  cleanedIds: string[];
  retainedIds: string[];
  webKeyState: CredentialCleanupWebKeyState;
  sourceStates: Record<string, CredentialCleanupSourceState>;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function retainedIds(inventory: CredentialCleanupInventory): string[] {
  return uniqueSorted(inventory.sources
    .filter(isRetainedWebSource)
    .flatMap((source) => source.credentialId ? [source.credentialId] : []));
}

function sourceStates(inventory: CredentialCleanupInventory, expectedIds: Set<string>): Record<string, CredentialCleanupSourceState> {
  const states: Record<string, CredentialCleanupSourceState> = {};
  for (const id of expectedIds) {
    const hasSource = inventory.sources.some((source) => isRetainedWebSource(source) && source.credentialId === id);
    states[id] = hasSource ? "retained" : "cleaned";
  }
  for (const source of inventory.sources) {
    if (source.kind === "desktop-store") continue;
    states[source.sourceId] = isRetainedWebSource(source) ? "retained" : "cleaned";
  }
  return states;
}

/**
 * 将 durable journal 与一次新的物理观察对齐。任何“已清理后又出现”或 key/source 顺序异常都进入恢复态，
 * 不尝试猜测用户意图，也不自动重放删除。
 */
export function reconcileCredentialCleanup(
  journal: CredentialCleanupJournal,
  inventory: CredentialCleanupInventory,
): CredentialCleanupReconciliation {
  const expected = uniqueSorted(inventory.migration.expectedIds);
  const expectedSet = new Set(expected);
  const currentRetained = retainedIds(inventory);
  const currentRetainedSet = new Set(currentRetained);
  const states = sourceStates(inventory, expectedSet);

  if (journal.expectedIds.length > 0 && JSON.stringify(journal.expectedIds) !== JSON.stringify(expected)) {
    return {
      state: "recovery_required",
      reasonCode: "physical_inventory_changed",
      cleanedIds: [],
      retainedIds: currentRetained,
      webKeyState: inventory.webKey.presence === "present" ? "present" : inventory.webKey.presence === "absent" ? "absent" : "unknown",
      sourceStates: states,
    };
  }
  if (journal.inventoryVersion && journal.state !== "idle" && journal.inventoryVersion !== inventory.inventoryVersion) {
    return {
      state: "recovery_required",
      reasonCode: "physical_inventory_changed",
      cleanedIds: [],
      retainedIds: currentRetained,
      webKeyState: inventory.webKey.presence === "present" ? "present" : inventory.webKey.presence === "absent" ? "absent" : "unknown",
      sourceStates: states,
    };
  }
  if (journal.cleanedIds.some((id) => currentRetainedSet.has(id))) {
    return {
      state: "recovery_required",
      reasonCode: "source_cleanup_failed",
      cleanedIds: journal.cleanedIds.filter((id) => !currentRetainedSet.has(id)),
      retainedIds: currentRetained,
      webKeyState: inventory.webKey.presence === "present" ? "present" : inventory.webKey.presence === "absent" ? "absent" : "unknown",
      sourceStates: states,
    };
  }
  if (journal.webKeyState === "deleted" && inventory.webKey.presence === "present") {
    return {
      state: "recovery_required",
      reasonCode: "web_key_delete_failed",
      cleanedIds: uniqueSorted(journal.cleanedIds),
      retainedIds: currentRetained,
      webKeyState: "present",
      sourceStates: states,
    };
  }
  if (journal.state === "deleting_web_key" && currentRetained.length > 0) {
    return {
      state: "recovery_required",
      reasonCode: "web_key_still_has_consumer",
      cleanedIds: uniqueSorted(journal.cleanedIds),
      retainedIds: currentRetained,
      webKeyState: inventory.webKey.presence === "present" ? "present" : "unknown",
      sourceStates: states,
    };
  }
  if (journal.state === "complete" && (currentRetained.length > 0 || inventory.legacyJwk.present || inventory.webKey.presence === "present")) {
    return {
      state: "recovery_required",
      reasonCode: "journal_inconsistent",
      cleanedIds: uniqueSorted(journal.cleanedIds),
      retainedIds: currentRetained,
      webKeyState: inventory.webKey.presence === "present" ? "present" : inventory.webKey.presence === "absent" ? "absent" : "unknown",
      sourceStates: states,
    };
  }

  const cleaned = expected.filter((id) => !currentRetainedSet.has(id));
  const keyState: CredentialCleanupWebKeyState = inventory.webKey.presence === "present"
    ? "present"
    : inventory.webKey.presence === "absent"
      ? journal.webKeyState === "deleted" ? "deleted" : "absent"
      : "unknown";
  return {
    state: currentRetained.length === 0 && !inventory.legacyJwk.present && inventory.webKey.presence === "absent"
      ? "complete"
      : journal.state === "idle" ? "idle" : journal.state,
    reasonCode: currentRetained.length === 0 && !inventory.legacyJwk.present && inventory.webKey.presence === "absent"
      ? "cleanup_complete"
      : undefined,
    cleanedIds: uniqueSorted(cleaned),
    retainedIds: currentRetained,
    webKeyState: keyState,
    sourceStates: states,
  };
}
