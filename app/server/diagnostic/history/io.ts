import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { DiagnosticHistoryFailure } from "../../../types/domains/diagnostic-history.ts";
import { DIAGNOSTIC_HISTORY_MAX_BYTES } from "./record.ts";

export type DiagnosticIOOperation = "lstatSync" | "openSync" | "fstatSync" | "readFileSync" | "closeSync"
  | "writeFileSync" | "linkSync" | "renameSync" | "unlinkSync";
export type DiagnosticIOFailure = Readonly<{
  operation: DiagnosticIOOperation;
  ioCode: string | null;
  syscall: string | null;
  errno: number | null;
}>;
export type DiagnosticPublicationObservation = {
  publication: "not_attempted" | "reported_failure" | "reported_success";
  failure: Readonly<{
    stage: "temporary_open" | "temporary_write" | "temporary_fsync" | "temporary_close" | "temporary_write_or_flush"
      | "publication_link" | "replacement_rename";
    io: DiagnosticIOFailure;
    sourceFile: string;
    destinationFile: "history.json";
    sourceExists: boolean | null;
    destinationExists: boolean | null;
    existenceObservedAt: "post_failure";
  }> | null;
  cleanupFailure: DiagnosticIOFailure | null;
};
export type DiagnosticDurabilityFailure = Readonly<{
  externalReason: "commit_unconfirmed";
  mode: "create" | "replace";
  publication: DiagnosticPublicationObservation["publication"];
  stage: NonNullable<DiagnosticPublicationObservation["failure"]>["stage"]
    | "confirmation_read" | "confirmation_validation" | "confirmation_compare" | "unknown";
  operation: DiagnosticIOOperation | "parseDiagnosticSnapshot" | "compare_snapshot" | "unknown";
  io: DiagnosticIOFailure | null;
  confirmationFailure: "file_missing" | "reopen_or_read_failed" | "invalid_snapshot_file" | "snapshot_capacity_exceeded"
    | "malformed_snapshot" | "integrity_mismatch" | "identity_mismatch" | "generation_mismatch"
    | "expected_capture_missing" | "content_mismatch" | "other_validation_failure" | "profile_unavailable"
    | "repository_directory_unavailable" | "repository_closed" | "operation_in_progress" | "unknown" | null;
  validationReason: string | null;
  publicationFailure: DiagnosticPublicationObservation["failure"];
  cleanupFailure: DiagnosticIOFailure | null;
}>;

const ioCodes = new Set(["EACCES", "EAGAIN", "EBADF", "EBUSY", "EDQUOT", "EEXIST", "EFBIG", "EINTR", "EINVAL",
  "EIO", "EISDIR", "ELOOP", "EMFILE", "ENAMETOOLONG", "ENFILE", "ENODEV", "ENOENT", "ENOMEM", "ENOSPC",
  "ENOSYS", "ENOTDIR", "ENOTEMPTY", "ENOTSUP", "ENXIO", "EPERM", "EROFS", "ETXTBSY", "EXDEV",
  "ERR_FS_FILE_TOO_LARGE", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_OUT_OF_RANGE"]);
const syscalls = new Set(["lstat", "stat", "open", "fstat", "read", "write", "fsync", "close", "link", "rename", "unlink"]);
function dataProperty(error: unknown, name: string): unknown {
  try {
    if (!error || typeof error !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, name);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

/** 只保留有限 IO 分类；不读取 getter/message/path/dest/cause，也不存原始异常。 */
export function diagnosticIOFailure(error: unknown, operation: DiagnosticIOOperation): DiagnosticIOFailure {
  const code = dataProperty(error, "code");
  const syscall = dataProperty(error, "syscall");
  const errno = dataProperty(error, "errno");
  return Object.freeze({ operation, ioCode: typeof code === "string" && ioCodes.has(code) ? code : null,
    syscall: typeof syscall === "string" && syscalls.has(syscall) ? syscall : null,
    errno: typeof errno === "number" && Number.isSafeInteger(errno) && Math.abs(errno) <= 65536 ? errno : null });
}

type IOFailureObserver = (failure: DiagnosticIOFailure) => void;
function observeFailure(observer: IOFailureObserver | undefined, error: unknown, operation: DiagnosticIOOperation) {
  try { observer?.(diagnosticIOFailure(error, operation)); } catch { /* 诊断不能替换原始 IO 结果。 */ }
}

// 按结果对象关联，只读内部查询；不增加可枚举字段、序列化 payload 或 repository 权限。
const durabilityFailures = new WeakMap<object, DiagnosticDurabilityFailure>();
export function rememberDiagnosticDurabilityFailure<T extends object>(result: T, detail: DiagnosticDurabilityFailure): T {
  durabilityFailures.set(result, Object.freeze(detail));
  return result;
}
export function diagnosticDurabilityFailure(result: object): DiagnosticDurabilityFailure | null {
  return durabilityFailures.get(result) ?? null;
}

export const historyUnavailable = (reason: string): DiagnosticHistoryFailure => ({ kind: "unavailable", code: "storage_unavailable", reason });
export const diagnosticHistoryIO = {
  directoryState(directory: string, observe?: IOFailureObserver): "available" | "missing" | "unavailable" {
    try { return lstatSync(directory).isDirectory() ? "available" : "unavailable"; }
    catch (error) {
      observeFailure(observe, error, "lstatSync");
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
    }
  },
  read(file: string, observe?: IOFailureObserver): { kind: "record"; text: string } | { kind: "missing" } | DiagnosticHistoryFailure {
    let fd: number | undefined;
    let operation: DiagnosticIOOperation = "lstatSync";
    try {
      if (!lstatSync(file).isFile()) return { kind: "corrupt", reason: "invalid_snapshot_file" };
      operation = "openSync";
      fd = openSync(file, "r");
      operation = "fstatSync";
      if (fstatSync(fd).size > DIAGNOSTIC_HISTORY_MAX_BYTES) return { kind: "corrupt", reason: "snapshot_capacity_exceeded" };
      operation = "readFileSync";
      return { kind: "record", text: readFileSync(fd, "utf8") };
    } catch (error) {
      observeFailure(observe, error, operation);
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : historyUnavailable("snapshot_read_failed");
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); }
        catch (error) { observeFailure(observe, error, "closeSync"); throw error; }
      }
    }
  },
  createDirectory: (directory: string) => { mkdirSync(directory, { mode: 0o700 }); },
  writeTemporary: (file: string, text: string) => writeFileSync(file, text, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true }),
  publishNew: (from: string, to: string) => linkSync(from, to),
  publishReplacement: (from: string, to: string) => renameSync(from, to),
  removeTemporary: (file: string) => unlinkSync(file),
};
export type DiagnosticHistoryIO = typeof diagnosticHistoryIO;

/** 小型 server snapshot primitive；不依赖 Desktop，不原地覆盖、不删除旧 record 来降级发布。 */
export function publishDiagnosticSnapshot(file: string, text: string, mode: "create" | "replace", io: DiagnosticHistoryIO,
  observation?: DiagnosticPublicationObservation): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let operation: DiagnosticIOOperation = "writeFileSync";
  try {
    io.writeTemporary(temporary, text);
    operation = mode === "create" ? "linkSync" : "renameSync";
    if (mode === "create") io.publishNew(temporary, file);
    else io.publishReplacement(temporary, file);
    if (observation) observation.publication = "reported_success";
  } catch (error) {
    if (observation) {
      const failure = diagnosticIOFailure(error, operation);
      const stages = { open: "temporary_open", write: "temporary_write", fsync: "temporary_fsync", close: "temporary_close" } as const;
      const stage = operation === "linkSync" ? "publication_link" : operation === "renameSync" ? "replacement_rename"
        : stages[failure.syscall as keyof typeof stages] ?? "temporary_write_or_flush";
      observation.publication = operation === "writeFileSync" ? "not_attempted" : "reported_failure";
      observation.failure = Object.freeze({ stage, io: failure,
        sourceFile: `history.json.${temporary.slice(file.length + 1)}`, destinationFile: "history.json",
        sourceExists: pathExistsAfterFailure(temporary), destinationExists: pathExistsAfterFailure(file), existenceObservedAt: "post_failure" });
    }
    throw error;
  } finally {
    try { io.removeTemporary(temporary); }
    catch (error) {
      if (observation) observation.cleanupFailure = diagnosticIOFailure(error, "unlinkSync");
      // orphan temp 不参与读取；cleanup 仍是非致命，不自动修复或清理历史。
    }
  }
}

function pathExistsAfterFailure(file: string): boolean | null {
  try { lstatSync(file); return true; }
  catch (error) { return dataProperty(error, "code") === "ENOENT" ? false : null; }
}
