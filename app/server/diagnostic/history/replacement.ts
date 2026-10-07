import type { DiagnosticHistoryFailure, DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import type { DiagnosticIOFailure } from "./io-types.ts";
import { encodeDiagnosticSnapshot, parseDiagnosticSnapshot } from "./record.ts";

type ReplacementIO = {
  replacementPlatform: NodeJS.Platform;
  publishReplacement(from: string, to: string): void;
  waitForReplacementRetry(milliseconds: number): Promise<void>;
  replacementNow(): number;
  read(file: string): { kind: "record"; text: string } | { kind: "missing" } | DiagnosticHistoryFailure;
};

export const DIAGNOSTIC_REPLACEMENT_OFFSETS_MS = Object.freeze([0, 50, 150, 300, 500, 750, 1000, 1500, 2000]);
export const DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET = 9; // 包含首次 native attempt，最多 8 次 retry。
export const DIAGNOSTIC_REPLACEMENT_DEADLINE_MS = 2000;
export const DIAGNOSTIC_REPLACEMENT_SCHEDULING_GRACE_MS = 100;
type DiskState = "expected_old" | "expected_new" | "unexpected";
type TerminalReason = "succeeded" | "already_published" | "deadline_exhausted" | "attempt_cap_exhausted" | "state_changed" | "temp_invalid" | "non_retryable" | "wait_failed";
type Failure = { attempt: number; io: DiagnosticIOFailure; diskState: DiskState | null; beforeRetryState: DiskState | null };
export type DiagnosticReplacementObservation = Readonly<{
  attemptCount: number; attemptBudget: number; waitBudgetMs: number; schedulingGraceMs: number;
  firstFailureTimeMs: number | null;
  attempts: readonly Readonly<{ attempt: number; targetOffsetMs: number; actualOffsetMs: number; succeeded: boolean }>[];
  failures: readonly Readonly<Failure>[]; terminalReason: TerminalReason;
}>;

/** 只在候选失败后等待；即使 offset 已经过期，0ms timer 也让出 event loop。 */
export function waitForDiagnosticReplacementRetry(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** 只有严格完整 snapshot 的 canonical encoding 相等才可放行；size/mtime/文件名不能授权覆盖。 */
function inspectReplacement(from: string, to: string, base: DiagnosticHistorySnapshotV1, oldText: string, newText: string,
  io: ReplacementIO): { state: DiskState; reason?: "state_changed" | "temp_invalid" } {
  function canonical(file: string): string | null {
    try {
      const read = io.read(file);
      if (read.kind !== "record") return null;
      const parsed = parseDiagnosticSnapshot(read.text, base);
      return parsed.kind === "complete" ? encodeDiagnosticSnapshot(parsed.snapshot) : null;
    } catch { return null; }
  }
  const target = canonical(to);
  if (target === newText) return { state: "expected_new" };
  if (target !== oldText) return { state: "unexpected", reason: "state_changed" };
  if (canonical(from) !== newText) return { state: "unexpected", reason: "temp_invalid" };
  return { state: "expected_old" };
}

/** 单 writer 的窄恢复路径：只重发同一个完整 temp，不 recapture、不覆盖不匹配的 base。 */
export function publishDiagnosticReplacement(from: string, to: string, base: DiagnosticHistorySnapshotV1,
  expected: DiagnosticHistorySnapshotV1, io: ReplacementIO, classify: (error: unknown) => DiagnosticIOFailure,
  observe: (detail: DiagnosticReplacementObservation) => void): void | Promise<void> {
  const oldText = encodeDiagnosticSnapshot(base);
  const newText = encodeDiagnosticSnapshot(expected);
  const failures: Failure[] = [];
  const attempts: { attempt: number; targetOffsetMs: number; actualOffsetMs: number; succeeded: boolean }[] = [];
  let attemptCount = 0;
  let firstFailureTimeMs: number | null = null;
  let terminalReason: TerminalReason = "non_retryable";
  const elapsed = () => firstFailureTimeMs === null ? 0 : io.replacementNow() - firstFailureTimeMs;
  function finish() {
    observe(Object.freeze({ attemptCount, attemptBudget: DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET,
      waitBudgetMs: DIAGNOSTIC_REPLACEMENT_DEADLINE_MS, schedulingGraceMs: DIAGNOSTIC_REPLACEMENT_SCHEDULING_GRACE_MS,
      firstFailureTimeMs, attempts: Object.freeze(attempts.map(attempt => Object.freeze(attempt))),
      failures: Object.freeze(failures.map(failure => Object.freeze(failure))), terminalReason }));
  }
  function native(): { error: unknown; failure: Failure } | undefined {
    attemptCount++;
    const attempt = { attempt: attemptCount, targetOffsetMs: DIAGNOSTIC_REPLACEMENT_OFFSETS_MS[attemptCount - 1],
      actualOffsetMs: elapsed(), succeeded: false };
    attempts.push(attempt);
    try { io.publishReplacement(from, to); attempt.succeeded = true; terminalReason = "succeeded"; }
    catch (error) {
      const failure: Failure = { attempt: attemptCount, io: classify(error), diskState: null, beforeRetryState: null };
      failures.push(failure);
      // pinned libuv code 只是候选分类，不证明 transient 或具体 actor。
      if (io.replacementPlatform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(failure.io.ioCode ?? "")) {
        terminalReason = "non_retryable"; throw error;
      }
      firstFailureTimeMs ??= io.replacementNow();
      return { error, failure };
    }
  }
  function gate(failed: { error: unknown; failure: Failure }, beforeRetry: boolean): boolean {
    const disk = inspectReplacement(from, to, base, oldText, newText, io);
    if (beforeRetry) failed.failure.beforeRetryState = disk.state;
    else failed.failure.diskState = disk.state;
    if (disk.state === "expected_new") { terminalReason = "already_published"; return false; }
    if (disk.state !== "expected_old") { terminalReason = disk.reason!; throw failed.error; }
    return true;
  }
  async function recover(failed: { error: unknown; failure: Failure }) {
    try {
      while (gate(failed, false)) {
        // deadline 优先；只给 deadline 前已安排的 probe 一次有限调度宽限，不再延长 schedule。
        if (elapsed() >= DIAGNOSTIC_REPLACEMENT_DEADLINE_MS) { terminalReason = "deadline_exhausted"; throw failed.error; }
        if (attemptCount >= DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET) { terminalReason = "attempt_cap_exhausted"; throw failed.error; }
        const offset = DIAGNOSTIC_REPLACEMENT_OFFSETS_MS[attemptCount];
        try { await io.waitForReplacementRetry(Math.max(0, offset - elapsed())); }
        catch { terminalReason = "wait_failed"; throw failed.error; }
        // await 后必须重新严格读验，紧贴 native；exact NEW 仍走独立确认，不重发 rename。
        if (!gate(failed, true)) return;
        if (elapsed() > DIAGNOSTIC_REPLACEMENT_DEADLINE_MS + DIAGNOSTIC_REPLACEMENT_SCHEDULING_GRACE_MS) {
          terminalReason = "deadline_exhausted"; throw failed.error;
        }
        const next = native();
        if (!next) return;
        failed = next;
      }
    } finally { finish(); }
  }
  // 正常路径仍在本次同步栈完成 native publication，不创建 timer 或 delayed continuation。
  let failed;
  try { failed = native(); }
  catch (error) { finish(); throw error; }
  if (failed) return recover(failed);
  finish();
}
