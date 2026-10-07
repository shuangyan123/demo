import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { DiagnosticHistoryFailure } from "../../../types/domains/diagnostic-history.ts";
import { DIAGNOSTIC_HISTORY_MAX_BYTES } from "./record.ts";

export const historyUnavailable = (reason: string): DiagnosticHistoryFailure => ({ kind: "unavailable", code: "storage_unavailable", reason });
export const diagnosticHistoryIO = {
  directoryState(directory: string): "available" | "missing" | "unavailable" {
    try { return lstatSync(directory).isDirectory() ? "available" : "unavailable"; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable"; }
  },
  read(file: string): { kind: "record"; text: string } | { kind: "missing" } | DiagnosticHistoryFailure {
    let fd: number | undefined;
    try {
      if (!lstatSync(file).isFile()) return { kind: "corrupt", reason: "invalid_snapshot_file" };
      fd = openSync(file, "r");
      if (fstatSync(fd).size > DIAGNOSTIC_HISTORY_MAX_BYTES) return { kind: "corrupt", reason: "snapshot_capacity_exceeded" };
      return { kind: "record", text: readFileSync(fd, "utf8") };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : historyUnavailable("snapshot_read_failed");
    } finally { if (fd !== undefined) closeSync(fd); }
  },
  createDirectory: (directory: string) => { mkdirSync(directory, { mode: 0o700 }); },
  writeTemporary: (file: string, text: string) => writeFileSync(file, text, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true }),
  publishNew: (from: string, to: string) => linkSync(from, to),
  publishReplacement: (from: string, to: string) => renameSync(from, to),
  removeTemporary: (file: string) => unlinkSync(file),
};
export type DiagnosticHistoryIO = typeof diagnosticHistoryIO;

/** 小型 server snapshot primitive；不依赖 Desktop，不原地覆盖、不删除旧 record 来降级发布。 */
export function publishDiagnosticSnapshot(file: string, text: string, mode: "create" | "replace", io: DiagnosticHistoryIO): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    io.writeTemporary(temporary, text);
    if (mode === "create") io.publishNew(temporary, file);
    else io.publishReplacement(temporary, file);
  } finally {
    try { io.removeTemporary(temporary); } catch { /* orphan temp 不参与读取，不自动修复或清理历史。 */ }
  }
}
