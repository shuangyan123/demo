import path from "node:path";
import type { ManagedStorageHostConfig } from "../../../platform/managed-storage.js";
import type { IssuedDiagnosticCapturedAttemptV1 } from "../../../types/domains/first-party-diagnostic-capture.ts";
import type { DiagnosticHistoryOpen, DiagnosticHistoryRead, DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import { isIssuedDiagnosticCapture } from "../../../services/first-party-diagnostic/capture-authority-core.ts";
import { isLegacyRecordId } from "../../../services/learning-kernel/learning-event.ts";
import { diagnosticHistoryIO, historyUnavailable, publishDiagnosticSnapshot, type DiagnosticHistoryIO } from "./io.ts";
import { DIAGNOSTIC_HISTORY_MAX_BYTES, DIAGNOSTIC_HISTORY_MAX_CAPTURES, encodeDiagnosticSnapshot, parseDiagnosticSnapshot, validateDiagnosticCapture } from "./record.ts";

const activeRepositories = new Set<string>();
/** 内部 IO seam 仅用于真实文件系统故障 contracts；生产 facade 不接受 caller IO 或序列化记录。 */
export function createDiagnosticHistoryRepository(config: ManagedStorageHostConfig, io: DiagnosticHistoryIO = diagnosticHistoryIO): DiagnosticHistoryOpen {
  const directory = path.join(config.managedFilesRoot, "diagnostic-history");
  const file = path.join(directory, "history.json");
  const writerKey = process.platform === "win32" ? file.toLowerCase() : file;
  if (activeRepositories.has(writerKey)) return historyUnavailable("repository_already_open");
  activeRepositories.add(writerKey);
  let closed = false;
  let committing = false;
  let initialized = false;

  function read(): DiagnosticHistoryRead {
    if (closed) return { kind: "closed" };
    if (committing) return historyUnavailable("operation_in_progress");
    if (io.directoryState(config.managedRoot) !== "available" || io.directoryState(config.profileRoot) !== "available")
      return historyUnavailable("active_profile_unavailable");
    const state = io.directoryState(directory);
    if (state === "missing") return initialized ? { kind: "incomplete", reason: "initialized_repository_missing" } : { kind: "uninitialized" };
    if (state !== "available") return historyUnavailable("repository_directory_unavailable");
    initialized = true; // 域目录是显式初始化 reservation；已有目录绝不能因 record 缺失重建为空。
    const record = io.read(file);
    if (record.kind === "missing") return { kind: "incomplete", reason: "history_record_missing" };
    return record.kind === "record" ? parseDiagnosticSnapshot(record.text, config) : record;
  }

  function commit(snapshot: DiagnosticHistorySnapshotV1, mode: "create" | "replace"): DiagnosticHistoryRead {
    const text = encodeDiagnosticSnapshot(snapshot);
    if (Buffer.byteLength(text, "utf8") > DIAGNOSTIC_HISTORY_MAX_BYTES) return { kind: "rejected", reason: "capacity_exceeded" };
    committing = true;
    try { publishDiagnosticSnapshot(file, text, mode, io); }
    catch { return historyUnavailable("commit_unconfirmed"); }
    finally { committing = false; }
    const result = read();
    if (result.kind !== "complete" || JSON.stringify(result.snapshot) !== JSON.stringify(snapshot)) return historyUnavailable("commit_unconfirmed");
    return result;
  }

  return { kind: "opened", repository: Object.freeze({
    initialize() {
      const current = read();
      if (current.kind !== "uninitialized") return current;
      try {
        if (io.directoryState(config.managedFilesRoot) === "missing") io.createDirectory(config.managedFilesRoot);
        // 不递归创建 active root。reservation 保留，初始化中断不能被 read 解释成 complete-empty。
        io.createDirectory(directory);
        initialized = true;
      } catch { return historyUnavailable("initialization_unconfirmed"); }
      return commit(Object.freeze({ formatVersion: 1, profileId: config.profileId, epochId: config.epochId,
        generation: 0, captures: Object.freeze([]) }), "create");
    },
    appendCapturedAttempt(attempt: IssuedDiagnosticCapturedAttemptV1) {
      const current = read();
      if (current.kind !== "complete") return current;
      if (!isIssuedDiagnosticCapture(attempt)) return { kind: "rejected", reason: "untrusted_capture" };
      const validated = validateDiagnosticCapture(attempt);
      if (validated.kind !== "valid") return validated;
      const existing = current.snapshot.captures.find((item) => item.id === validated.attempt.id);
      if (existing) return JSON.stringify(existing) === JSON.stringify(validated.attempt)
        ? { kind: "confirmed", snapshot: current.snapshot } : { kind: "conflict", reason: "attempt_identity_conflict" };
      if (current.snapshot.captures.length >= DIAGNOSTIC_HISTORY_MAX_CAPTURES) return { kind: "rejected", reason: "capacity_exceeded" };
      const result = commit(Object.freeze({ ...current.snapshot, generation: current.snapshot.generation + 1,
        captures: Object.freeze([...current.snapshot.captures, validated.attempt]) }), "replace");
      return result.kind === "complete" ? { kind: "committed", snapshot: result.snapshot } : result;
    },
    readCompleteSnapshot: read,
    resolveCapturedAttempt(attemptId: string) {
      const current = read();
      if (current.kind !== "complete") return current;
      if (!isLegacyRecordId(attemptId)) return { kind: "rejected", reason: "invalid_attempt_id" };
      const attempt = current.snapshot.captures.find((item) => item.id === attemptId);
      return attempt ? { kind: "resolved", attempt, generation: current.snapshot.generation }
        : { kind: "not_found", generation: current.snapshot.generation };
    },
    close() { if (!closed) { closed = true; activeRepositories.delete(writerKey); } },
  }) };
}
