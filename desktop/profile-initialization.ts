import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ManagedStorageResolution } from "../app/platform/managed-storage.js";
import { storageBootstrapPath, storageIdentityPath, type StorageHostPaths } from "./storage-bootstrap.ts";
import { configFromStorageRecord, parseStorageRecord, type StorageBootstrapRecord, type StorageIdentity } from "./storage-bootstrap-record.ts";
import { readStorageFile, writeStorageRecord, type StorageRecordIO } from "./storage-bootstrap-io.ts";
import { hasUnanchoredStorage, initialProfileBinding, isInitialRuntimeEntry, isPristineProfile } from "./storage-inspection.ts";

export type FreshProfileCandidate = Readonly<{ kind: "fresh_profile_candidate" }>;
type CandidateState = { paths: StorageHostPaths; binding: readonly string[] };
const candidates = new WeakMap<FreshProfileCandidate, CandidateState>();
const failure = (reason: string): ManagedStorageResolution => ({ kind: "unavailable", code: "storage_unavailable", reason });

// Fixed diagnostic labels only. Never log path identities, binding values, runtime JSON,
// file names from profile enumeration, exception strings or cryptographic material.
type RevalidationCategory =
  | "host_paths_changed" | "local_state_appeared" | "local_state_disappeared"
  | "local_state_binding_changed" | "lockfile_binding_changed"
  | "directory_binding_changed" | "binding_inspection_unavailable"
  | "recall_namespace_present" | "profile_not_pristine";
function reportInitialProfileRevalidation(category: RevalidationCategory): void {
  console.error(`RECALL_INITIAL_PROFILE_REVALIDATION:${category}`);
}
function categorizeBindingChange(
  saved: readonly string[], current: readonly string[], paths: StorageHostPaths,
): RevalidationCategory {
  const localStatePrefix = `${path.join(paths.defaultUserData, "Local State")}:`;
  const lockfilePrefix = `${path.join(paths.defaultUserData, "lockfile")}:`;
  const bindingFor = (values: readonly string[], prefix: string) => values.find(value => value.startsWith(prefix));
  const beforeLocalState = bindingFor(saved, localStatePrefix);
  const afterLocalState = bindingFor(current, localStatePrefix);
  if (beforeLocalState !== afterLocalState) {
    if (!beforeLocalState) return "local_state_appeared";
    if (!afterLocalState) return "local_state_disappeared";
    return "local_state_binding_changed";
  }
  if (bindingFor(saved, lockfilePrefix) !== bindingFor(current, lockfilePrefix)) return "lockfile_binding_changed";
  return "directory_binding_changed";
}

/** 只读候选检查；absence 是可创建现场，不是从未使用过的证明。 */
export function inspectInitialProfile(paths: StorageHostPaths): { kind: "eligible"; candidate: FreshProfileCandidate } | ManagedStorageResolution {
  try {
    const binding = initialProfileBinding(paths);
    if (hasUnanchoredStorage(paths)) return failure("initialization_remnants");
    if (!isPristineProfile(paths.defaultUserData)) return failure("profile_not_pristine");
    const candidate: FreshProfileCandidate = Object.freeze({ kind: "fresh_profile_candidate" });
    candidates.set(candidate, { paths: Object.freeze({ ...paths }), binding });
    return { kind: "eligible", candidate };
  } catch { return failure("initialization_inspection_failed"); }
}

function verifyMetadata(file: string, expected: StorageIdentity | StorageBootstrapRecord): void {
  const read = readStorageFile(file);
  if (read.kind !== "read") throw new Error("metadata_unconfirmed");
  const parsed = "activeManagedRoot" in expected ? parseStorageRecord(read.text, true) : parseStorageRecord(read.text, false);
  if (parsed.kind !== "valid" || JSON.stringify(parsed.record) !== JSON.stringify(expected)) throw new Error("metadata_unconfirmed");
}

function verifyCreatedNamespaces(paths: StorageHostPaths, bootstrapPublished: boolean): void {
  if (readdirSync(paths.defaultUserData).some(entry => entry !== ".recall-storage" && !isInitialRuntimeEntry(paths.defaultUserData, entry))
    || JSON.stringify(readdirSync(path.dirname(storageIdentityPath(paths.defaultUserData)))) !== '["identity.json"]'
    || JSON.stringify(readdirSync(path.dirname(storageBootstrapPath(paths)))) !== (bootstrapPublished ? '["bootstrap.json"]' : '[]'))
    throw new Error("initialization_namespace_changed");
}

/** 生产仅由 Main 原生确认后的 Host facade 调用。候选只能使用一次；无 reset/replace/retry。 */
export function createInitialProfile(candidate: FreshProfileCandidate, current: StorageHostPaths, io?: StorageRecordIO): ManagedStorageResolution {
  const saved = candidates.get(candidate);
  candidates.delete(candidate);
  if (!saved) return failure("invalid_initialization_candidate");
  try {
    if (JSON.stringify(current) !== JSON.stringify(saved.paths)) {
      reportInitialProfileRevalidation("host_paths_changed");
      return failure("initialization_candidate_changed");
    }
    let observedBinding: readonly string[];
    try { observedBinding = initialProfileBinding(current); }
    catch {
      reportInitialProfileRevalidation("binding_inspection_unavailable");
      return failure("initialization_unconfirmed"); // Same fail-closed exception outcome as before.
    }
    if (JSON.stringify(observedBinding) !== JSON.stringify(saved.binding)) {
      reportInitialProfileRevalidation(categorizeBindingChange(saved.binding, observedBinding, current));
      return failure("initialization_candidate_changed");
    }
    if (hasUnanchoredStorage(current)) {
      reportInitialProfileRevalidation("recall_namespace_present");
      return failure("initialization_candidate_changed");
    }
    if (!isPristineProfile(current.defaultUserData)) {
      reportInitialProfileRevalidation("profile_not_pristine");
      return failure("initialization_candidate_changed");
    }
    // exclusive reservation 保留中断现场；目录存在、竞争或未知副作用均停止，不广泛清理。
    try { lstatSync(current.defaultUserData); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(current.defaultUserData);
    }
    mkdirSync(path.dirname(storageIdentityPath(current.defaultUserData)), { mode: 0o700 });
    mkdirSync(path.dirname(storageBootstrapPath(current)), { mode: 0o700 });
    const binding = initialProfileBinding(current);
    const identity: StorageIdentity = Object.freeze({ formatVersion: 1, profileId: randomUUID(), epochId: randomUUID() });
    const record: StorageBootstrapRecord = Object.freeze({ ...identity, activeManagedRoot: current.defaultUserData, profileLayout: "legacy-root" });
    writeStorageRecord(storageIdentityPath(current.defaultUserData), identity, "create", io);
    verifyMetadata(storageIdentityPath(current.defaultUserData), identity);
    verifyCreatedNamespaces(current, false);
    if (JSON.stringify(initialProfileBinding(current)) !== JSON.stringify(binding)) throw new Error("storage_path_changed");
    writeStorageRecord(storageBootstrapPath(current), record, "create", io);
    verifyMetadata(storageBootstrapPath(current), record);
    verifyMetadata(storageIdentityPath(current.defaultUserData), identity);
    verifyCreatedNamespaces(current, true);
    if (JSON.stringify(initialProfileBinding(current)) !== JSON.stringify(binding)) throw new Error("storage_path_changed");
    return { kind: "ready", config: configFromStorageRecord(record) };
  } catch { return failure("initialization_unconfirmed"); }
}

/** 原生选择属于 Main；取消不调用任何创建函数。异步等待后 create 必须重新捕获 Host paths。 */
export async function completeInitialProfileDecision(candidate: FreshProfileCandidate, confirm: () => Promise<boolean>,
  create: (candidate: FreshProfileCandidate) => ManagedStorageResolution): Promise<ManagedStorageResolution | { kind: "cancelled" }> {
  if (!await confirm()) { candidates.delete(candidate); return { kind: "cancelled" }; }
  return create(candidate);
}
