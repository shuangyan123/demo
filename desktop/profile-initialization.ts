import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ManagedStorageResolution } from "../app/platform/managed-storage.js";
import { storageBootstrapPath, storageIdentityPath, type StorageHostPaths } from "./storage-bootstrap.ts";
import { configFromStorageRecord, parseStorageRecord, type StorageBootstrapRecord, type StorageIdentity } from "./storage-bootstrap-record.ts";
import { readStorageFile, writeStorageRecord, type StorageRecordIO } from "./storage-bootstrap-io.ts";
import { hasUnanchoredStorage, initialProfileBinding, initialProfileRejection, isInitialRuntimeEntry, isPristineProfile, type InitialProfileBinding } from "./storage-inspection.ts";

export type FreshProfileCandidate = Readonly<{ kind: "fresh_profile_candidate" }>;
type CandidateState = { paths: StorageHostPaths; binding: InitialProfileBinding };
const candidates = new WeakMap<FreshProfileCandidate, CandidateState>();
const failure = (reason: string): ManagedStorageResolution => ({ kind: "unavailable", code: "storage_unavailable", reason });

// Fixed diagnostic labels only. Never log path identities, binding values, runtime JSON,
// file names from profile enumeration, exception strings or cryptographic material.
type RevalidationCategory =
  | "host_paths_changed" | "local_state_disappeared" | "local_state_binding_changed"
  | "directory_binding_changed" | "binding_inspection_unavailable"
  | "recall_namespace_present" | "profile_not_pristine";
function reportInitialProfileRevalidation(category: RevalidationCategory): void {
  console.error(`RECALL_INITIAL_PROFILE_REVALIDATION:${category}`);
}
function runtimeBindingChange(saved: InitialProfileBinding, current: InitialProfileBinding): RevalidationCategory | undefined {
  if (saved.localState !== undefined && saved.localState !== current.localState) {
    if (current.localState === undefined) return "local_state_disappeared";
    return "local_state_binding_changed";
  }
}
function categorizeBindingChange(saved: InitialProfileBinding, current: InitialProfileBinding): RevalidationCategory | undefined {
  if (JSON.stringify(saved.directories) !== JSON.stringify(current.directories)) return "directory_binding_changed";
  return runtimeBindingChange(saved, current);
}

/** 只读候选检查；absence 是可创建现场，不是从未使用过的证明。 */
export function inspectInitialProfile(paths: StorageHostPaths): { kind: "eligible"; candidate: FreshProfileCandidate } | ManagedStorageResolution {
  try {
    const binding = initialProfileBinding(paths);
    if (hasUnanchoredStorage(paths)) return failure("initialization_remnants");
    const rejected = initialProfileRejection(paths.defaultUserData);
    if (rejected) {
      console.error(`RECALL_INITIAL_PROFILE_INSPECTION:${rejected}`);
      return failure("profile_not_pristine");
    }
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
    let observedBinding: InitialProfileBinding;
    try { observedBinding = initialProfileBinding(current); }
    catch {
      reportInitialProfileRevalidation("binding_inspection_unavailable");
      return failure("initialization_unconfirmed"); // Same fail-closed exception outcome as before.
    }
    const changed = categorizeBindingChange(saved.binding, observedBinding);
    if (changed) {
      reportInitialProfileRevalidation(changed);
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
    let binding = initialProfileBinding(current);
    // 仅允许本次 exclusive mkdir 增加目录；已观察的祖先/profile 身份不得因预留过程被替换。
    if (!observedBinding.directories.every(value => binding.directories.includes(value))
      || runtimeBindingChange(observedBinding, binding)) throw new Error("storage_path_changed");
    const identity: StorageIdentity = Object.freeze({ formatVersion: 1, profileId: randomUUID(), epochId: randomUUID() });
    const record: StorageBootstrapRecord = Object.freeze({ ...identity, activeManagedRoot: current.defaultUserData, profileLayout: "legacy-root" });
    writeStorageRecord(storageIdentityPath(current.defaultUserData), identity, "create", io);
    verifyMetadata(storageIdentityPath(current.defaultUserData), identity);
    verifyCreatedNamespaces(current, false);
    const afterIdentity = initialProfileBinding(current);
    if (categorizeBindingChange(binding, afterIdentity)) throw new Error("storage_path_changed");
    binding = afterIdentity; // 一旦看到 Local State，后续 checkpoint 保留其 key/date 绑定。
    writeStorageRecord(storageBootstrapPath(current), record, "create", io);
    verifyMetadata(storageBootstrapPath(current), record);
    verifyMetadata(storageIdentityPath(current.defaultUserData), identity);
    verifyCreatedNamespaces(current, true);
    if (categorizeBindingChange(binding, initialProfileBinding(current))) throw new Error("storage_path_changed");
    return { kind: "ready", config: configFromStorageRecord(record) };
  } catch { return failure("initialization_unconfirmed"); }
}

/** 原生选择属于 Main；取消不调用任何创建函数。异步等待后 create 必须重新捕获 Host paths。 */
export async function completeInitialProfileDecision(candidate: FreshProfileCandidate, confirm: () => Promise<boolean>,
  create: (candidate: FreshProfileCandidate) => ManagedStorageResolution): Promise<ManagedStorageResolution | { kind: "cancelled" }> {
  if (!await confirm()) { candidates.delete(candidate); return { kind: "cancelled" }; }
  return create(candidate);
}
