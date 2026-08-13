import type { CredentialCleanupReasonCode } from "./credential-cleanup-state.ts";
import { getCredentialAuthority } from "./credential-migration-state.ts";
import { isCredentialContext } from "./credential-storage-format.ts";

export const DESKTOP_CLEANUP_MASK = "Desktop credential retained";

export type CredentialCleanupSourceResult = {
  credentialId?: string;
  sourceId: string;
  outcome: "cleaned" | "already_cleaned";
};

export type CredentialCleanupSourceFailureCode =
  | "authority_not_desktop_primary"
  | "canonical_profile_missing"
  | "legacy_sources_present"
  | "source_format_invalid"
  | "source_unavailable"
  | "source_write_failed";

export class CredentialCleanupSourceError extends Error {
  readonly code: CredentialCleanupSourceFailureCode;
  readonly reasonCode: CredentialCleanupReasonCode;

  constructor(code: CredentialCleanupSourceFailureCode) {
    const reasonCode: CredentialCleanupReasonCode = code === "authority_not_desktop_primary"
      ? "authority_not_desktop_primary"
      : code === "canonical_profile_missing"
        ? "canonical_profile_missing"
        : code === "legacy_sources_present"
          ? "legacy_source_present"
      : code === "source_format_invalid"
        ? "invalid_storage_format"
        : "source_cleanup_failed";
    super(reasonCode);
    this.name = "CredentialCleanupSourceError";
    this.code = code;
    this.reasonCode = reasonCode;
  }
}

export function isCredentialMaterialPresent(encryptedKey?: string, iv?: string, maskedValue?: string): boolean {
  return Boolean(encryptedKey || iv || (maskedValue && maskedValue !== DESKTOP_CLEANUP_MASK));
}

export function assertDesktopCleanupAuthority(context: string): void {
  if (!isCredentialContext(context) || getCredentialAuthority(context) !== "desktop_primary") {
    throw new CredentialCleanupSourceError("authority_not_desktop_primary");
  }
}

export function cleanupSourceResult(sourceId: string, credentialId: string, outcome: CredentialCleanupSourceResult["outcome"]): CredentialCleanupSourceResult {
  return { sourceId, credentialId, outcome };
}
