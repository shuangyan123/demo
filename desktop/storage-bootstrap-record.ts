import path from "node:path";
import type { ManagedStorageHostConfig } from "../app/platform/managed-storage.js";

export type StorageIdentity = Readonly<{ formatVersion: 1; profileId: string; epochId: string }>;
export type StorageBootstrapRecord = StorageIdentity & Readonly<{
  activeManagedRoot: string;
  profileLayout: "legacy-root" | "managed-root";
}>;
export type StorageRecordFailure = { kind: "corrupt"; reason: string } | { kind: "unsupported_version"; version: number };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const STORAGE_RECORD_MAX_BYTES = 8 * 1024;

function duplicateRootKeys(text: string): boolean {
  const keys = new Set<string>();
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
    else if (text[i] === '"') {
      const start = i;
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === "\\") i += 1;
        else if (text[i] === '"') break;
      }
      let after = i + 1;
      while (/\s/.test(text[after] ?? "") && after < text.length) after += 1;
      if (depth === 1 && text[after] === ":") {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
  return false;
}

/** path 只负责定位；随机 UUID identity 不接受路径、路径 hash 或进程编号。 */
export function parseStorageRecord(text: string, bootstrap: true): { kind: "valid"; record: StorageBootstrapRecord } | StorageRecordFailure;
export function parseStorageRecord(text: string, bootstrap: false): { kind: "valid"; record: StorageIdentity } | StorageRecordFailure;
export function parseStorageRecord(text: string, bootstrap: boolean): { kind: "valid"; record: StorageIdentity | StorageBootstrapRecord } | StorageRecordFailure {
  if (Buffer.byteLength(text, "utf8") > STORAGE_RECORD_MAX_BYTES) return { kind: "corrupt", reason: "record_too_large" } as const;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { kind: "corrupt", reason: "malformed_json" } as const; }
  if (duplicateRootKeys(text)) return { kind: "corrupt", reason: "duplicate_fields" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "corrupt", reason: "invalid_record" } as const;
  const record = value as Record<string, unknown>;
  if (typeof record.formatVersion !== "number" || !Number.isSafeInteger(record.formatVersion) || record.formatVersion < 1)
    return { kind: "corrupt", reason: "invalid_version" } as const;
  if (record.formatVersion !== 1) return { kind: "unsupported_version", version: record.formatVersion } as const;
  const keys = bootstrap ? ["formatVersion", "profileId", "epochId", "activeManagedRoot", "profileLayout"] : ["formatVersion", "profileId", "epochId"];
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))
    || typeof record.profileId !== "string" || !ID.test(record.profileId)
    || typeof record.epochId !== "string" || !ID.test(record.epochId))
    return { kind: "corrupt", reason: "invalid_fields" } as const;
  if (bootstrap && (!isCanonicalStoragePath(record.activeManagedRoot)
    || (record.profileLayout !== "legacy-root" && record.profileLayout !== "managed-root")))
    return { kind: "corrupt", reason: "invalid_root" } as const;
  return { kind: "valid", record: Object.freeze(record) as StorageIdentity | StorageBootstrapRecord };
}

export function isCanonicalStoragePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim() === value
    && !value.includes("\0") && !value.startsWith("\\\\?\\") && !value.startsWith("\\\\.\\")
    && path.isAbsolute(value) && path.resolve(value) === value;
}

export function sameStorageIdentity(left: StorageIdentity, right: StorageIdentity): boolean {
  return left.profileId === right.profileId && left.epochId === right.epochId;
}

/** 唯一 trusted config 构造边界；managed-files 仅解析位置，本片不创建文件仓库。 */
export function configFromStorageRecord(record: StorageBootstrapRecord): ManagedStorageHostConfig {
  return Object.freeze({
    profileId: record.profileId, epochId: record.epochId, managedRoot: record.activeManagedRoot,
    profileRoot: record.profileLayout === "legacy-root" ? record.activeManagedRoot : path.join(record.activeManagedRoot, "profile"),
    managedFilesRoot: path.join(record.activeManagedRoot, "managed-files"),
  }) as ManagedStorageHostConfig;
}
