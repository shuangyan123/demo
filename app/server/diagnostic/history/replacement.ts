import type { DiagnosticHistoryFailure, DiagnosticHistorySnapshotV1 } from "../../../types/domains/diagnostic-history.ts";
import type { DiagnosticIOFailure } from "./io-types.ts";
import { encodeDiagnosticSnapshot, parseDiagnosticSnapshot } from "./record.ts";

type ReplacementIO = {
  replacementPlatform: NodeJS.Platform;
  publishReplacement(from: string, to: string): void;
  waitForReplacementRetry(milliseconds: number): void;
  read(file: string): { kind: "record"; text: string } | { kind: "missing" } | DiagnosticHistoryFailure;
};

export const DIAGNOSTIC_REPLACEMENT_DELAYS_MS = Object.freeze([50, 150, 300]);
export const DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET = DIAGNOSTIC_REPLACEMENT_DELAYS_MS.length + 1;
type DiskState = "expected_old" | "expected_new" | "unexpected";
type TerminalReason = "succeeded" | "already_published" | "retry_exhausted" | "state_changed" | "temp_invalid" | "non_retryable" | "wait_failed";
type Failure = { attempt: number; io: DiagnosticIOFailure; diskState: DiskState | null; beforeRetryState: DiskState | null };
export type DiagnosticReplacementObservation = Readonly<{
  attemptCount: number; attemptBudget: number; waitBudgetMs: number;
  failures: readonly Readonly<Failure>[]; terminalReason: TerminalReason;
}>;

/** 仅 replacement 使用的 Node 同步等待；最多 50+150+300ms，不改变 repository 的同步 API。 */
export function waitForDiagnosticReplacementRetry(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
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
  observe: (detail: DiagnosticReplacementObservation) => void): void {
  const oldText = encodeDiagnosticSnapshot(base);
  const newText = encodeDiagnosticSnapshot(expected);
  const failures: Failure[] = [];
  let attemptCount = 0;
  let terminalReason: TerminalReason = "non_retryable";
  try {
    for (let attempt = 1; attempt <= DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET; attempt += 1) {
      attemptCount = attempt;
      try { io.publishReplacement(from, to); terminalReason = "succeeded"; return; }
      catch (error) {
        const failure: Failure = { attempt, io: classify(error), diskState: null, beforeRetryState: null };
        failures.push(failure);
        // EPERM 是 access/privilege 拒绝，EBUSY 是 sharing/lock；不把 code 当作具体 actor 证据。
        // EACCES 也可能表示 ERROR_CANT_ACCESS_FILE；三个 code 都只是候选，不能跳过 exact state gate。
        if (io.replacementPlatform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(failure.io.ioCode ?? "")) throw error;
        let disk = inspectReplacement(from, to, base, oldText, newText, io);
        failure.diskState = disk.state;
        if (disk.state === "expected_new") { terminalReason = "already_published"; return; }
        if (disk.state !== "expected_old") { terminalReason = disk.reason!; throw error; }
        if (attempt === DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET) { terminalReason = "retry_exhausted"; throw error; }
        try { io.waitForReplacementRetry(DIAGNOSTIC_REPLACEMENT_DELAYS_MS[attempt - 1]); }
        catch { terminalReason = "wait_failed"; throw error; }
        // 等待窗口也可能改变磁盘事实；紧贴下一次 rename 再验一次，不能使用等待前的旧结论。
        disk = inspectReplacement(from, to, base, oldText, newText, io);
        failure.beforeRetryState = disk.state;
        if (disk.state === "expected_new") { terminalReason = "already_published"; return; }
        if (disk.state !== "expected_old") { terminalReason = disk.reason!; throw error; }
      }
    }
  } finally {
    observe(Object.freeze({ attemptCount, attemptBudget: DIAGNOSTIC_REPLACEMENT_ATTEMPT_BUDGET,
      waitBudgetMs: DIAGNOSTIC_REPLACEMENT_DELAYS_MS.reduce((sum, delay) => sum + delay, 0),
      failures: Object.freeze(failures.map(failure => Object.freeze(failure))), terminalReason }));
  }
}
