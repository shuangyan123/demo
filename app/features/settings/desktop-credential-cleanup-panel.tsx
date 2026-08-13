"use client";

import { Button } from "../shared/ui-primitives";
import { useDesktopCredentialCleanup } from "./use-desktop-credential-cleanup.ts";

const STATUS_LABELS = {
  deferred: "Foundation / deferred",
  blocked: "Blocked",
  already_cleaned: "Already clear",
  unavailable: "Unavailable",
} as const;

/** Readiness-only projection. There is intentionally no confirmation or destructive action in this component. */
export function DesktopCredentialCleanupPanel() {
  const cleanup = useDesktopCredentialCleanup();
  if (cleanup.loading || !cleanup.visible) return null;

  return (
    <section
      aria-label="Desktop credential cleanup readiness"
      className="mb-6 grid gap-3 border border-line bg-surface px-4 py-3"
      data-status={cleanup.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Credential cleanup foundation</h2>
          <p className="text-sm text-muted">Status: {STATUS_LABELS[cleanup.status]}</p>
        </div>
        {cleanup.canReview ? (
          <Button size="sm" variant="outline" disabled={cleanup.busy} onClick={() => void cleanup.review()}>
            Review readiness
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="text-sm text-muted" role="status">{cleanup.message}</p>
      <p className="text-xs text-muted">{cleanup.detail}</p>
    </section>
  );
}
