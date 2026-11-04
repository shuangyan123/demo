import type { DiagnosticCapturedAttemptV1 } from "./first-party-diagnostic-capture.ts";

/** 独立只读归档，不是 LocalDataExportV2，也不是可被 owner 准入的 capture capability。 */
export type DiagnosticHistoryExportV1 = Readonly<{
  format: "recall-diagnostic-history-export";
  formatVersion: 1;
  exportedAt: string;
  sourceOwnerId: "recall-diagnostic";
  scope: "all_durable_captures_in_current_source_epoch";
  restoreSupport: "not_implemented";
  notice: "目前不可导入恢复";
  authority: "unverified_portable_copy";
  captureCount: number;
  captures: readonly DiagnosticCapturedAttemptV1[];
  integrity: Readonly<{ algorithm: "sha256"; digest: string }>;
}>;
