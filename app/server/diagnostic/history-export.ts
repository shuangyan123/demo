import { createHash } from "node:crypto";
import type { DiagnosticHistoryExportV1 } from "../../types/domains/diagnostic-history-export.ts";
import { readDiagnosticExportSnapshot } from "./runtime.ts";

export type DiagnosticHistoryExportResult =
  | { kind: "exported"; source: string }
  | { kind: "unavailable" | "incomplete" | "invalid" | "busy" };

/** 只读既有 Host-composed repository；不能借导出初始化、修复、过滤坏记录或接收路径。 */
export function exportDiagnosticHistory(): DiagnosticHistoryExportResult {
  const read = readDiagnosticExportSnapshot();
  if (read.kind !== "complete") {
    if (read.kind === "uninitialized" || read.kind === "incomplete") return { kind: "incomplete" };
    if (read.kind === "corrupt" || read.kind === "unsupported_version" || read.kind === "conflict") return { kind: "invalid" };
    if (read.kind === "unavailable" && read.reason === "operation_in_progress") return { kind: "busy" };
    return { kind: "unavailable" };
  }
  // 显式投影学习事实。设备 identity、路径、generation 和磁盘 integrity 都不跨设备复制。
  const captures = read.snapshot.captures.map((capture) => ({
    schemaVersion: capture.schemaVersion, id: capture.id, sourceOwnerId: capture.sourceOwnerId,
    specId: capture.specId, specRevision: capture.specRevision, contentRevision: capture.contentRevision,
    optionIds: [...capture.optionIds], responseFormat: { kind: capture.responseFormat.kind, schemaVersion: capture.responseFormat.schemaVersion },
    selectedOptionId: capture.selectedOptionId, assistance: capture.assistance, occurredAt: capture.occurredAt,
    provenance: { mechanism: capture.provenance.mechanism, presentation: capture.provenance.presentation,
      assistanceBasis: capture.provenance.assistanceBasis, ordering: capture.provenance.ordering },
  }));
  const payload: Omit<DiagnosticHistoryExportV1, "integrity"> = {
    format: "recall-diagnostic-history-export", formatVersion: 1, exportedAt: new Date().toISOString(),
    sourceOwnerId: "recall-diagnostic", scope: "all_durable_captures_in_current_source_epoch",
    restoreSupport: "not_implemented", notice: "目前不可导入恢复", authority: "unverified_portable_copy", captureCount: captures.length, captures,
  };
  // SHA-256 只检查意外损坏；可编辑 JSON 的 provenance 声明不能变成 verified authority。
  const integrity = { algorithm: "sha256" as const, digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
  return { kind: "exported", source: JSON.stringify({ ...payload, integrity } satisfies DiagnosticHistoryExportV1) };
}
