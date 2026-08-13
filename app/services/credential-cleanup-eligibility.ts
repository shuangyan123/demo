import type {
  CredentialCleanupInventory,
  CredentialCleanupSource,
} from "./credential-cleanup-inventory.ts";
import { isRetainedWebSource } from "./credential-cleanup-inventory.ts";
import type {
  CredentialCleanupJournal,
  CredentialCleanupReasonCode,
} from "./credential-cleanup-state.ts";

export type CredentialCleanupHostStatus = {
  kind: "desktop" | "web" | "server";
  status: "available" | "unavailable" | "unsupported" | "temporarily_unavailable";
};

export type CredentialCleanupEligibilityDecision = "eligible" | "blocked" | "already_cleaned" | "deferred";

export type CredentialCleanupEligibility = {
  decision: CredentialCleanupEligibilityDecision;
  reasonCode?: CredentialCleanupReasonCode;
  expectedIds: string[];
  desktopCredentialIds: string[];
  retainedWebSourceIds: string[];
  legacySourceIds: string[];
  webKeyState: CredentialCleanupInventory["webKey"]["presence"];
  legacyJwkPresent: boolean;
  inventoryVersion: string;
  impact: {
    credentialCount: number;
    sourceCount: number;
    webSourceCount: number;
    legacySourceCount: number;
    webKeyPresent: boolean;
  };
};

export type CredentialCleanupEligibilityInput = {
  inventory: CredentialCleanupInventory;
  host: CredentialCleanupHostStatus;
  cleanupJournal?: CredentialCleanupJournal;
  confirmationInventoryVersion?: string;
  requireDesktopVerification?: boolean;
  verifiedDesktopIds?: string[];
  failedDesktopIds?: string[];
};

function decision(
  input: CredentialCleanupEligibilityInput,
  next: Pick<CredentialCleanupEligibility, "decision" | "reasonCode">,
): CredentialCleanupEligibility {
  const retainedWebSources = input.inventory.sources.filter(isRetainedWebSource);
  const legacySources = retainedWebSources.filter((source) => source.storage === "legacy-v1" || source.kind === "legacy-ai-setting");
  const credentialIds = new Set(
    retainedWebSources.flatMap((source) => source.credentialId ? [source.credentialId] : []),
  );
  return {
    ...next,
    expectedIds: [...input.inventory.migration.expectedIds],
    desktopCredentialIds: [...input.inventory.desktopCredentialIds],
    retainedWebSourceIds: retainedWebSources.map((source) => source.sourceId),
    legacySourceIds: legacySources.map((source) => source.sourceId),
    webKeyState: input.inventory.webKey.presence,
    legacyJwkPresent: input.inventory.legacyJwk.present,
    inventoryVersion: input.inventory.inventoryVersion,
    impact: {
      credentialCount: credentialIds.size,
      sourceCount: retainedWebSources.length,
      webSourceCount: retainedWebSources.length,
      legacySourceCount: legacySources.length,
      webKeyPresent: input.inventory.webKey.presence === "present",
    },
  };
}

function blocked(input: CredentialCleanupEligibilityInput, reasonCode: CredentialCleanupReasonCode): CredentialCleanupEligibility {
  return decision(input, { decision: "blocked", reasonCode });
}

function hasExpectedDesktopAuthority(input: CredentialCleanupEligibilityInput): CredentialCleanupReasonCode | undefined {
  const { migration } = input.inventory;
  if (migration.expectedIds.some((id) => migration.authorities[id] === "web_primary")) return "web_primary_present";
  if (migration.expectedIds.some((id) => migration.authorities[id] !== "desktop_primary")) return "authority_not_desktop_primary";
  if (migration.expectedIds.some((id) => !input.inventory.desktopCredentialIds.includes(id))) return "missing_desktop_record";
  return undefined;
}

function hasUnsafePhysicalSource(input: CredentialCleanupEligibilityInput): CredentialCleanupReasonCode | undefined {
  for (const source of input.inventory.sources) {
    if (!source.present) continue;
    if (source.storage === "unknown") return "unknown_storage_format";
    if (source.storage === "invalid") return "invalid_storage_format";
    if (source.storage === "legacy-v1") return "legacy_source_present";
    if (source.reasonCodes.includes("credential_requires_reentry")) return "credential_requires_reentry";
    if (source.kind === "desktop-store" && source.reasonCodes.length > 0) return "invalid_storage_format";
    if (source.kind !== "desktop-store" && source.kind !== "web-key" && source.kind !== "legacy-jwk"
      && source.authority !== "desktop_primary") return "authority_not_desktop_primary";
  }
  return undefined;
}

function hasOrphanCompatibilitySource(input: CredentialCleanupEligibilityInput): CredentialCleanupReasonCode | undefined {
  const sources = input.inventory.sources.filter((source) => source.present);
  const canonicalAiIds = new Set(input.inventory.canonicalAiCredentialIds);
  const currentMcpIds = new Set(sources
    .filter((source) => source.kind === "mcp" && source.storageLocation === "local-storage:mcp-v2")
    .flatMap((source) => source.credentialId ? [source.credentialId] : []));
  const currentQuotaIds = new Set(sources
    .filter((source) => source.kind === "quota" && source.sourceId.includes(":credential:"))
    .flatMap((source) => source.credentialId ? [source.credentialId.split(":").slice(0, 2).join(":")] : []));

  for (const source of sources) {
    if (source.kind === "legacy-ai-setting" && canonicalAiIds.size === 0) {
      return "canonical_profile_missing";
    }
    if (source.kind === "mcp" && source.storageLocation === "local-storage:mcp-v1"
      && source.credentialId && !currentMcpIds.has(source.credentialId)) {
      return "orphan_legacy_source";
    }
    if (source.kind === "quota" && source.sourceId.endsWith(":legacy")
      && source.credentialId && !currentQuotaIds.has(source.credentialId.split(":").slice(0, 2).join(":"))) {
      return "orphan_legacy_source";
    }
  }
  return undefined;
}

function isCleanupComplete(input: CredentialCleanupEligibilityInput): boolean {
  return input.inventory.sources.every((source) => !isRetainedWebSource(source))
    && !input.inventory.legacyJwk.present
    && input.inventory.webKey.presence === "absent";
}

/**
 * 纯 eligibility 判断：只消费物理观察结果，不解密、不比较 secret，也不写入任何 durable store。
 */
export function evaluateCredentialCleanupEligibility(input: CredentialCleanupEligibilityInput): CredentialCleanupEligibility {
  const { inventory, host, cleanupJournal } = input;
  if (host.kind !== "desktop") return decision(input, { decision: "deferred", reasonCode: "cleanup_deferred" });
  if (host.status !== "available") return blocked(input, "desktop_host_unavailable");
  if (!inventory.migration.present) return blocked(input, "migration_journal_missing");
  if (inventory.migration.state === "recovery_required") return blocked(input, "migration_recovery_required");
  if (inventory.migration.state !== "complete") return blocked(input, "migration_incomplete");
  if (inventory.migration.backendPolicy !== "desktop_preferred") return blocked(input, "migration_not_desktop_preferred");
  if (inventory.migration.expectedIds.length === 0) return blocked(input, "migration_incomplete");
  if (inventory.migration.committedIds.length !== inventory.migration.expectedIds.length) {
    return blocked(input, "migration_partial_commit");
  }
  if (input.confirmationInventoryVersion && input.confirmationInventoryVersion !== inventory.inventoryVersion) {
    return blocked(input, "physical_inventory_changed");
  }
  if (cleanupJournal?.state === "recovery_required" || cleanupJournal?.state === "partial") {
    return blocked(input, "migration_recovery_required");
  }
  if (cleanupJournal?.state === "complete" && !isCleanupComplete(input)) {
    return blocked(input, "journal_inconsistent");
  }
  if (inventory.webKey.presence === "unavailable") return blocked(input, "invalid_storage_format");

  const authorityReason = hasExpectedDesktopAuthority(input);
  if (authorityReason) return blocked(input, authorityReason);
  const physicalReason = hasUnsafePhysicalSource(input);
  if (physicalReason) return blocked(input, physicalReason);
  const compatibilityReason = hasOrphanCompatibilitySource(input);
  if (compatibilityReason) return blocked(input, compatibilityReason);

  if (input.requireDesktopVerification) {
    const verified = new Set(input.verifiedDesktopIds ?? []);
    if ((input.failedDesktopIds ?? []).length > 0) return blocked(input, "desktop_verification_failed");
    if (inventory.migration.expectedIds.some((id) => !verified.has(id))) return blocked(input, "desktop_verification_required");
  }

  if (cleanupJournal?.state === "cancelled" && !input.confirmationInventoryVersion) {
    return blocked(input, "cleanup_cancelled");
  }
  if (isCleanupComplete(input)) return decision(input, { decision: "already_cleaned", reasonCode: "already_cleaned" });

  const retainedWebSources = inventory.sources.filter(isRetainedWebSource);
  const hasNewCredential = input.confirmationInventoryVersion
    && retainedWebSources.some((source) => source.credentialId && !inventory.migration.expectedIds.includes(source.credentialId));
  if (hasNewCredential) return blocked(input, "new_credential_since_confirmation");
  return decision(input, { decision: "eligible" });
}

export function projectCleanupEligibilityForUi(result: CredentialCleanupEligibility): {
  decision: CredentialCleanupEligibilityDecision;
  reasonCode?: CredentialCleanupReasonCode;
  credentialCount: number;
  sourceCount: number;
  webKeyPresent: boolean;
  inventoryVersion: string;
} {
  return {
    decision: result.decision,
    reasonCode: result.reasonCode,
    credentialCount: result.impact.credentialCount,
    sourceCount: result.impact.sourceCount,
    webKeyPresent: result.impact.webKeyPresent,
    inventoryVersion: result.inventoryVersion,
  };
}

/**
 * Shared Web key deletion has no retained source or legacy JWK left to protect.
 * Keep this narrower than general cleanup eligibility because Web sources are
 * expected while the earlier source-cleanup stage is still eligible.
 */
export function evaluateCredentialCleanupKeyDeletionEligibility(
  input: CredentialCleanupEligibilityInput,
): CredentialCleanupEligibility {
  const result = evaluateCredentialCleanupEligibility(input);
  if (result.decision !== "eligible") return result;
  if (result.retainedWebSourceIds.length > 0 || result.legacyJwkPresent) {
    return blocked(input, "web_key_still_has_consumer");
  }
  return result;
}

export function cleanupSourceIsPresent(source: CredentialCleanupSource): boolean {
  return isRetainedWebSource(source);
}
