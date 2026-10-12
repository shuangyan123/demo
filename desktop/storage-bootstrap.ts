import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { ManagedStorageResolution } from "../app/platform/managed-storage.js";
import { configFromStorageRecord, isCanonicalStoragePath, parseStorageRecord, sameStorageIdentity, type StorageBootstrapRecord, type StorageIdentity } from "./storage-bootstrap-record.ts";
import { readStorageFile, writeStorageRecord, type StorageRecordIO } from "./storage-bootstrap-io.ts";
import { hasUnanchoredStorage, isPristineProfile, storagePathBinding } from "./storage-inspection.ts";

/** 仅 Electron Host 提供；不得来自 renderer、环境变量或工作目录猜测。 */
export type StorageHostPaths = Readonly<{ appData: string; defaultUserData: string; defaultSessionData: string }>;
export function storageBootstrapPath(paths: StorageHostPaths): string {
  return path.join(paths.appData, "recall-storage", "bootstrap.json");
}
export function storageIdentityPath(profileRoot: string): string {
  return path.join(profileRoot, ".recall-storage", "identity.json");
}
const unavailable = (reason: string): ManagedStorageResolution => ({ kind: "unavailable", code: "storage_unavailable", reason });
function directoryState(root: string): "available" | "missing" | "unavailable" {
  try { return statSync(root).isDirectory() ? "available" : "unavailable"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable"; }
}
function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function validHostPaths(paths: StorageHostPaths): boolean {
  return Object.values(paths).every(isCanonicalStoragePath) && !contains(paths.defaultUserData, storageBootstrapPath(paths));
}

/** bootstrap 缺失不代表新用户。先检查原 profile 与独立 identity anchor，失败不创建空历史。 */
export function resolveManagedStorage(paths: StorageHostPaths, io?: StorageRecordIO): ManagedStorageResolution {
  if (!validHostPaths(paths)) return unavailable("invalid_host_paths");
  const bootstrapFile = storageBootstrapPath(paths);
  const read = readStorageFile(bootstrapFile);
  if (read.kind !== "missing" && read.kind !== "read") return read;
  if (read.kind === "read") {
    const parsed = parseStorageRecord(read.text, true);
    if (parsed.kind !== "valid") return parsed;
    const config = configFromStorageRecord(parsed.record);
    if (contains(config.managedRoot, bootstrapFile)) return { kind: "corrupt", reason: "bootstrap_inside_managed_root" };
    if (directoryState(config.managedRoot) !== "available" || directoryState(config.profileRoot) !== "available")
      return unavailable("configured_root_unavailable");
    const anchor = readStorageFile(storageIdentityPath(config.profileRoot));
    if (anchor.kind === "missing") return { kind: "corrupt", reason: "identity_missing" };
    if (anchor.kind !== "read") return anchor;
    const identity = parseStorageRecord(anchor.text, false);
    if (identity.kind !== "valid") return identity;
    if (!sameStorageIdentity(parsed.record, identity.record)) return { kind: "corrupt", reason: "identity_mismatch" };
    return { kind: "ready", config };
  }
  return resolveLegacyStorage(paths, io);
}

function resolveLegacyStorage(paths: StorageHostPaths, io?: StorageRecordIO): ManagedStorageResolution {
  if (paths.defaultSessionData !== paths.defaultUserData) return unavailable("legacy_profile_unavailable");
  const state = directoryState(paths.defaultUserData);
  if (state === "missing") {
    try {
      if (hasUnanchoredStorage(paths)) return unavailable("initialization_remnants");
      return directoryState(path.dirname(paths.defaultUserData)) === "available" ? { kind: "uninitialized" } : unavailable("legacy_parent_unavailable");
    } catch { return unavailable("legacy_profile_unavailable"); }
  }
  if (state !== "available" || paths.defaultSessionData !== paths.defaultUserData) return unavailable("legacy_profile_unavailable");
  const anchorFile = storageIdentityPath(paths.defaultUserData);
  const anchor = readStorageFile(anchorFile);
  if (anchor.kind !== "missing" && anchor.kind !== "read") return anchor;
  let identity: StorageIdentity;
  if (anchor.kind === "read") {
    const parsed = parseStorageRecord(anchor.text, false);
    if (parsed.kind !== "valid") return parsed;
    identity = parsed.record;
  } else {
    try {
      if (hasUnanchoredStorage(paths)) return unavailable("initialization_remnants");
      const entries = readdirSync(paths.defaultUserData);
      if (entries.length === 0 || isPristineProfile(paths.defaultUserData)) return { kind: "uninitialized" };
      // 只认既有持久 partition；非空但无法识别的目录保留原状，不能猜成新安装。
      const partitions = ["review-workspace", "review-fenbi"];
      if (!partitions.some((name) => directoryState(path.join(paths.defaultUserData, "Partitions", name)) === "available"))
        return unavailable("unrecognized_legacy_profile");
      storagePathBinding(paths);
      identity = Object.freeze({ formatVersion: 1, profileId: randomUUID(), epochId: randomUUID() });
      mkdirSync(path.dirname(anchorFile), { recursive: true });
      writeStorageRecord(anchorFile, identity, "create", io);
    } catch { return unavailable("identity_adoption_failed"); }
  }
  const record: StorageBootstrapRecord = { ...identity, activeManagedRoot: paths.defaultUserData, profileLayout: "legacy-root" };
  try {
    mkdirSync(path.dirname(storageBootstrapPath(paths)), { recursive: true });
    writeStorageRecord(storageBootstrapPath(paths), record, "create", io);
    return { kind: "legacy_existing_profile", config: configFromStorageRecord(record) };
  } catch { return unavailable("bootstrap_adoption_failed"); }
}

/** F1 只有 seam。configured redirect 不得绕过未交付的 profile relocation 并落回默认 profile。 */
export function gateManagedStorageStartup(resolution: ManagedStorageResolution, paths: StorageHostPaths): ManagedStorageResolution {
  if (resolution.kind !== "ready" && resolution.kind !== "legacy_existing_profile") return resolution;
  if (resolution.config.profileRoot !== paths.defaultUserData || paths.defaultSessionData !== paths.defaultUserData)
    return unavailable("profile_relocation_deferred");
  return resolution;
}
