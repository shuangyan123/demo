import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gateManagedStorageStartup, resolveManagedStorage, storageBootstrapPath, storageIdentityPath, type StorageHostPaths } from "./storage-bootstrap.ts";
import { parseStorageRecord, sameStorageIdentity, type StorageBootstrapRecord, type StorageIdentity } from "./storage-bootstrap-record.ts";
import { storageRecordIO, writeStorageRecord } from "./storage-bootstrap-io.ts";

const identity: StorageIdentity = { formatVersion: 1, profileId: "3422b8ea-6a32-4cdd-9e18-513156d01c72", epochId: "31e6d8b9-af01-4a35-b06c-67e8c01ac64d" };
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "recall-storage-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appData = path.join(root, "os-config");
  mkdirSync(appData);
  const profile = path.join(appData, "legacy-profile");
  const paths: StorageHostPaths = { appData, defaultUserData: profile, defaultSessionData: profile };
  return { root, paths };
}
function legacy(paths: StorageHostPaths) {
  const existing = path.join(paths.defaultUserData, "Partitions", "review-workspace", "IndexedDB", "existing-history.sentinel");
  mkdirSync(path.dirname(existing), { recursive: true });
  writeFileSync(existing, "preserve-existing-learning-data");
  return existing;
}
function configure(paths: StorageHostPaths, root: string, layout: StorageBootstrapRecord["profileLayout"] = "legacy-root", ids = identity) {
  const profile = layout === "legacy-root" ? root : path.join(root, "profile");
  mkdirSync(path.dirname(storageIdentityPath(profile)), { recursive: true });
  writeStorageRecord(storageIdentityPath(profile), ids, "create");
  mkdirSync(path.dirname(storageBootstrapPath(paths)), { recursive: true });
  const record: StorageBootstrapRecord = { ...ids, activeManagedRoot: root, profileLayout: layout };
  writeStorageRecord(storageBootstrapPath(paths), record, "create");
  return record;
}

test("fresh absent/empty default profile is typed uninitialized without creating storage", (t) => {
  const { paths } = fixture(t);
  assert.deepEqual(resolveManagedStorage(paths), { kind: "uninitialized" });
  assert.deepEqual(readdirSync(paths.appData), []);
  mkdirSync(paths.defaultUserData);
  assert.deepEqual(resolveManagedStorage(paths), { kind: "uninitialized" });
  assert.deepEqual(readdirSync(paths.defaultUserData), []);
});

test("valid bootstrap resolves exact identity and Host roots, immutable configuration", (t) => {
  const { root, paths } = fixture(t);
  const managedRoot = path.join(root, "managed");
  configure(paths, managedRoot, "managed-root");
  const result = resolveManagedStorage(paths);
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready") throw new Error("expected ready");
  assert.deepEqual(result.config, { profileId: identity.profileId, epochId: identity.epochId, managedRoot,
    profileRoot: path.join(managedRoot, "profile"), managedFilesRoot: path.join(managedRoot, "managed-files") });
  assert.ok(Object.isFrozen(result.config));
});

test("strict bootstrap parsing rejects malformed, extra fields, invalid versions, paths and path identity", (t) => {
  const { paths } = fixture(t);
  const valid = { ...identity, activeManagedRoot: paths.defaultUserData, profileLayout: "legacy-root" };
  for (const text of ["{", "null", "[]", JSON.stringify({ ...valid, apiKey: "forbidden" }),
    JSON.stringify({ ...valid, profileId: paths.defaultUserData }), JSON.stringify({ ...valid, epochId: "process-123" }),
    JSON.stringify({ ...valid, activeManagedRoot: "relative" }), JSON.stringify({ ...valid, formatVersion: 0 }),
    JSON.stringify({ ...valid, formatVersion: "1" }), JSON.stringify(valid).replace('{', '{"formatVersion":1,'), " ".repeat(8193)]) {
    assert.equal(parseStorageRecord(text, true).kind, "corrupt");
  }
  assert.deepEqual(parseStorageRecord(JSON.stringify({ formatVersion: 2 }), true), { kind: "unsupported_version", version: 2 });
});

test("corrupt/unsupported bootstrap never adopts existing default profile or overwrites bootstrap", (t) => {
  const { paths } = fixture(t);
  legacy(paths);
  mkdirSync(path.dirname(storageBootstrapPath(paths)), { recursive: true });
  for (const text of ["{", JSON.stringify({ formatVersion: 99 })]) {
    writeFileSync(storageBootstrapPath(paths), text);
    assert.equal(resolveManagedStorage(paths).kind, text === "{" ? "corrupt" : "unsupported_version");
    assert.equal(readFileSync(storageBootstrapPath(paths), "utf8"), text);
    assert.deepEqual(readdirSync(paths.defaultUserData), ["Partitions"]);
  }
});

test("configured removable/other root missing returns unavailable, no default fallback or directory creation", (t) => {
  const { root, paths } = fixture(t);
  legacy(paths);
  mkdirSync(path.dirname(storageBootstrapPath(paths)), { recursive: true });
  const missingRoot = path.join(root, "missing-drive", "Recall");
  const record = { ...identity, activeManagedRoot: missingRoot, profileLayout: "managed-root" } as const;
  writeStorageRecord(storageBootstrapPath(paths), record, "create");
  assert.deepEqual(resolveManagedStorage(paths), { kind: "unavailable", code: "storage_unavailable", reason: "configured_root_unavailable" });
  assert.equal(readFileSync(storageBootstrapPath(paths), "utf8"), JSON.stringify(record));
  assert.ok(!readdirSync(root).includes("missing-drive"));
  assert.deepEqual(readdirSync(paths.defaultUserData), ["Partitions"]);
});

test("path changes retain profileId and epochId; distinct epoch denotes replacement, never path identity", (t) => {
  const { root, paths } = fixture(t);
  const first = configure(paths, path.join(root, "C-root"), "managed-root");
  const before = resolveManagedStorage(paths);
  const nextRoot = path.join(root, "E-root");
  mkdirSync(path.dirname(storageIdentityPath(path.join(nextRoot, "profile"))), { recursive: true });
  writeStorageRecord(storageIdentityPath(path.join(nextRoot, "profile")), identity, "create");
  const next = { ...first, activeManagedRoot: nextRoot };
  writeStorageRecord(storageBootstrapPath(paths), next, "replace");
  const after = resolveManagedStorage(paths);
  if (before.kind !== "ready" || after.kind !== "ready") throw new Error("expected resolved roots");
  assert.equal(before.config.profileId, after.config.profileId);
  assert.equal(before.config.epochId, after.config.epochId);
  assert.notEqual(before.config.managedRoot, after.config.managedRoot);
  assert.ok(sameStorageIdentity(first, next));
  assert.equal(sameStorageIdentity(first, { ...next, epochId: "77107bfa-c7c0-4f60-8d42-59a087cb968c" }), false);
});

test("legacy adoption retains actual data, effective path and stable IDs over restart/bootstrap deletion", (t) => {
  const { paths } = fixture(t);
  const existing = legacy(paths);
  const first = resolveManagedStorage(paths);
  assert.equal(first.kind, "legacy_existing_profile");
  if (first.kind !== "legacy_existing_profile") throw new Error("expected legacy");
  assert.equal(first.config.profileRoot, paths.defaultUserData);
  assert.equal(first.config.managedRoot, paths.defaultUserData);
  assert.equal(readFileSync(existing, "utf8"), "preserve-existing-learning-data");
  const second = resolveManagedStorage(paths);
  if (second.kind !== "ready") throw new Error("expected ready");
  assert.deepEqual(second.config, first.config);
  rmSync(storageBootstrapPath(paths));
  const recovered = resolveManagedStorage(paths);
  if (recovered.kind !== "legacy_existing_profile") throw new Error("expected stable adoption");
  assert.deepEqual(recovered.config, first.config);
  assert.equal(readFileSync(existing, "utf8"), "preserve-existing-learning-data");
  assert.equal(gateManagedStorageStartup(recovered, paths).kind, "legacy_existing_profile");
});

test("identity persisted before interrupted bootstrap publication is reused on retry", (t) => {
  const { paths } = fixture(t);
  legacy(paths);
  const failingIO = { ...storageRecordIO, publishNew: (from: string, to: string) => {
    if (to === storageBootstrapPath(paths)) throw new Error("simulated interruption");
    storageRecordIO.publishNew(from, to);
  } };
  assert.equal(resolveManagedStorage(paths, failingIO).kind, "unavailable");
  const persisted = parseStorageRecord(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"), false);
  if (persisted.kind !== "valid") throw new Error("expected stable anchor");
  const retry = resolveManagedStorage(paths);
  if (retry.kind !== "legacy_existing_profile") throw new Error("expected recovery");
  assert.equal(retry.config.profileId, persisted.record.profileId);
  assert.equal(retry.config.epochId, persisted.record.epochId);
});

test("interrupted bootstrap replacement observes old-or-new valid record, ignores temporary partial files", (t) => {
  const { root, paths } = fixture(t);
  const oldRecord = configure(paths, path.join(root, "old"));
  const nextRecord = { ...oldRecord, activeManagedRoot: path.join(root, "next") };
  const target = storageBootstrapPath(paths);
  const failBefore = { ...storageRecordIO, publishReplacement: () => { throw new Error("interrupted before publish"); } };
  assert.throws(() => writeStorageRecord(target, nextRecord, "replace", failBefore));
  assert.deepEqual(parseStorageRecord(readFileSync(target, "utf8"), true), { kind: "valid", record: oldRecord });
  const failAfter = { ...storageRecordIO, publishReplacement: (from: string, to: string) => {
    storageRecordIO.publishReplacement(from, to); throw new Error("interrupted after publish");
  } };
  assert.throws(() => writeStorageRecord(target, nextRecord, "replace", failAfter));
  assert.deepEqual(parseStorageRecord(readFileSync(target, "utf8"), true), { kind: "valid", record: nextRecord });
  writeFileSync(`${target}.orphan.tmp`, "{");
  assert.equal(resolveManagedStorage(paths).kind, "unavailable"); // next root 尚不存在；绝不采用 orphan/default。
});

test("record create never overwrites identity/bootstrap, invalid write is rejected", (t) => {
  const { paths } = fixture(t);
  const record = configure(paths, paths.defaultUserData);
  assert.throws(() => writeStorageRecord(storageBootstrapPath(paths), { ...record, epochId: "bad" }, "replace"));
  assert.throws(() => writeStorageRecord(storageIdentityPath(paths.defaultUserData), identity, "create"));
  assert.equal(resolveManagedStorage(paths).kind, "ready");
});

test("identity missing/mismatched/corrupt fails closed instead of generating another identity", (t) => {
  const { paths } = fixture(t);
  configure(paths, paths.defaultUserData);
  for (const text of ["{", JSON.stringify({ ...identity, epochId: "77107bfa-c7c0-4f60-8d42-59a087cb968c" })]) {
    writeFileSync(storageIdentityPath(paths.defaultUserData), text);
    assert.equal(resolveManagedStorage(paths).kind, "corrupt");
    assert.equal(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"), text);
  }
  rmSync(storageIdentityPath(paths.defaultUserData));
  assert.deepEqual(resolveManagedStorage(paths), { kind: "corrupt", reason: "identity_missing" });
});

test("unknown nonempty legacy profile and absent host parent are unavailable, never uninitialized", (t) => {
  const { root, paths } = fixture(t);
  mkdirSync(paths.defaultUserData);
  writeFileSync(path.join(paths.defaultUserData, "unknown-file"), "preserve");
  assert.equal(resolveManagedStorage(paths).kind, "unavailable");
  const missing = path.join(root, "offline-host", "legacy");
  assert.equal(resolveManagedStorage({ ...paths, defaultUserData: missing, defaultSessionData: missing }).kind, "unavailable");
});

test("F1 startup rejects redirected profile or split sessionData; no automatic fallback", (t) => {
  const { root, paths } = fixture(t);
  configure(paths, path.join(root, "other-drive"), "managed-root");
  assert.deepEqual(gateManagedStorageStartup(resolveManagedStorage(paths), paths), {
    kind: "unavailable", code: "storage_unavailable", reason: "profile_relocation_deferred",
  });
  assert.equal(resolveManagedStorage(paths).kind, "ready"); // gate 不改 bootstrap。
  assert.equal(gateManagedStorageStartup({ kind: "uninitialized" }, paths).kind, "uninitialized");
  const current = fixture(t).paths;
  configure(current, current.defaultUserData);
  assert.deepEqual(gateManagedStorageStartup(resolveManagedStorage(current), { ...current, defaultSessionData: path.join(root, "split-session") }), {
    kind: "unavailable", code: "storage_unavailable", reason: "profile_relocation_deferred",
  });
});

test("bootstrap cannot live inside active managed root", (t) => {
  const { paths } = fixture(t);
  configure(paths, paths.appData);
  assert.deepEqual(resolveManagedStorage(paths), { kind: "corrupt", reason: "bootstrap_inside_managed_root" });
});

test("legacy Fenbi-only partition is recognized without creating a Workspace partition", (t) => {
  const { paths } = fixture(t);
  const partition = path.join(paths.defaultUserData, "Partitions", "review-fenbi");
  mkdirSync(partition, { recursive: true });
  writeFileSync(path.join(partition, "Cookies.sentinel"), "retain-protected-session");
  assert.equal(resolveManagedStorage(paths).kind, "legacy_existing_profile");
  assert.deepEqual(readdirSync(path.dirname(partition)), ["review-fenbi"]);
  assert.equal(readFileSync(path.join(partition, "Cookies.sentinel"), "utf8"), "retain-protected-session");
});

test("record file unavailable/malformed shape cannot be interpreted as bootstrap absence", (t) => {
  const { paths } = fixture(t);
  legacy(paths);
  mkdirSync(storageBootstrapPath(paths), { recursive: true });
  assert.deepEqual(resolveManagedStorage(paths), { kind: "corrupt", reason: "invalid_record_file" });
  assert.deepEqual(readdirSync(paths.defaultUserData), ["Partitions"]);
});
