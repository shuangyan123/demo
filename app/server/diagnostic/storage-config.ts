import path from "node:path";
import type { ManagedStorageHostConfig } from "../../platform/managed-storage.js";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIELDS = ["formatVersion", "profileId", "epochId", "managedRoot", "profileRoot", "managedFilesRoot"];
export type DiagnosticStorageConfig = { kind: "configured"; config: ManagedStorageHostConfig }
  | { kind: "storage_config_unavailable" };

/** 受信 OS child-process transport 的唯一反序列化边界；不接受 HTTP/preload/caller config。
 * brand 不跨进程：先严格验证 canonical payload，再在此重建 server 内部能力。
 */
export function parseDiagnosticStorageConfig(payload: string | undefined): DiagnosticStorageConfig {
  const unavailable = { kind: "storage_config_unavailable" } as const;
  if (!payload || Buffer.byteLength(payload, "utf8") > 8192) return unavailable;
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== FIELDS.length || !FIELDS.every((field) => Object.hasOwn(record, field))
      || record.formatVersion !== 1 || typeof record.profileId !== "string" || !ID.test(record.profileId)
      || typeof record.epochId !== "string" || !ID.test(record.epochId)) return unavailable;
    for (const field of ["managedRoot", "profileRoot", "managedFilesRoot"]) {
      const location = record[field];
      if (typeof location !== "string" || !location || location.includes("\0")
        || !path.isAbsolute(location) || path.resolve(location) !== location) return unavailable;
    }
    // canonical encoding 也拒绝 duplicate/escaped duplicate keys、额外字段与隐式覆盖。
    const config = { profileId: record.profileId, epochId: record.epochId, managedRoot: record.managedRoot as string,
      profileRoot: record.profileRoot as string, managedFilesRoot: record.managedFilesRoot as string };
    if (JSON.stringify({ formatVersion: 1, ...config }) !== payload
      || config.managedFilesRoot !== path.join(config.managedRoot, "managed-files")
      || ![config.managedRoot, path.join(config.managedRoot, "profile")].includes(config.profileRoot)) return unavailable;
    return { kind: "configured", config: Object.freeze(config) as ManagedStorageHostConfig };
  } catch { return unavailable; }
}
