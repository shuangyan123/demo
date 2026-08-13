import assert from "node:assert/strict";
import test from "node:test";
import { projectDesktopCredentialCleanup } from "./desktop-credential-cleanup-state.ts";
import type { CredentialCleanupReview } from "../../services/credential-cleanup-review.ts";

const eligibleReview: CredentialCleanupReview = {
  host: { kind: "desktop", status: "available" },
  decision: "eligible",
  credentialCount: 2,
  sourceCount: 3,
  webKeyPresent: true,
  inventoryVersion: "internal-fingerprint",
  journalState: "idle",
  migrationState: "complete",
};

test("Web never exposes the Desktop cleanup execution entry", () => {
  const model = projectDesktopCredentialCleanup({
    hostKind: "web",
    hostStatus: "available",
    review: eligibleReview,
    reviewed: true,
  });
  assert.equal(model.visible, false);
  assert.equal(model.canConfirm, false);
});

test("cleanup review requires a second explicit acknowledgement before confirmation", () => {
  const review = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "available",
    review: eligibleReview,
    reviewed: true,
  });
  assert.equal(review.status, "awaiting_confirmation");
  assert.equal(review.confirmationRequired, true);
  assert.equal(review.canConfirm, false);

  const confirmed = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "available",
    review: eligibleReview,
    reviewed: true,
    confirmationAcknowledged: true,
  });
  assert.equal(confirmed.canConfirm, true);
  assert.equal(confirmed.canResume, false);
});

test("blocked cleanup has no destructive confirmation action", () => {
  const model = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "available",
    review: { ...eligibleReview, decision: "blocked", reasonCode: "legacy_source_present" },
    reviewed: true,
  });
  assert.equal(model.status, "blocked");
  assert.equal(model.confirmationRequired, false);
  assert.match(model.detail, /legacy credential material/);
  assert.doesNotMatch(model.detail, /legacy_source_present/);
});

test("Host unavailable never presents a durable completion as actionable", () => {
  const model = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "unavailable",
    review: { ...eligibleReview, journalState: "complete" },
  });
  assert.equal(model.status, "unavailable");
  assert.equal(model.confirmationRequired, false);
  assert.equal(model.canConfirm, false);
});

test("partial cleanup is surfaced after reload and requires an explicit recovery review", () => {
  const partialReview = {
    ...eligibleReview,
    decision: "blocked" as const,
    reasonCode: "migration_recovery_required" as const,
    journalState: "partial" as const,
  };
  const afterReload = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "available",
    review: partialReview,
  });
  assert.equal(afterReload.status, "partial");
  assert.equal(afterReload.confirmationRequired, false);

  const recoveryReview = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "available",
    review: partialReview,
    reviewed: true,
    confirmationAcknowledged: true,
  });
  assert.equal(recoveryReview.canResume, true);
});

test("UI projection contains no inventory fingerprint or internal journal material", () => {
  const model = projectDesktopCredentialCleanup({
    hostKind: "desktop",
    hostStatus: "available",
    review: eligibleReview,
    reviewed: true,
  });
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /internal-fingerprint|sourceId|credentialId|ciphertext|payload|stack|C:\\\\Users\\/i);
});
