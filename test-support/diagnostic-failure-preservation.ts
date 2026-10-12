import { closeSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const FAILURE_MARKER = "RECALL_DIAGNOSTIC_SUBMISSION_FAILURE";
export const PRESERVED_MARKER = "RECALL_DIAGNOSTIC_FIRST_FAILURE_PRESERVED";
export const PRESERVATION_ENV = "RECALL_TEST_DIAGNOSTIC_FAILURE_RUN_ROOT";
export const FAILURE_RUN_PREFIX = "recall-diagnostic-failure-run-";
export type FailurePreservation = { keep: boolean; reason: string; receipt?: string; ioCode?: string };

export function safeIOCode(error: unknown): string {
  const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "unavailable";
}

function privateTempDirectory(directory: string, prefix: string): boolean {
  const root = path.resolve(directory);
  return path.isAbsolute(directory) && root === directory && path.dirname(root) === path.resolve(os.tmpdir())
    && path.basename(root).startsWith(prefix) && !lstatSync(root).isSymbolicLink() && lstatSync(root).isDirectory()
    && path.dirname(realpathSync(root)) === realpathSync(os.tmpdir());
}

/** 仅测试 flag 启用；runner 为一次矩阵创建专用 mkdtemp root，各独立进程共用它。
 * wx 原子领取首份现场，不使用共享 JS global，也不覆盖已有 receipt。PASS 不写文件。
 */
export function preserveFirstDiagnosticFailure(runRoot: string | undefined, fixtureRoot: string,
  evidence: object): FailurePreservation {
  if (!runRoot) return { keep: false, reason: "disabled" };
  let fd: number;
  let receipt: string;
  try {
    if (!privateTempDirectory(runRoot, FAILURE_RUN_PREFIX)
      || !privateTempDirectory(fixtureRoot, "recall-durable-submission-test-"))
      return { keep: false, reason: "unsafe_preservation_root" };
    receipt = path.join(runRoot, "first-submission-failure.json");
    fd = openSync(receipt, "wx", 0o600);
  } catch (error) {
    const ioCode = safeIOCode(error);
    return { keep: false, reason: ioCode === "EEXIST" ? "first_failure_already_claimed" : "preservation_claim_failed", ioCode };
  }
  // 领取后即使 receipt 写入失败也保留 fixture，避免诊断 IO 异常毁掉首份原现场。
  const preservation: FailurePreservation = { keep: true, reason: "first_failure_claimed", receipt };
  try {
    writeFileSync(fd, JSON.stringify({ marker: PRESERVED_MARKER, tempRoot: fixtureRoot, evidence }, null, 2), { encoding: "utf8", flush: true });
  } catch (error) {
    preservation.reason = "receipt_write_failed_fixture_retained";
    preservation.ioCode = safeIOCode(error);
  } finally {
    try { closeSync(fd); }
    catch (error) { preservation.reason = "receipt_close_failed_fixture_retained"; preservation.ioCode = safeIOCode(error); }
  }
  return preservation;
}
