import type { CredentialCleanupExecutionStatus } from "../../services/credential-cleanup-service.ts";
import type { CredentialCleanupReasonCode } from "../../services/credential-cleanup-state.ts";
import type { CredentialCleanupReview } from "../../services/credential-cleanup-review.ts";

export type DesktopCredentialCleanupUiStatus =
  | "deferred"
  | "review"
  | "blocked"
  | "awaiting_confirmation"
  | "verifying"
  | "deleting_sources"
  | "deleting_web_key"
  | "complete"
  | "partial"
  | "recovery_required"
  | "cancelled"
  | "unavailable";

export type DesktopCredentialCleanupUiModel = {
  visible: boolean;
  status: DesktopCredentialCleanupUiStatus;
  message: string;
  detail: string;
  busy: boolean;
  canReview: boolean;
  confirmationRequired: boolean;
  confirmationAcknowledged: boolean;
  canConfirm: boolean;
  canResume: boolean;
  canCancel: boolean;
  credentialCount?: number;
  sourceCount?: number;
  webKeyPresent?: boolean;
};

const SAFE_MESSAGES: Record<DesktopCredentialCleanupUiStatus, string> = {
  deferred: "Credential cleanup is available for explicit Desktop review only.",
  review: "Review the retained Web recovery material before choosing any destructive action.",
  blocked: "Cleanup review is blocked until the migration and physical storage checks are safe.",
  awaiting_confirmation: "Review complete. Explicit confirmation is required before cleanup can start.",
  verifying: "Verifying the current Desktop state. No cleanup step can be repeated from this screen.",
  deleting_sources: "Cleanup is removing eligible retained Web sources one at a time.",
  deleting_web_key: "Cleanup is at the final shared Web key boundary.",
  complete: "Credential cleanup completed after final physical reconciliation.",
  partial: "Cleanup partially completed. Explicit recovery or resume is required.",
  recovery_required: "Cleanup requires explicit recovery before any further destructive action.",
  cancelled: "Cleanup was cancelled before a destructive action. Review again before continuing.",
  unavailable: "Desktop credential protection is unavailable. No cleanup action is available.",
};

const IMPACT_MESSAGE = "Deleting retained Web recovery material may require re-entering credentials for Web-only, older-version, different-profile, or different-machine use.";

function hidden(): DesktopCredentialCleanupUiModel {
  return {
    visible: false,
    status: "deferred",
    message: "",
    detail: "",
    busy: false,
    canReview: false,
    confirmationRequired: false,
    confirmationAcknowledged: false,
    canConfirm: false,
    canResume: false,
    canCancel: false,
  };
}
function reasonCategory(reasonCode: CredentialCleanupReasonCode | undefined): string {
  switch (reasonCode) {
    case "migration_journal_missing":
    case "migration_incomplete":
    case "migration_not_desktop_preferred":
    case "migration_partial_commit":
    case "migration_recovery_required":
      return "migration authority is not complete";
    case "desktop_host_unavailable":
    case "desktop_verification_required":
    case "desktop_verification_failed":
      return "Desktop protection cannot be freshly verified";
    case "legacy_source_present":
      return "legacy credential material is present";
    case "physical_inventory_changed":
    case "new_credential_since_confirmation":
      return "physical credential state changed after review";
    case "credential_requires_reentry":
      return "a credential requires explicit re-entry";
    case "journal_inconsistent":
      return "the cleanup journal needs recovery";
    case "web_key_still_has_consumer":
      return "retained Web material still needs protection";
    default:
      return "physical credential state is not safely eligible";
  }
}

function detailFor(review: CredentialCleanupReview | undefined, status: DesktopCredentialCleanupUiStatus): string {
  if (status === "awaiting_confirmation" || status === "partial" || status === "recovery_required") {
    const counts = review
      ? `Observed ${review.credentialCount} credential(s) across ${review.sourceCount} retained source(s). Shared Web key present: ${review.webKeyPresent ? "yes" : "no"}. `
      : "Review the current physical state before continuing. ";
    return `${counts}${IMPACT_MESSAGE}`;
  }
  if (review?.decision === "blocked") {
    return `No credential material was changed. Block category: ${reasonCategory(review.reasonCode)}.`;
  }
  if (status === "complete") {
    return "Final physical reconciliation found no retained Web source, legacy JWK, or shared Web key. Migration authority and Desktop records remain unchanged.";
  }
  if (status === "cancelled") return "No destructive operation was started. A fresh review is required before another confirmation.";
  if (status === "unavailable") return "The existing migration remains unchanged; Web fallback and automatic key regeneration are disabled.";
  return "This read-only state does not decrypt, migrate, delete, or regenerate credentials.";
}

function model(
  status: DesktopCredentialCleanupUiStatus,
  input: {
    review?: CredentialCleanupReview;
    busy?: boolean;
    confirmationRequired?: boolean;
    confirmationAcknowledged?: boolean;
  } = {},
): DesktopCredentialCleanupUiModel {
  const busy = input.busy === true;
  const confirmationRequired = input.confirmationRequired === true;
  const confirmationAcknowledged = confirmationRequired && input.confirmationAcknowledged === true;
  const canConfirm = !busy
    && confirmationRequired
    && confirmationAcknowledged
    && (status === "awaiting_confirmation" || status === "partial" || status === "recovery_required");
  return {
    visible: true,
    status,
    message: SAFE_MESSAGES[status],
    detail: detailFor(input.review, status),
    busy,
    canReview: !busy,
    confirmationRequired,
    confirmationAcknowledged,
    canConfirm,
    canResume: canConfirm && (status === "partial" || status === "recovery_required"),
    canCancel: !busy && confirmationRequired,
    credentialCount: input.review?.credentialCount,
    sourceCount: input.review?.sourceCount,
    webKeyPresent: input.review?.webKeyPresent,
  };
}

function statusFromExecution(status: CredentialCleanupExecutionStatus): DesktopCredentialCleanupUiStatus {
  switch (status) {
    case "awaiting_confirmation": return "awaiting_confirmation";
    case "blocked": return "blocked";
    case "partial": return "partial";
    case "recovery_required": return "recovery_required";
    case "cancelled": return "cancelled";
    case "complete":
    case "already_cleaned":
      return "complete";
  }
}

/**
 * Projects only fixed, safe status text and aggregate counts into React state.
 * Inventory fingerprints and journal metadata remain in the hook's private ref.
 */
export function projectDesktopCredentialCleanup(input: {
  hostKind: "desktop" | "web" | "server";
  hostStatus: "available" | "unavailable" | "unsupported" | "temporarily_unavailable";
  review?: CredentialCleanupReview;
  executionStatus?: CredentialCleanupExecutionStatus;
  reviewed?: boolean;
  confirmationAcknowledged?: boolean;
  busy?: boolean;
}): DesktopCredentialCleanupUiModel {
  if (input.hostKind !== "desktop") return hidden();
  if (input.busy) return model("verifying", { review: input.review, busy: true });

  // A transient executor result never outranks the latest physical Host
  // observation. Unavailable protection is not a current successful
  // reconciliation, and it must not leave a stale resume/confirm action.
  if (input.hostStatus !== "available" || (input.review && input.review.host.status !== "available")) {
    return model("unavailable", { review: input.review });
  }
  if (input.executionStatus) {
    return model(statusFromExecution(input.executionStatus), { review: input.review });
  }
  if (!input.review) {
    if (input.hostStatus !== "available") return model("unavailable");
    return model("deferred");
  }

  const journalState = input.review.journalState;
  const reviewed = input.reviewed === true;
  if (journalState === "complete") return model("complete", { review: input.review });
  if (journalState === "partial") {
    return model("partial", {
      review: input.review,
      confirmationRequired: reviewed,
      confirmationAcknowledged: input.confirmationAcknowledged,
    });
  }
  if (journalState === "recovery_required") {
    return model("recovery_required", {
      review: input.review,
      confirmationRequired: reviewed,
      confirmationAcknowledged: input.confirmationAcknowledged,
    });
  }
  if (journalState === "cancelled") return model("cancelled", { review: input.review });
  if (input.review.decision === "blocked") return model("blocked", { review: input.review });
  if (input.review.decision === "already_cleaned") return model("complete", { review: input.review });
  if (input.review.decision === "eligible" && reviewed) {
    return model("awaiting_confirmation", {
      review: input.review,
      confirmationRequired: true,
      confirmationAcknowledged: input.confirmationAcknowledged,
    });
  }
  return model("review", { review: input.review });
}
