import type { ManagedStorageHostConfig } from "../../../platform/managed-storage.js";
import type { DiagnosticHistoryOpen } from "../../../types/domains/diagnostic-history.ts";
import { createDiagnosticHistoryRepository } from "./repository-core.ts";

/** 仅内部 server composition；无 root string、IO injection 或 verified JSON import API。 */
export function openDiagnosticHistoryRepository(config: ManagedStorageHostConfig): DiagnosticHistoryOpen {
  return createDiagnosticHistoryRepository(config);
}
