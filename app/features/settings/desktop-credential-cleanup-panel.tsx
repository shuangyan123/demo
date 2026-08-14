"use client";

import { Button } from "../shared/ui-primitives";
import { useDesktopCredentialCleanup } from "./use-desktop-credential-cleanup.ts";

const STATUS_LABELS = {
  deferred: "Review available",
  review: "Review available",
  blocked: "Blocked",
  awaiting_confirmation: "Awaiting confirmation",
  verifying: "Verifying",
  deleting_sources: "Deleting sources",
  deleting_web_key: "Final key boundary",
  complete: "Complete",
  partial: "Partial cleanup",
  recovery_required: "Recovery required",
  cancelled: "Cancelled",
  unavailable: "Unavailable",
} as const;

const RECOVERY_STATUSES = new Set(["partial", "recovery_required"]);

/** Production cleanup entry: review, acknowledge impact, then explicitly confirm. */
export function DesktopCredentialCleanupPanel() {
  const cleanup = useDesktopCredentialCleanup();
  if (cleanup.loading || !cleanup.visible) return null;

  const recovery = RECOVERY_STATUSES.has(cleanup.status);
  const reviewLabel = recovery ? "Review recovery" : cleanup.status === "awaiting_confirmation" ? "Refresh review" : "Review cleanup";

  return (
    <section
      aria-label="Desktop credential cleanup"
      className="mb-6 grid gap-3 border border-line bg-surface px-4 py-3"
      data-status={cleanup.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Credential cleanup</h2>
          <p className="text-sm text-muted">Status: {STATUS_LABELS[cleanup.status]}</p>
        </div>
        {cleanup.canReview ? (
          <Button size="sm" variant="outline" disabled={cleanup.busy} onClick={() => void cleanup.review()}>
            {reviewLabel}
          </Button>
        ) : null}
      </div>

      <p aria-live="polite" className="text-sm text-muted" role="status">{cleanup.message}</p>
      <p className="text-xs text-muted">{cleanup.detail}</p>

      {cleanup.credentialCount !== undefined ? (
        <p className="text-xs text-muted">
          Observed {cleanup.credentialCount} credential(s) across {cleanup.sourceCount ?? 0} retained source(s).
          Shared Web key present: {cleanup.webKeyPresent ? "yes" : "no"}.
        </p>
      ) : null}

      {cleanup.confirmationRequired ? (
        <fieldset className="grid gap-3 border border-line p-3" disabled={cleanup.busy}>
          <legend className="px-1 text-sm font-semibold">Irreversible confirmation</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={cleanup.confirmationAcknowledged}
              onChange={(event) => cleanup.acknowledge(event.currentTarget.checked)}
            />
            <span>
              I understand that deleting retained Web recovery material may require re-entering credentials for Web-only,
              older-version, different-profile, or different-machine use.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" disabled={!cleanup.canConfirm} onClick={() => void cleanup.confirm()}>
              {cleanup.canResume ? "Resume cleanup" : "Confirm and clean"}
            </Button>
            <Button size="sm" variant="ghost" disabled={!cleanup.canCancel} onClick={cleanup.cancel}>Cancel</Button>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
