import path from "node:path";
import type { ManagedStorageHostConfig } from "../../../platform/managed-storage.js";
import type { IssuedDiagnosticCapturedAttemptV1 } from "../../../types/domains/first-party-diagnostic-capture.ts";
import type { DiagnosticHistoryOpen, DiagnosticHistoryRead, DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import { isIssuedDiagnosticCapture } from "../../../services/first-party-diagnostic/capture-authority-core.ts";
import { isLegacyRecordId } from "../../../services/learning-kernel/learning-event.ts";
import { diagnosticHistoryIO, historyUnavailable, publishDiagnosticSnapshot, rememberDiagnosticDurabilityFailure,
  rememberDiagnosticReplacement, diagnosticReplacementObservation,
  type DiagnosticHistoryIO, type DiagnosticIOFailure, type DiagnosticPublicationObservation, type DiagnosticDurabilityFailure } from "./io.ts";
import { DIAGNOSTIC_HISTORY_MAX_BYTES, DIAGNOSTIC_HISTORY_MAX_CAPTURES, encodeDiagnosticSnapshot, parseDiagnosticSnapshot, validateDiagnosticCapture } from "./record.ts";

const activeRepositories = new Set<string>();
type ConfirmationObservation = { io: DiagnosticIOFailure | null; parsed: boolean };
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

  function read(observation?: ConfirmationObservation): DiagnosticHistoryRead {
    const observe = observation ? (failure: DiagnosticIOFailure) => { observation.io = failure; } : undefined;
    if (closed) return { kind: "closed" };
    if (committing) return historyUnavailable("operation_in_progress");
    if (io.directoryState(config.managedRoot, observe) !== "available" || io.directoryState(config.profileRoot, observe) !== "available")
      return historyUnavailable("active_profile_unavailable");
    const state = io.directoryState(directory, observe);
    if (state === "missing") return initialized ? { kind: "incomplete", reason: "initialized_repository_missing" } : { kind: "uninitialized" };
    if (state !== "available") return historyUnavailable("repository_directory_unavailable");
    initialized = true; // 域目录是显式初始化 reservation；已有目录绝不能因 record 缺失重建为空。
    const record = io.read(file, observe);
    if (record.kind === "missing") return { kind: "incomplete", reason: "history_record_missing" };
    if (record.kind !== "record") return record;
    if (observation) observation.parsed = true;
    return parseDiagnosticSnapshot(record.text, config);
  }

  function commit(snapshot: DiagnosticHistorySnapshotV1, mode: "create" | "replace", base?: DiagnosticHistorySnapshotV1): DiagnosticHistoryRead {
    const text = encodeDiagnosticSnapshot(snapshot);
    if (Buffer.byteLength(text, "utf8") > DIAGNOSTIC_HISTORY_MAX_BYTES) return { kind: "rejected", reason: "capacity_exceeded" };
    const publication: DiagnosticPublicationObservation = { publication: "not_attempted", failure: null, cleanupFailure: null };
    const confirmation: ConfirmationObservation = { io: null, parsed: false };
    function unconfirmed(result?: DiagnosticHistoryRead): DiagnosticHistoryRead {
      const classified = confirmationClassification(result, snapshot, confirmation.parsed);
      return rememberDiagnosticReplacement(rememberDiagnosticDurabilityFailure(historyUnavailable("commit_unconfirmed"), {
        externalReason: "commit_unconfirmed", mode, publication: publication.publication,
        stage: publication.failure?.stage ?? classified.stage,
        operation: publication.failure?.io.operation ?? confirmation.io?.operation ?? classified.operation,
        io: publication.failure?.io ?? confirmation.io, confirmationFailure: publication.failure ? null : classified.failure,
        validationReason: classified.validationReason, publicationFailure: publication.failure, cleanupFailure: publication.cleanupFailure,
        ...(publication.replacement ? { replacement: publication.replacement } : {}),
      }), publication.replacement);
    }
    committing = true;
    try { publishDiagnosticSnapshot(file, text, mode, io, publication, base ? { base, expected: snapshot } : undefined); }
    catch { return unconfirmed(); }
    finally { committing = false; }
    const result = read(confirmation);
    if (result.kind !== "complete" || JSON.stringify(result.snapshot) !== JSON.stringify(snapshot)) return unconfirmed(result);
    return rememberDiagnosticReplacement(result, publication.replacement);
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
        captures: Object.freeze([...current.snapshot.captures, validated.attempt]) }), "replace", current.snapshot);
      return result.kind === "complete" ? rememberDiagnosticReplacement({ kind: "committed", snapshot: result.snapshot },
        diagnosticReplacementObservation(result) ?? undefined) : result;
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

/** 仅对已经失败的确认结果细分原因；不能替代既有严格 read/整份 snapshot 比对。 */
function confirmationClassification(result: DiagnosticHistoryRead | undefined, expected: DiagnosticHistorySnapshotV1, parsed: boolean): {
  stage: DiagnosticDurabilityFailure["stage"]; operation: DiagnosticDurabilityFailure["operation"];
  failure: DiagnosticDurabilityFailure["confirmationFailure"]; validationReason: string | null;
} {
  if (!result) return { stage: "unknown", operation: "unknown", failure: "unknown", validationReason: null };
  if (result.kind === "complete") {
    const actual = result.snapshot;
    const failure = actual.profileId !== expected.profileId || actual.epochId !== expected.epochId ? "identity_mismatch"
      : actual.generation !== expected.generation ? "generation_mismatch"
        : expected.captures.some(attempt => !actual.captures.some(item => item.id === attempt.id)) ? "expected_capture_missing" : "content_mismatch";
    return { stage: "confirmation_compare", operation: "compare_snapshot", failure, validationReason: null };
  }
  if (result.kind === "corrupt" || result.kind === "unsupported_version") {
    const reason = result.kind === "corrupt" ? result.reason : "unsupported_version";
    const reasons = new Set(["malformed_snapshot", "invalid_snapshot", "invalid_format_version", "unsupported_version",
      "duplicate_fields", "invalid_snapshot_fields", "profile_mismatch", "epoch_mismatch", "invalid_snapshot_generation",
      "invalid_capture_facts", "invalid_capture_provenance", "unresolved_canonical_spec", "capture_spec_binding_mismatch",
      "duplicate_attempt_identity", "integrity_mismatch", "invalid_snapshot_file", "snapshot_capacity_exceeded"]);
    const failure = reason === "profile_mismatch" || reason === "epoch_mismatch" ? "identity_mismatch"
      : reason === "invalid_snapshot_generation" ? "generation_mismatch"
        : reason === "malformed_snapshot" || reason === "integrity_mismatch" || reason === "invalid_snapshot_file"
          || reason === "snapshot_capacity_exceeded" ? reason : "other_validation_failure";
    const operation = parsed ? "parseDiagnosticSnapshot" : reason === "invalid_snapshot_file" ? "lstatSync"
      : reason === "snapshot_capacity_exceeded" ? "fstatSync" : "unknown";
    return { stage: parsed ? "confirmation_validation" : "confirmation_read", operation,
      failure, validationReason: reasons.has(reason) ? reason : null };
  }
  const reason = "reason" in result ? result.reason : null;
  const failure = reason === "history_record_missing" || reason === "initialized_repository_missing" ? "file_missing"
    : reason === "snapshot_read_failed" ? "reopen_or_read_failed" : reason === "active_profile_unavailable" ? "profile_unavailable"
      : reason === "repository_directory_unavailable" ? "repository_directory_unavailable" : result.kind === "closed" ? "repository_closed"
        : reason === "operation_in_progress" ? "operation_in_progress" : "unknown";
  return { stage: "confirmation_read", operation: "unknown", failure, validationReason: null };
}
