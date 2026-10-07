import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync, linkSync, renameSync, unlinkSync } from "node:fs";
import { STORAGE_RECORD_MAX_BYTES, parseStorageRecord, type StorageBootstrapRecord, type StorageIdentity } from "./storage-bootstrap-record.ts";

export type StorageFileRead = { kind: "missing" } | { kind: "unavailable"; code: "storage_unavailable"; reason: string }
  | { kind: "corrupt"; reason: string } | { kind: "read"; text: string };

export function readStorageFile(file: string): StorageFileRead {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.size > STORAGE_RECORD_MAX_BYTES) return { kind: "corrupt", reason: "invalid_record_file" };
    return { kind: "read", text: readFileSync(file, "utf8") };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" }
      : { kind: "unavailable", code: "storage_unavailable", reason: "record_read_failed" };
  }
}

export const storageRecordIO = {
  writeTemporary: (file: string, text: string) => writeFileSync(file, text, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true }),
  publishNew: (from: string, to: string) => linkSync(from, to),
  publishReplacement: (from: string, to: string) => renameSync(from, to),
  removeTemporary: (file: string) => unlinkSync(file),
};
export type StorageRecordIO = typeof storageRecordIO;

/** 同目录完整 temp + file fsync + publish。无原地覆盖；不承诺断电后的目录 fsync/硬件持久性。 */
export function writeStorageRecord(file: string, record: StorageBootstrapRecord | StorageIdentity,
  mode: "create" | "replace", io: StorageRecordIO = storageRecordIO): void {
  const text = JSON.stringify(record);
  const parsed = "activeManagedRoot" in record ? parseStorageRecord(text, true) : parseStorageRecord(text, false);
  if (parsed.kind !== "valid") throw new Error("invalid_storage_record");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    io.writeTemporary(temporary, text);
    // create 不覆盖既有 identity；replace 只供未来受控 bootstrap 更新，不执行数据迁移。
    if (mode === "create") io.publishNew(temporary, file);
    else io.publishReplacement(temporary, file);
  } finally {
    try { io.removeTemporary(temporary); } catch { /* 中断残留 temp 绝不作为有效 record 读取。 */ }
  }
}
