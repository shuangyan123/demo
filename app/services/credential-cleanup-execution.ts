import { getCleanupHostStatus } from "./credential-cleanup-inventory.ts";
import {
  executeCredentialCleanup,
  type CredentialCleanupExecutionResult,
} from "./credential-cleanup-service.ts";

/** The only production-facing input that can cross the destructive boundary. */
export type CredentialCleanupExecutionRequest = {
  confirmationInventoryVersion: string;
  confirmationAcknowledged: boolean;
  resume?: boolean;
};

function safeResult(
  status: CredentialCleanupExecutionResult["status"],
  state: CredentialCleanupExecutionResult["state"],
  reasonCode: CredentialCleanupExecutionResult["reasonCode"],
): CredentialCleanupExecutionResult {
  return {
    status,
    state,
    reasonCode,
    cleanedCount: 0,
    retainedCount: 0,
    webKeyState: "unknown",
  };
}

/**
 * Narrow production facade for the Settings action. It owns the Desktop-only
 * gate and acknowledgement contract; all ordering and persistence remain in
 * the tested cleanup executor.
 */
export async function executeDesktopCredentialCleanup(
  request: CredentialCleanupExecutionRequest,
): Promise<CredentialCleanupExecutionResult> {
  if (!request
    || request.confirmationAcknowledged !== true
    || typeof request.confirmationInventoryVersion !== "string"
    || !request.confirmationInventoryVersion.trim()) {
    return safeResult("awaiting_confirmation", "awaiting_confirmation", "cleanup_deferred");
  }

  let host: Awaited<ReturnType<typeof getCleanupHostStatus>>;
  try {
    host = await getCleanupHostStatus();
  } catch {
    return safeResult("blocked", "blocked", "desktop_host_unavailable");
  }
  if (host.kind !== "desktop") {
    return safeResult("cancelled", "cancelled", "cleanup_deferred");
  }
  if (host.status !== "available") {
    return safeResult("blocked", "blocked", "desktop_host_unavailable");
  }

  return executeCredentialCleanup({
    confirmed: true,
    confirmationInventoryVersion: request.confirmationInventoryVersion,
    resume: request.resume === true,
  });
}
