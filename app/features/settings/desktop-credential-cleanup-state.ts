import type { CredentialCleanupReview } from "../../services/credential-cleanup-review.ts";

export type DesktopCredentialCleanupUiStatus = "deferred" | "blocked" | "already_cleaned" | "unavailable";

export type DesktopCredentialCleanupUiModel = {
  visible: boolean;
  status: DesktopCredentialCleanupUiStatus;
  message: string;
  detail: string;
  busy: boolean;
  canReview: boolean;
  credentialCount?: number;
  sourceCount?: number;
  webKeyPresent?: boolean;
};

const SAFE_MESSAGES: Record<DesktopCredentialCleanupUiStatus, string> = {
  deferred: "Cleanup foundation is installed, but destructive cleanup is disabled in this phase.",
  blocked: "Cleanup review is blocked until the migration and physical storage checks are safe.",
  already_cleaned: "No retained Web credential material was found by the read-only review.",
  unavailable: "Desktop credential protection is unavailable. No cleanup action is available.",
};

function hidden(): DesktopCredentialCleanupUiModel {
  return { visible: false, status: "deferred", message: "", detail: "", busy: false, canReview: false };
}

export function projectDesktopCredentialCleanup(input: {
  hostKind: "desktop" | "web" | "server";
  hostStatus: "available" | "unavailable" | "unsupported" | "temporarily_unavailable";
  review?: CredentialCleanupReview;
  busy?: boolean;
}): DesktopCredentialCleanupUiModel {
  if (input.hostKind !== "desktop") return hidden();
  if (input.busy) {
    return {
      visible: true,
      status: "deferred",
      message: "Reviewing physical credential state…",
      detail: "This read-only check does not decrypt, migrate, delete, or regenerate credentials.",
      busy: true,
      canReview: false,
    };
  }
  if (input.hostStatus !== "available") {
    return {
      visible: true,
      status: "unavailable",
      message: SAFE_MESSAGES.unavailable,
      detail: "The existing migration remains unchanged; Web fallback and automatic key regeneration are disabled.",
      busy: false,
      canReview: true,
    };
  }
  if (!input.review) {
    return {
      visible: true,
      status: "deferred",
      message: SAFE_MESSAGES.deferred,
      detail: "Review readiness only. This UI cannot confirm or execute source/key deletion.",
      busy: false,
      canReview: true,
    };
  }
  const status: DesktopCredentialCleanupUiStatus = input.review.decision === "blocked"
    ? "blocked"
    : input.review.decision === "already_cleaned"
      ? "already_cleaned"
      : "deferred";
  const detail = status === "already_cleaned"
    ? "The review found no retained Web source or shared Web key requiring cleanup."
    : `Observed ${input.review.credentialCount} credential(s) across ${input.review.sourceCount} retained source(s). Web key present: ${input.review.webKeyPresent ? "yes" : "no"}. Destructive cleanup remains disabled.`;
  return {
    visible: true,
    status,
    message: SAFE_MESSAGES[status],
    detail,
    busy: false,
    canReview: true,
    credentialCount: input.review.credentialCount,
    sourceCount: input.review.sourceCount,
    webKeyPresent: input.review.webKeyPresent,
  };
}
