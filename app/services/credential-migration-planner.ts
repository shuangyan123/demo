export type CredentialInventoryStorage =
  | "desktop-v1"
  | "web-v2"
  | "legacy-v1"
  | "missing"
  | "invalid"
  | "masked-only"
  | "unavailable"
  | "unknown";

export type CredentialInventoryItem = {
  /** 只允许稳定记录标识，不允许传入凭据、密文或掩码值。 */
  id: string;
  storage: CredentialInventoryStorage;
};

export type CredentialMigrationHost =
  | { kind: "web" }
  | {
      kind: "desktop";
      availability: "available" | "unavailable" | "unsupported" | "temporarily_unavailable";
    };

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

export type CredentialMigrationDecision = "eligible" | "blocked" | "no_op" | "requires_reentry";

export type CredentialMigrationReason =
  | "no_credentials"
  | "web_mode"
  | "already_host_protected"
  | "desktop_host_unavailable"
  | "legacy_requires_web_normalization"
  | "invalid_inventory"
  | "masked_only_rejected"
  | "requires_reentry"
  | "ready_for_phase_2"
  | "recovery_required"
  | "state_inconsistent"
  | "cancelled";

export type CredentialMigrationItemPlan = CredentialInventoryItem & {
  action: "retain" | "stage" | "already_protected" | "normalize_first" | "reenter" | "reject";
};

export type CredentialMigrationPlan = {
  decision: CredentialMigrationDecision;
  reason: CredentialMigrationReason;
  nextState: CredentialMigrationState;
  retryable: boolean;
  readStrategy: "web_only" | "desktop_first_web_fallback";
  writeStrategy: "web_only" | "desktop_preferred";
  destructiveActions: "none_phase_2";
  items: CredentialMigrationItemPlan[];
};

function isReentryStorage(storage: CredentialInventoryStorage): boolean {
  return storage === "missing" || storage === "unavailable";
}

const INVENTORY_ID_PATTERN = /^[A-Za-z0-9._~-]+(?::[A-Za-z0-9._~-]+)*$/;
const INVENTORY_STORAGES = new Set<CredentialInventoryStorage>([
  "desktop-v1",
  "web-v2",
  "legacy-v1",
  "missing",
  "invalid",
  "masked-only",
  "unavailable",
  "unknown",
]);

function compareInventoryIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeInventory(input: {
  expectedIds: readonly string[];
  inventory: readonly CredentialInventoryItem[];
}): { valid: boolean; items: CredentialInventoryItem[] } {
  const expectedIds = [...input.expectedIds].sort(compareInventoryIds);
  const inventory = [...input.inventory].sort((left, right) => compareInventoryIds(left.id, right.id));
  const expectedSet = new Set(expectedIds);
  const expectedSeen = new Set<string>();
  const expectedValid = expectedIds.every((id) => {
    const itemValid = INVENTORY_ID_PATTERN.test(id) && !expectedSeen.has(id);
    expectedSeen.add(id);
    return itemValid;
  });
  const inventorySeen = new Set<string>();
  const valid = expectedValid
    && inventory.every((item) => {
      const itemValid = INVENTORY_ID_PATTERN.test(item.id)
        && expectedSet.has(item.id)
        && INVENTORY_STORAGES.has(item.storage)
        && !inventorySeen.has(item.id);
      inventorySeen.add(item.id);
      return itemValid;
    });
  if (!valid) return { valid: false, items: inventory };

  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  return {
    valid: true,
    items: expectedIds.map((id) => inventoryById.get(id) ?? { id, storage: "missing" }),
  };
}

function planItems(items: readonly CredentialInventoryItem[], desktopReady: boolean): CredentialMigrationItemPlan[] {
  return items.map((item) => ({
    ...item,
    action: item.storage === "desktop-v1"
      ? "already_protected"
      : item.storage === "web-v2" && desktopReady
        ? "stage"
        : item.storage === "legacy-v1"
          ? "normalize_first"
          : item.storage === "masked-only" || item.storage === "invalid" || item.storage === "unknown"
            ? "reject"
            : isReentryStorage(item.storage)
              ? "reenter"
              : "retain",
  }));
}

function basePlan(items: readonly CredentialInventoryItem[], desktopReady: boolean): CredentialMigrationPlan {
  return {
    decision: "blocked",
    reason: "invalid_inventory",
    nextState: "blocked",
    retryable: false,
    readStrategy: desktopReady ? "desktop_first_web_fallback" : "web_only",
    writeStrategy: desktopReady ? "desktop_preferred" : "web_only",
    destructiveActions: "none_phase_2",
    items: planItems(items, desktopReady),
  };
}

/**
 * Phase 1 只计算后续迁移资格，不读取、解密、联网、写入或删除任何凭据。
 * 来源材料始终保留；即使 eligible，也只表示可以进入后续 staging 阶段。
 */
export function planCredentialMigration(input: {
  host: CredentialMigrationHost;
  expectedIds: readonly string[];
  inventory: readonly CredentialInventoryItem[];
  state?: CredentialMigrationState;
}): CredentialMigrationPlan {
  const normalized = normalizeInventory(input);
  const items = normalized.items;
  const desktopReady = input.host.kind === "desktop" && input.host.availability === "available";
  const plan = basePlan(items, desktopReady);
  if (!normalized.valid) return plan;
  if (!items.length) {
    return { ...plan, decision: "no_op", reason: "no_credentials", nextState: "complete", retryable: false };
  }

  if (items.some((item) => isReentryStorage(item.storage))) {
    return { ...plan, decision: "requires_reentry", reason: "requires_reentry", nextState: "blocked", retryable: false };
  }
  if (items.some((item) => item.storage === "masked-only")) {
    return { ...plan, decision: "requires_reentry", reason: "masked_only_rejected", nextState: "blocked", retryable: false };
  }
  if (items.some((item) => item.storage === "invalid" || item.storage === "unknown")) {
    return { ...plan, decision: "blocked", reason: "invalid_inventory", nextState: "blocked", retryable: false };
  }
  if (items.some((item) => item.storage === "legacy-v1")) {
    return { ...plan, decision: "blocked", reason: "legacy_requires_web_normalization", nextState: "blocked", retryable: false };
  }

  const hasWebRecords = items.some((item) => item.storage === "web-v2");
  if (!hasWebRecords) {
    return { ...plan, decision: "no_op", reason: "already_host_protected", nextState: "complete", retryable: false };
  }
  if (input.host.kind === "web") {
    return {
      ...plan,
      decision: "no_op",
      reason: "web_mode",
      nextState: "idle",
      retryable: false,
      readStrategy: "web_only",
      writeStrategy: "web_only",
      items: planItems(items, false),
    };
  }
  if (!desktopReady) {
    return { ...plan, decision: "blocked", reason: "desktop_host_unavailable", nextState: "blocked", retryable: true };
  }
  if (input.state === "committing" || input.state === "recovery_required") {
    return { ...plan, decision: "blocked", reason: "recovery_required", nextState: "recovery_required", retryable: false };
  }
  if (input.state === "complete") {
    return { ...plan, decision: "blocked", reason: "state_inconsistent", nextState: "recovery_required", retryable: false };
  }

  if (input.state === "cancelled") {
    return { ...plan, decision: "eligible", reason: "cancelled", nextState: "preflight", retryable: true };
  }

  const resumableStates = new Set<CredentialMigrationState>(["preflight", "staging", "verifying", "ready_to_commit"]);
  const nextState = input.state && resumableStates.has(input.state) ? input.state : "preflight";
  return {
    ...plan,
    decision: "eligible",
    reason: "ready_for_phase_2",
    nextState,
    retryable: true,
  };
}
