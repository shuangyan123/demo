import { collectCredentialCleanupInventory, getCleanupHostStatus } from "./credential-cleanup-inventory.ts";
import {
  evaluateCredentialCleanupEligibility,
  projectCleanupEligibilityForUi,
  type CredentialCleanupHostStatus,
} from "./credential-cleanup-eligibility.ts";
import { readCredentialCleanupJournal } from "./credential-cleanup-state.ts";

export type CredentialCleanupReview = {
  host: CredentialCleanupHostStatus;
  decision: "eligible" | "blocked" | "already_cleaned" | "deferred";
  reasonCode?: ReturnType<typeof evaluateCredentialCleanupEligibility>["reasonCode"];
  credentialCount: number;
  sourceCount: number;
  webKeyPresent: boolean;
  journalState: ReturnType<typeof readCredentialCleanupJournal>["state"];
  migrationState: "idle" | "preflight" | "staging" | "verifying" | "ready_to_commit" | "committing" | "complete" | "blocked" | "recovery_required" | "cancelled";
};

/**
 * Settings 只允许调用这个 read-only facade。它不返回 source ID、ciphertext 或 inventory fingerprint，
 * 也不写 cleanup journal；未来 destructive acceptance 才会消费内部 inventory。
 */
export async function reviewCredentialCleanup(): Promise<CredentialCleanupReview> {
  const [inventory, host] = await Promise.all([
    collectCredentialCleanupInventory(),
    getCleanupHostStatus(),
  ]);
  const journal = readCredentialCleanupJournal();
  const eligibility = evaluateCredentialCleanupEligibility({ inventory, host, cleanupJournal: journal });
  const projection = projectCleanupEligibilityForUi(eligibility);
  return {
    host,
    ...projection,
    journalState: journal.state,
    migrationState: inventory.migration.state,
  };
}
