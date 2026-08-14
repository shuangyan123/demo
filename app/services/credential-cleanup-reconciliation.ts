import {
  isRetainedWebSource,
  type CredentialCleanupInventory,
  type CredentialCleanupSource,
} from "./credential-cleanup-inventory.ts";
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

const LEGACY_JWK_SOURCE_ID = "review_workspace_crypto_key_v1";
const WEB_KEY_SOURCE_ID = "primary-aes-gcm-v2";
const IN_FLIGHT_STATES = new Set<CredentialCleanupState>([
  "preflight",
  "verifying",
  "deleting_sources",
  "deleting_web_key",
]);

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function webKeyState(inventory: CredentialCleanupInventory): CredentialCleanupWebKeyState {
  return inventory.webKey.presence === "present"
    ? "present"
    : inventory.webKey.presence === "absent" ? "absent" : "unknown";
}

function retainedIds(inventory: CredentialCleanupInventory): string[] {
  return uniqueSorted(inventory.sources
    .filter(isRetainedWebSource)
    .flatMap((source) => source.credentialId ? [source.credentialId] : []));
}

function sourceFingerprint(source: CredentialCleanupSource): string {
  return [
    source.sourceId,
    source.credentialId ?? "",
    source.kind,
    source.storage,
    source.storageLocation,
    source.authority ?? "none",
    String(source.present),
    String(source.recordCount),
    source.reasonCodes.join(","),
  ].join("=");
}

type ParsedInventoryVersion = {
  sources: Map<string, string>;
  migration: string;
  webKey: string;
  legacyJwk: string;
};

function parseInventoryVersion(version: string): ParsedInventoryVersion | undefined {
  const parts = version.split("|");
  const migrationIndex = parts.findIndex((part) => part.startsWith("migration="));
  if (migrationIndex < 0 || parts.length !== migrationIndex + 3) return undefined;
  const sources = new Map<string, string>();
  for (const part of parts.slice(0, migrationIndex)) {
    const sourceId = part.split("=", 1)[0];
    if (!sourceId || part.split("=").length < 9) return undefined;
    sources.set(sourceId, part);
  }
  const [migration, webKey, legacyJwk] = parts.slice(migrationIndex);
  if (!webKey.startsWith("web-key=") || !legacyJwk.startsWith("legacy-jwk=")) return undefined;
  return { sources, migration, webKey, legacyJwk };
}

function sourceStates(
  inventory: CredentialCleanupInventory,
  journal: CredentialCleanupJournal,
): Record<string, CredentialCleanupSourceState> {
  const states: Record<string, CredentialCleanupSourceState> = { ...journal.sourceStates };
  for (const source of inventory.sources) {
    if (source.kind === "desktop-store") continue;
    states[source.sourceId] ??= isRetainedWebSource(source) ? "retained" : "pending";
  }
  return states;
}

/**
 * Explain only physical differences that the durable journal already records
 * as successful destructive progress. All other drift remains recovery-required.
 */
function explainsExpectedDestructiveDrift(
  journal: CredentialCleanupJournal,
  inventory: CredentialCleanupInventory,
): boolean {
  const previous = parseInventoryVersion(journal.inventoryVersion);
  const current = parseInventoryVersion(inventory.inventoryVersion);
  if (!previous || !current || previous.migration !== current.migration) return false;

  const currentSources = new Map(inventory.sources
    .filter((source) => source.kind !== "desktop-store")
    .map((source) => [source.sourceId, source] as const));

  for (const [sourceId, previousFingerprint] of previous.sources) {
    if (previousFingerprint.split("=")[2] === "desktop-store") continue;
    const state = journal.sourceStates[sourceId];
    const source = currentSources.get(sourceId);
    if (!state) return false;
    if (state === "cleaned") {
      // A cleaned source may leave a non-secret record, but credential material
      // must not be present again.
      if (source && isRetainedWebSource(source)) return false;
      continue;
    }
    if (!source || sourceFingerprint(source) !== previousFingerprint) return false;
  }

  // A new physical source is never explained by an older cleanup journal.
  for (const source of currentSources.values()) {
    if (!previous.sources.has(source.sourceId)) return false;
  }

  const previousWebKey = previous.webKey === "web-key=present";
  const currentWebKey = current.webKey === "web-key=absent";
  if (previous.webKey !== current.webKey
    && !(previousWebKey && currentWebKey
      && journal.webKeyState === "deleted"
      && journal.sourceStates[WEB_KEY_SOURCE_ID] === "cleaned")) {
    return false;
  }

  const previousLegacy = previous.legacyJwk === "legacy-jwk=true";
  const currentLegacy = current.legacyJwk === "legacy-jwk=false";
  if (previous.legacyJwk !== current.legacyJwk
    && !(previousLegacy && currentLegacy && journal.sourceStates[LEGACY_JWK_SOURCE_ID] === "cleaned")) {
    return false;
  }

  // Cleanup must never proceed when an expected Desktop recovery record has
  // disappeared, even if a Web source was already durably cleaned.
  return journal.expectedIds.every((id) => inventory.desktopCredentialIds.includes(id));
}

/**
 * 将 durable journal 与一次新的物理观察对齐。已记录的 source/key 删除
 * 可以解释相应的 inventory drift；新增、重现、未记录缺失和 key 顺序异常
 * 仍然进入恢复态，不猜测用户意图，也不自动重放删除。
 */
export function reconcileCredentialCleanup(
  journal: CredentialCleanupJournal,
  inventory: CredentialCleanupInventory,
): CredentialCleanupReconciliation {
  const expected = uniqueSorted(inventory.migration.expectedIds);
  const expectedSet = new Set(expected);
  const currentRetained = retainedIds(inventory);
  const currentRetainedSet = new Set(currentRetained);
  const states = sourceStates(inventory, journal);

  if (journal.state !== "idle" && currentRetained.length > 0 && inventory.webKey.presence === "absent") {
    return {
      state: "recovery_required",
      reasonCode: "journal_inconsistent",
      cleanedIds: uniqueSorted(journal.cleanedIds),
      retainedIds: currentRetained,
      webKeyState: "absent",
      sourceStates: states,
    };
  }

  if (journal.expectedIds.length > 0 && JSON.stringify(journal.expectedIds) !== JSON.stringify(expected)) {
    return {
      state: "recovery_required",
      reasonCode: "physical_inventory_changed",
      cleanedIds: [],
      retainedIds: currentRetained,
      webKeyState: webKeyState(inventory),
      sourceStates: states,
    };
  }
  if (journal.inventoryVersion && journal.state !== "idle"
    && journal.inventoryVersion !== inventory.inventoryVersion
    && !explainsExpectedDestructiveDrift(journal, inventory)) {
    return {
      state: "recovery_required",
      reasonCode: "physical_inventory_changed",
      cleanedIds: [],
      retainedIds: currentRetained,
      webKeyState: webKeyState(inventory),
      sourceStates: states,
    };
  }
  if (journal.cleanedIds.some((id) => currentRetainedSet.has(id))) {
    return {
      state: "recovery_required",
      reasonCode: "source_cleanup_failed",
      cleanedIds: journal.cleanedIds.filter((id) => !currentRetainedSet.has(id)),
      retainedIds: currentRetained,
      webKeyState: webKeyState(inventory),
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
  if (journal.state === "deleting_web_key" && (currentRetained.length > 0 || inventory.legacyJwk.present)) {
    return {
      state: "recovery_required",
      reasonCode: "web_key_still_has_consumer",
      cleanedIds: uniqueSorted(journal.cleanedIds),
      retainedIds: currentRetained,
      webKeyState: webKeyState(inventory),
      sourceStates: states,
    };
  }
  if (journal.state === "complete" && (currentRetained.length > 0 || inventory.legacyJwk.present || inventory.webKey.presence === "present")) {
    return {
      state: "recovery_required",
      reasonCode: "journal_inconsistent",
      cleanedIds: uniqueSorted(journal.cleanedIds),
      retainedIds: currentRetained,
      webKeyState: webKeyState(inventory),
      sourceStates: states,
    };
  }

  const cleaned = uniqueSorted(journal.cleanedIds.filter((id) => expectedSet.has(id)));
  const keyState: CredentialCleanupWebKeyState = inventory.webKey.presence === "present"
    ? "present"
    : inventory.webKey.presence === "absent"
      ? journal.webKeyState === "deleted" ? "deleted" : "absent"
      : "unknown";
  // A recovery journal with source-level evidence can be explicitly resumed.
  // Corrupt journals remain recovery-required until a separate repair flow.
  const resumableRecovery = journal.state === "recovery_required"
    && journal.reasonCode !== "journal_inconsistent"
    && journal.expectedIds.length > 0
    && Boolean(journal.inventoryVersion);
  const reconciledState = journal.state === "recovery_required" && !resumableRecovery
    ? "recovery_required"
    : journal.state === "recovery_required"
      ? "partial"
      : IN_FLIGHT_STATES.has(journal.state)
        ? "partial"
        : journal.state;
  return {
    state: currentRetained.length === 0 && !inventory.legacyJwk.present && inventory.webKey.presence === "absent"
      ? "complete"
      : reconciledState,
    reasonCode: currentRetained.length === 0 && !inventory.legacyJwk.present && inventory.webKey.presence === "absent"
      ? "cleanup_complete"
      : reconciledState === "recovery_required" ? journal.reasonCode : undefined,
    cleanedIds: cleaned,
    retainedIds: currentRetained,
    webKeyState: keyState,
    sourceStates: states,
  };
}
