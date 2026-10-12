import { lstatSync } from "node:fs";
import path from "node:path";
import type { commitDiagnosticSubmission } from "../app/server/diagnostic/assessment-submission.ts";
import type { DiagnosticRuntime } from "../app/server/diagnostic/runtime-core.ts";
import { FIRST_PARTY_DIAGNOSTIC_SOURCE_OWNER } from "../app/server/diagnostic/source-owner.ts";
import { diagnosticHistoryIO, diagnosticDurabilityFailure } from "../app/server/diagnostic/history/io.ts";
import { parseDiagnosticSnapshot } from "../app/server/diagnostic/history/record.ts";
import { parseDiagnosticStorageConfig } from "../app/server/diagnostic/storage-config.ts";
import { admitVerifiedAssessment } from "../app/services/verification-source/verification-source-admission.ts";
import type { diagnosticStorageFixture } from "./diagnostic-storage.ts";
import { FAILURE_MARKER, PRESERVED_MARKER, PRESERVATION_ENV, preserveFirstDiagnosticFailure, safeIOCode } from "./diagnostic-failure-preservation.ts";

export type NonSubmittedResult = Exclude<Awaited<ReturnType<typeof commitDiagnosticSubmission>>, { kind: "submitted" }>;
type Storage = ReturnType<typeof diagnosticStorageFixture>;
type ProbeFailure = { kind: "probe_failed"; ioCode: string };
function probe<T>(read: () => T): T | ProbeFailure {
  try { return read(); } catch (error) { return { kind: "probe_failed", ioCode: safeIOCode(error) }; }
}

export function submissionFailureStage(result: NonSubmittedResult) {
  if (result.kind === "captured_not_durable") {
    const detail = diagnosticDurabilityFailure(result.failure);
    if (detail) return { category: detail.stage, exact: detail.stage !== "unknown" && detail.stage !== "temporary_write_or_flush" };
    if ("reason" in result.failure && result.failure.reason === "commit_unconfirmed")
      return { category: "durable_append_or_confirmation", exact: false,
        limitation: "commit_unconfirmed does not expose publication versus confirmation or underlying IO exception" };
    return { category: "durable_append", exact: true };
  }
  if (result.kind === "durable_not_admitted") return { category: "admission", exact: true };
  if (result.kind === "durable_without_evidence") return { category: "event_derivation_or_evidence_derivation_or_reveal", exact: false,
    limitation: "production result combines these three stages; diagnostics do not replay them" };
  if (result.kind === "runtime_unavailable") return { category: "pre_capture_runtime_readiness", exact: true };
  return { category: "session_validation_or_capture", exact: false,
    limitation: "capture return does not expose the runtime/session validation boundary" };
}

function fileState(file: string) {
  try {
    const stat = lstatSync(file);
    return { exists: true, isRegularFile: stat.isFile(), isSymlink: stat.isSymbolicLink(), size: stat.size };
  } catch (error) {
    return { exists: safeIOCode(error) === "ENOENT" ? false : null, ioCode: safeIOCode(error) };
  }
}

function storageSummary(storage: Storage, attemptId: string | undefined) {
  const directory = path.dirname(storage.file);
  const reservation = diagnosticHistoryIO.directoryState(directory);
  const file = fileState(storage.file);
  const record = file.exists === true && "isRegularFile" in file && file.isRegularFile && !file.isSymlink
    ? diagnosticHistoryIO.read(storage.file) : undefined;
  // 使用既有严格 parser，损坏/不完整记录不能贡献 generation/count/durable 判断；不输出正文。
  const history = record?.kind === "record" ? parseDiagnosticSnapshot(record.text, storage.config) : record;
  return { repositoryOpenState: "not_exposed", reservation: { kind: "domain_directory", state: reservation },
    file: { path: storage.file, ...file },
    history: history?.kind === "complete"
      ? { kind: "complete", generation: history.snapshot.generation, captureCount: history.snapshot.captures.length,
        attemptDurable: attemptId ? history.snapshot.captures.some(attempt => attempt.id === attemptId) : null }
      : { ...(history ?? { kind: reservation === "missing" ? "domain_directory_missing" : "snapshot_unreadable" }),
        generation: null, captureCount: null, attemptDurable: null } };
}

export function diagnosticTestEnvironment(storage: Storage, env: Readonly<Record<string, string | undefined>> = process.env) {
  const payload = env.RECALL_MANAGED_STORAGE_BOOTSTRAP;
  const parsed = parseDiagnosticStorageConfig(payload);
  const matches = parsed.kind === "configured" && parsed.config.profileId === storage.config.profileId
    && parsed.config.epochId === storage.config.epochId && parsed.config.managedRoot === storage.config.managedRoot
    && parsed.config.profileRoot === storage.config.profileRoot && parsed.config.managedFilesRoot === storage.config.managedFilesRoot;
  const round = env.RECALL_TEST_DIAGNOSTIC_REPRO_ROUND;
  // 不 dump env/payload；只输出 allowlist 摘要，非本 fixture 的路径或无效值不进入报告。
  return { RECALL_MANAGED_STORAGE_BOOTSTRAP: { present: payload !== undefined, kind: parsed.kind,
    matchesFixture: matches, value: matches ? { profileId: parsed.config.profileId, epochId: parsed.config.epochId } : null },
    [PRESERVATION_ENV]: { present: env[PRESERVATION_ENV] !== undefined },
    RECALL_TEST_DIAGNOSTIC_REPRO_ROUND: { present: round !== undefined, value: round && /^\d{1,12}$/.test(round) ? round : null } };
}

export type SubmissionFailureInput = {
  result: NonSubmittedResult; runtime: DiagnosticRuntime; storage: Storage; sessionId: string;
  clock: { baselineNow: () => number; mockedNow: () => number; expectedFakeTime: number };
  test: { name: string; precedingTest: string | null; submissionIndex: number; submissionCount: number };
};

/** 只在原 submission 已返回失败之后收集：不 startup/open repository、不刷新 owner index，
 * 不 read(session)（会做 TTL pruning）、不 capture/append/reveal/retry，不改变原失败结果。
 */
export function collectSubmissionFailure(input: SubmissionFailureInput) {
  const { result, runtime, storage, clock } = input;
  const attempt = "attempt" in result ? result.attempt : undefined;
  const attemptId = attempt?.id;
  const owner = attemptId ? probe(() => {
    const resolved = FIRST_PARTY_DIAGNOSTIC_SOURCE_OWNER.resolveAttempt(attemptId);
    return { kind: resolved ? "resolved" : "not_found", observedAt: "post_failure" };
  }) : { kind: "not_queried_no_attempt_id" };
  const admission = attempt ? probe(() => {
    const admitted = admitVerifiedAssessment({ sourceOwnerId: attempt.sourceOwnerId, specId: attempt.specId,
      specRevision: attempt.specRevision, attemptId: attempt.id });
    return admitted.kind === "admitted" ? { kind: "admitted", observedAt: "post_failure" }
      : { ...admitted, observedAt: "post_failure" };
  }) : { kind: "not_queried_no_attempt_id" };
  const singleton = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("recall.durable-diagnostic.runtime.v1"))?.value;
  return { formatVersion: 1, marker: FAILURE_MARKER, result,
    resultCategory: { kind: result.kind, code: "code" in result ? result.code : null,
      reason: "reason" in result ? result.reason : null, failure: "failure" in result ? result.failure : null },
    durabilityFailure: result.kind === "captured_not_durable" ? diagnosticDurabilityFailure(result.failure) : null,
    stage: submissionFailureStage(result), timestamp: new Date().toISOString(), test: input.test,
    process: { pid: process.pid, ppid: process.ppid, nodeVersion: process.version },
    runtime: { singletonPresent: singleton !== undefined, singletonMatchesFixtureRuntime: singleton === runtime,
      readiness: probe(() => runtime.readiness()), closedState: "not_separately_exposed" },
    storage: { tempRoot: storage.root, profileId: storage.config.profileId, epochId: storage.config.epochId,
      observation: probe(() => storageSummary(storage, attemptId)) },
    session: { id: input.sessionId, state: "not_queried_to_avoid_TTL_pruning" },
    attempt: { id: attemptId ?? null, captureConfirmedByResult: attempt ? true : null,
      appendCalledByResult: attempt ? true : null,
      appendConfirmedByResult: result.kind === "durable_not_admitted" || result.kind === "durable_without_evidence" ? true : null,
      ownerPublicationAtOriginalOperation: "not_separately_exposed",
      admissionPassedByResult: result.kind === "durable_without_evidence" ? true : result.kind === "durable_not_admitted" ? false : null },
    owner, admission,
    clock: { observedAt: "failure_before_teardown", now: probe(() => Date.now()), expectedFakeTime: clock.expectedFakeTime,
      mockedNowIsCurrent: Date.now === clock.mockedNow, baselineNowIsCurrent: Date.now === clock.baselineNow,
      restoredToBaseline: Date.now === clock.baselineNow },
    env: diagnosticTestEnvironment(storage) };
}

export function formatSubmissionFixtureFailure(report: {
  result: NonSubmittedResult; runtime: object; storage: object; clock: object; [key: string]: unknown;
}) {
  return `${FAILURE_MARKER}\n${JSON.stringify(report, null, 2)}`;
}

export class SubmissionFixtureFailure extends Error {
  diagnostics: ReturnType<typeof collectSubmissionFailure>;
  preservation: ReturnType<typeof preserveFirstDiagnosticFailure>;
  constructor(input: SubmissionFailureInput, preservationRunRoot = process.env[PRESERVATION_ENV]) {
    const diagnostics = collectSubmissionFailure(input);
    super(formatSubmissionFixtureFailure(diagnostics));
    this.name = "SubmissionFixtureFailure";
    this.diagnostics = diagnostics;
    this.preservation = preserveFirstDiagnosticFailure(preservationRunRoot, input.storage.root,
      { ...diagnostics, stack: new Error("SubmissionFixtureFailure evidence capture").stack });
    if (this.preservation.keep) this.message += `\n${PRESERVED_MARKER} ${JSON.stringify({ tempRoot: input.storage.root, ...this.preservation })}`;
    else this.message += `\npreservation: ${JSON.stringify(this.preservation)}`;
  }
}
