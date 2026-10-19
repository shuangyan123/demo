import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { completeInitialProfileDecision, createInitialProfile, inspectInitialProfile } from "./profile-initialization.ts";
import { gateManagedStorageStartup, resolveManagedStorage, storageBootstrapPath, storageIdentityPath, type StorageHostPaths } from "./storage-bootstrap.ts";
import { storageRecordIO } from "./storage-bootstrap-io.ts";
import { initialProfileRejection, isInitialRuntimeEntry, storagePathBinding } from "./storage-inspection.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(realpathSync.native(os.tmpdir()), "recall-fresh-profile-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), realpathSync.native(os.tmpdir())); assert.match(path.basename(root), /^recall-fresh-profile-test-/);
    rmSync(root, { recursive: true, force: true });
  });
  const appData = path.join(root, "appData"); mkdirSync(appData);
  const profile = path.join(appData, "profile");
  const paths: StorageHostPaths = { appData, defaultUserData: profile, defaultSessionData: profile };
  return { root, paths };
}
function candidate(paths: StorageHostPaths) {
  const inspected = inspectInitialProfile(paths); assert.equal(inspected.kind, "eligible");
  if (inspected.kind !== "eligible") throw new Error("candidate required"); return inspected.candidate;
}

function runtimeLocalState(installationDate = "1"): string {
  return JSON.stringify({ os_crypt: { audit_enabled: true,
    encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.alloc(64)]).toString("base64") },
  uninstall_metrics: { installation_date2: installationDate } });
}

test("native cancellation publishes no identity, bootstrap, domain or capture and consumes candidate", async t => {
  const { paths } = fixture(t); const inspected = candidate(paths); let creates = 0;
  assert.deepEqual(await completeInitialProfileDecision(inspected, async () => false, value => {
    creates++; return createInitialProfile(value, paths);
  }), { kind: "cancelled" });
  assert.equal(creates, 0); assert.deepEqual(readdirSync(paths.appData), []);
  assert.equal(createInitialProfile(inspected, paths).kind, "unavailable");
});

test("authorized absent and empty profiles publish independently confirmed metadata exactly once", async t => {
  for (const empty of [false, true]) {
    const { paths } = fixture(t); if (empty) mkdirSync(paths.defaultUserData);
    const inspected = candidate(paths); const first = await completeInitialProfileDecision(inspected, async () => true,
      value => createInitialProfile(value, paths));
    assert.equal(first.kind, "ready"); if (first.kind !== "ready") throw new Error("ready required");
    assert.deepEqual(readdirSync(paths.defaultUserData), [".recall-storage"]);
    assert.deepEqual(gateManagedStorageStartup(resolveManagedStorage(paths), paths), first);
    const bootstrap = readFileSync(storageBootstrapPath(paths), "utf8"); const anchor = readFileSync(storageIdentityPath(paths.defaultUserData), "utf8");
    assert.equal(createInitialProfile(inspected, paths).kind, "unavailable");
    assert.equal(readFileSync(storageBootstrapPath(paths), "utf8"), bootstrap); assert.equal(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"), anchor);
    const script = "import {resolveManagedStorage} from './desktop/storage-bootstrap.ts'; process.stdout.write(JSON.stringify(resolveManagedStorage(JSON.parse(process.argv[1]))));";
    const reopened = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, JSON.stringify(paths)],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true }));
    assert.deepEqual(reopened, first);
  }
});

test("Electron empty lockfile is a candidate without being historical-newness authority", t => {
  const { paths } = fixture(t); mkdirSync(paths.defaultUserData); writeFileSync(path.join(paths.defaultUserData, "lockfile"), "");
  assert.equal(resolveManagedStorage(paths).kind, process.platform === "win32" ? "uninitialized" : "unavailable");
  assert.equal(inspectInitialProfile(paths).kind, process.platform === "win32" ? "eligible" : "unavailable");
  writeFileSync(path.join(paths.defaultUserData, "lockfile"), "unknown"); assert.equal(inspectInitialProfile(paths).kind, "unavailable");
});

if (process.platform === "win32") test("recognized Electron Local State is preserved and requires explicit creation authority", async t => {
  for (const lock of [false, true]) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "Local State"); const original = runtimeLocalState(); writeFileSync(file, original);
    if (lock) writeFileSync(path.join(paths.defaultUserData, "lockfile"), "");
    assert.equal(resolveManagedStorage(paths).kind, "uninitialized");
    let creates = 0;
    assert.deepEqual(await completeInitialProfileDecision(candidate(paths), async () => false, value => {
      creates++; return createInitialProfile(value, paths);
    }), { kind: "cancelled" });
    assert.equal(creates, 0); assert.equal(readFileSync(file, "utf8"), original);
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
    assert.equal(createInitialProfile(candidate(paths), paths).kind, "ready");
    assert.equal(readFileSync(file, "utf8"), original);
    assert.equal(resolveManagedStorage(paths).kind, "ready");
  }
});

if (process.platform === "win32") test("Local State filename cannot admit unknown data, malformed metadata or Recall remnants", t => {
  const sample = runtimeLocalState(); const parsed = JSON.parse(sample);
  const invalid = ["{partial", "{}", JSON.stringify({ ...parsed, recall: { evidence: [] } }),
    JSON.stringify({ ...parsed, os_crypt: { ...parsed.os_crypt, unexpected: true } }),
    sample.replace('"audit_enabled":true', '"audit_enabled":"true"'),
    sample.replace('"installation_date2":"1"', '"installation_date2":1'),
    sample.replace(parsed.os_crypt.encrypted_key, "RFBBUEk="),
    sample.replace(parsed.os_crypt.encrypted_key, "not-base64"),
    sample.replace('"audit_enabled":true', '"audit_enabled":false,"audit_enabled":true'),
    JSON.stringify(parsed, null, 2), " ".repeat(4097), Buffer.from([0xff, 0xfe])];
  for (const contents of invalid) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "Local State"); writeFileSync(file, contents);
    assert.equal(resolveManagedStorage(paths).kind, "unavailable");
    assert.equal(inspectInitialProfile(paths).kind, "unavailable");
    assert.deepEqual(readFileSync(file), Buffer.from(contents));
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  }
  for (const extra of ["foreign", "managed-files", ".recall-storage", "bootstrap-directory", "local-state-directory"]) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData); const file = path.join(paths.defaultUserData, "Local State");
    if (extra === "local-state-directory") mkdirSync(file);
    else {
      writeFileSync(file, sample);
      mkdirSync(extra === "bootstrap-directory" ? path.dirname(storageBootstrapPath(paths)) : path.join(paths.defaultUserData, extra));
    }
    assert.equal(resolveManagedStorage(paths).kind, "unavailable");
    assert.equal(inspectInitialProfile(paths).kind, "unavailable");
  }
});

if (process.platform === "win32") test("Local State security material changes after inspection or during publication stop creation without overwrite", t => {
  for (const stage of ["confirmation", "publication"]) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "Local State"); writeFileSync(file, runtimeLocalState());
    const inspected = candidate(paths); const changed = runtimeLocalState("2");
    if (stage === "confirmation") writeFileSync(file, changed);
    const result = createInitialProfile(inspected, paths, { ...storageRecordIO, publishNew(from, to) {
      storageRecordIO.publishNew(from, to);
      if (to === storageIdentityPath(paths.defaultUserData)) writeFileSync(file, changed);
    } });
    assert.equal(result.kind, "unavailable"); assert.equal(readFileSync(file, "utf8"), changed);
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), stage === "publication");
    if (stage === "publication") assert.deepEqual(readdirSync(path.dirname(storageBootstrapPath(paths))), []);
  }
});

test("legacy adoption preserves Local State with other runtime preferences under existing partition rules", t => {
  const { paths } = fixture(t); mkdirSync(path.join(paths.defaultUserData, "Partitions", "review-workspace"), { recursive: true });
  const file = path.join(paths.defaultUserData, "Local State"); const original = '{"other_runtime_preference":true}'; writeFileSync(file, original);
  assert.equal(resolveManagedStorage(paths).kind, "legacy_existing_profile");
  assert.equal(readFileSync(file, "utf8"), original);
  assert.equal(resolveManagedStorage(paths).kind, "ready");
});

test("revalidation rejects new contents, changed Host paths, replaced directories and split sessions", t => {
  for (const mutation of ["contents", "paths", "directory", "session"] as const) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData); const inspected = candidate(paths);
    let current = paths;
    if (mutation === "contents") writeFileSync(path.join(paths.defaultUserData, "foreign"), "preserve");
    if (mutation === "paths") current = { ...paths, appData: path.join(paths.appData, "changed") };
    if (mutation === "directory") { renameSync(paths.defaultUserData, `${paths.defaultUserData}-old`); mkdirSync(paths.defaultUserData); }
    if (mutation === "session") current = { ...paths, defaultSessionData: path.join(paths.appData, "other") };
    assert.equal(createInitialProfile(inspected, current).kind, "unavailable", mutation);
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  }
});

test("directory binding preserves exact filesystem IDs across real replacements", t => {
  const { root, paths } = fixture(t);
  mkdirSync(paths.defaultUserData);
  for (let index = 0; index < 128; index++) {
    const exact = lstatSync(paths.defaultUserData, { bigint: true });
    assert.ok(storagePathBinding(paths).includes(`${paths.defaultUserData}:${exact.dev}:${exact.ino}`));
    const inspected = candidate(paths);
    renameSync(paths.defaultUserData, path.join(root, `preserved-${index}`)); mkdirSync(paths.defaultUserData);
    assert.notEqual(lstatSync(paths.defaultUserData, { bigint: true }).ino, exact.ino);
    assert.equal(createInitialProfile(inspected, paths).kind, "unavailable");
    assert.equal(existsSync(storageIdentityPath(paths.defaultUserData)), false);
  }
});

test("orphan history and metadata reservations block fresh creation AND legacy identity publication", t => {
  for (const remnant of ["managed-files", ".recall-storage", "bootstrap-directory"] as const) {
    const { paths } = fixture(t);
    mkdirSync(path.join(paths.defaultUserData, "Partitions", "review-workspace"), { recursive: true });
    const target = remnant === "bootstrap-directory" ? path.dirname(storageBootstrapPath(paths)) : path.join(paths.defaultUserData, remnant);
    mkdirSync(target); writeFileSync(path.join(target, "preserve"), "original");
    assert.equal(resolveManagedStorage(paths).kind, "unavailable"); assert.equal(inspectInitialProfile(paths).kind, "unavailable");
    assert.equal(readFileSync(path.join(target, "preserve"), "utf8"), "original");
    assert.equal(readdirSync(target).includes("identity.json"), false);
  }
});

test("initial creation never overwrites a competing initializer; loser cannot mint another identity", t => {
  const { paths } = fixture(t); const one = candidate(paths); const two = candidate(paths);
  const winner = createInitialProfile(one, paths); assert.equal(winner.kind, "ready");
  const original = readFileSync(storageBootstrapPath(paths), "utf8");
  assert.equal(createInitialProfile(two, paths).kind, "unavailable");
  assert.equal(readFileSync(storageBootstrapPath(paths), "utf8"), original);
  assert.equal(inspectInitialProfile(paths).kind, "unavailable");
});

test("caller-shaped candidates cannot create metadata", t => {
  const { paths } = fixture(t);
  assert.equal(createInitialProfile({ kind: "fresh_profile_candidate" }, paths).kind, "unavailable");
  assert.deepEqual(readdirSync(paths.appData), []);
});

test("unexpected namespace content after publication stops setup and preserves the remnant", t => {
  const { paths } = fixture(t); const remnant = path.join(paths.defaultUserData, "managed-files");
  const result = createInitialProfile(candidate(paths), paths, { ...storageRecordIO, publishNew(from, to) {
    storageRecordIO.publishNew(from, to);
    if (to === storageIdentityPath(paths.defaultUserData)) { mkdirSync(remnant); writeFileSync(path.join(remnant, "preserve"), "original"); }
  } });
  assert.equal(result.kind, "unavailable");
  assert.equal(readFileSync(path.join(remnant, "preserve"), "utf8"), "original");
  assert.deepEqual(readdirSync(path.dirname(storageBootstrapPath(paths))), []);
});

test("prepublication interruption preserves reservation and forbids empty retry", t => {
  const { paths } = fixture(t);
  const result = createInitialProfile(candidate(paths), paths, { ...storageRecordIO, writeTemporary() { throw Object.assign(new Error("denied"), { code: "EACCES" }); } });
  assert.equal(result.kind, "unavailable"); assert.deepEqual(readdirSync(path.dirname(storageIdentityPath(paths.defaultUserData))), []);
  assert.equal(resolveManagedStorage(paths).kind, "unavailable"); assert.equal(inspectInitialProfile(paths).kind, "unavailable");
});

test("anchor-confirmed/bootstrap-interrupted startup reuses original identity without reset", t => {
  const { paths } = fixture(t);
  const result = createInitialProfile(candidate(paths), paths, { ...storageRecordIO, publishNew(from, to) {
    if (to === storageBootstrapPath(paths)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    storageRecordIO.publishNew(from, to);
  } });
  assert.equal(result.kind, "unavailable"); const anchor = readFileSync(storageIdentityPath(paths.defaultUserData), "utf8");
  const recovered = resolveManagedStorage(paths); assert.equal(recovered.kind, "legacy_existing_profile");
  if (recovered.kind !== "legacy_existing_profile") throw new Error("recovery required");
  assert.equal(recovered.config.profileId, JSON.parse(anchor).profileId); assert.equal(recovered.config.epochId, JSON.parse(anchor).epochId);
  assert.equal(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"), anchor);
});

for (const stage of ["anchor", "bootstrap"] as const) test(`${stage} publication must be independently confirmed; corruption is preserved`, t => {
  const { paths } = fixture(t); const target = stage === "anchor" ? storageIdentityPath(paths.defaultUserData) : storageBootstrapPath(paths);
  const result = createInitialProfile(candidate(paths), paths, { ...storageRecordIO, publishNew(from, to) {
    storageRecordIO.publishNew(from, to); if (to === target) writeFileSync(to, "{partial");
  } });
  assert.equal(result.kind, "unavailable"); assert.equal(readFileSync(target, "utf8"), "{partial");
  assert.equal(resolveManagedStorage(paths).kind, "corrupt"); assert.equal(inspectInitialProfile(paths).kind, "unavailable");
});

test("junction/redirection and absent-root split session cannot authorize creation", t => {
  const { root, paths } = fixture(t); const other = path.join(root, "other"); mkdirSync(other);
  symlinkSync(other, paths.defaultUserData, process.platform === "win32" ? "junction" : "dir");
  assert.equal(inspectInitialProfile(paths).kind, "unavailable"); assert.deepEqual(readdirSync(other), []);
  const second = fixture(t).paths;
  assert.equal(resolveManagedStorage({ ...second, defaultSessionData: path.join(second.appData, "split") }).kind, "unavailable");
});

test("independent Windows/Node initialization contenders publish one identity pair", async t => {
  const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
  const script = `import {inspectInitialProfile,createInitialProfile} from './desktop/profile-initialization.ts';
    const paths=JSON.parse(process.argv[1]); const inspected=inspectInitialProfile(paths);
    if(inspected.kind!=='eligible') throw Error('candidate required'); process.stdout.write('eligible\\n');
    process.stdin.once('data',()=>{process.stdout.write(JSON.stringify(createInitialProfile(inspected.candidate,paths)));process.stdin.destroy();});`;
  const contenders = [0, 1].map(() => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, JSON.stringify(paths)],
      { cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let errors = "";
    const eligible = new Promise<void>((resolve, reject) => {
      child.stdout.on("data", value => { output += value; if (output.startsWith("eligible\n")) resolve(); });
      child.once("error", reject);
    });
    child.stderr.on("data", value => { errors += value; });
    const finished = new Promise<Record<string, unknown>>((resolve, reject) => child.once("exit", code => {
      if (code !== 0) reject(new Error(errors)); else resolve(JSON.parse(output.slice("eligible\n".length)));
    }));
    t.after(() => { if (child.exitCode === null) child.kill(); });
    return { child, eligible, finished };
  });
  await Promise.all(contenders.map(value => value.eligible)); contenders.forEach(value => value.child.stdin.write("authorize"));
  const results = await Promise.all(contenders.map(value => value.finished));
  assert.deepEqual(results.map(value => value.kind).sort(), ["ready", "unavailable"]);
  const anchor = JSON.parse(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"));
  const bootstrap = JSON.parse(readFileSync(storageBootstrapPath(paths), "utf8"));
  assert.equal(anchor.profileId, bootstrap.profileId); assert.equal(anchor.epochId, bootstrap.epochId);
});

if (process.platform === "win32") test("actual Windows ACL denial stops authorized creation without publishing metadata", t => {
  const { paths } = fixture(t); mkdirSync(paths.defaultUserData); const inspected = candidate(paths);
  const account = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  execFileSync("icacls.exe", [paths.defaultUserData, "/deny", `${account}:(WD,AD)`], { windowsHide: true });
  try {
    assert.equal(createInitialProfile(inspected, paths).kind, "unavailable");
    assert.deepEqual(readdirSync(paths.defaultUserData), []);
  } finally { execFileSync("icacls.exe", [paths.defaultUserData, "/remove:d", account], { windowsHide: true }); }
});

if (process.platform === "win32") test("Electron-ready profile directory cannot inherit a stale absent-directory candidate", t => {
  const { paths } = fixture(t);
  const stale = candidate(paths); // userData absent, as on a true first install
  mkdirSync(paths.defaultUserData);
  const localState = runtimeLocalState();
  const file = path.join(paths.defaultUserData, "Local State");
  writeFileSync(file, localState);
  assert.equal(createInitialProfile(stale, paths).kind, "unavailable"); // never waive mutation
  assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  assert.equal(resolveManagedStorage(paths).kind, "uninitialized");
  const inspectedAfterReady = candidate(paths); // reclassify, reject unknowns, bind existing security material
  assert.equal(createInitialProfile(inspectedAfterReady, paths).kind, "ready");
  assert.equal(readFileSync(file, "utf8"), localState);
  assert.equal(resolveManagedStorage(paths).kind, "ready");
});

test("revalidation reports bounded internal category without exposing Host paths, file bytes or binding", t => {
  const capture = (callback: () => ReturnType<typeof createInitialProfile>) => {
    const originalError = console.error;
    const messages: string[] = [];
    try {
      console.error = (...parts: unknown[]) => { messages.push(parts.map(String).join(" ")); };
      return { result: callback(), messages };
    } finally { console.error = originalError; }
  };
  for (const scenario of ["host", "directory", "foreign", "namespace"] as const) {
    const { paths } = fixture(t);
    mkdirSync(paths.defaultUserData);
    const inspected = candidate(paths);
    let current = paths;
    if (scenario === "host") current = { ...paths, defaultSessionData: path.join(paths.appData, "other") };
    if (scenario === "directory") { renameSync(paths.defaultUserData, `${paths.defaultUserData}-old`); mkdirSync(paths.defaultUserData); }
    if (scenario === "foreign") writeFileSync(path.join(paths.defaultUserData, "private-user-file"), "confidential 987654");
    if (scenario === "namespace") mkdirSync(path.join(paths.defaultUserData, "managed-files"));
    const { result, messages } = capture(() => createInitialProfile(inspected, current));
    assert.equal(result.kind, "unavailable");
    assert.equal("reason" in result && result.reason, "initialization_candidate_changed");
    const expected = {
      host: "host_paths_changed",
      directory: "directory_binding_changed",
      foreign: "profile_not_pristine",
      namespace: "recall_namespace_present",
    }[scenario];
    assert.deepEqual(messages, [`RECALL_INITIAL_PROFILE_REVALIDATION:${expected}`]);
    assert.ok(messages.every(value => !value.includes(paths.appData) && !value.includes("private-user-file")
      && !value.includes("confidential") && !value.includes("987654")));
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  }
});

if (process.platform === "win32") test("revalidation distinguishes Local State removal and security material changes", t => {
  const capture = (callback: () => ReturnType<typeof createInitialProfile>) => {
    const originalError = console.error;
    const messages: string[] = [];
    try {
      console.error = (...parts: unknown[]) => { messages.push(parts.map(String).join(" ")); };
      return { result: callback(), messages };
    } finally { console.error = originalError; }
  };
  for (const kind of ["disappeared", "modified"] as const) {
    const { paths } = fixture(t);
    mkdirSync(paths.defaultUserData);
    const state = path.join(paths.defaultUserData, "Local State");
    writeFileSync(state, runtimeLocalState());
    const initial = candidate(paths);
    if (kind === "disappeared") rmSync(state);
    if (kind === "modified") writeFileSync(state, runtimeLocalState("2"));
    const { result, messages } = capture(() => createInitialProfile(initial, paths));
    const category = {
      disappeared: "local_state_disappeared",
      modified: "local_state_binding_changed",
    }[kind];
    assert.equal("reason" in result && result.reason, "initialization_candidate_changed");
    assert.deepEqual(messages, [`RECALL_INITIAL_PROFILE_REVALIDATION:${category}`]);
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  }
});

if (process.platform === "win32") test("recognized runtime transitions during consent and either metadata publication retain directory and identity checks", async t => {
  for (const stage of ["consent", "identity", "bootstrap"]) for (const transition of ["state-appears", "state-replaced", "audit-updated", "lock-appears", "lock-removed", "lock-replaced"]) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const state = path.join(paths.defaultUserData, "Local State"); const lock = path.join(paths.defaultUserData, "lockfile");
    if (transition === "state-replaced") writeFileSync(state, runtimeLocalState());
    if (transition === "audit-updated") writeFileSync(state, runtimeLocalState().replace('"audit_enabled":true', '"audit_enabled":false'));
    if (transition === "lock-removed" || transition === "lock-replaced") writeFileSync(lock, "");
    const mutate = () => {
      if (transition === "state-appears") writeFileSync(state, runtimeLocalState());
      if (transition === "audit-updated") writeFileSync(state, runtimeLocalState());
      if (transition === "lock-appears") writeFileSync(lock, "");
      if (transition === "lock-removed") rmSync(lock);
      if (transition === "state-replaced" || transition === "lock-replaced") {
        const target = transition === "state-replaced" ? state : lock;
        const before = lstatSync(target).ino;
        const temporary = path.join(paths.appData, "runtime-replacement");
        writeFileSync(temporary, readFileSync(target)); renameSync(temporary, target);
        assert.notEqual(lstatSync(target).ino, before);
      }
    };
    const inspected = candidate(paths);
    const result = await completeInitialProfileDecision(inspected, async () => {
      if (stage === "consent") mutate(); return true;
    }, value => createInitialProfile(value, paths, { ...storageRecordIO, publishNew(from, to) {
      storageRecordIO.publishNew(from, to);
      if (to === (stage === "identity" ? storageIdentityPath(paths.defaultUserData) : stage === "bootstrap" ? storageBootstrapPath(paths) : "")) mutate();
    } }));
    assert.equal(result.kind, "ready", `${stage}/${transition}`);
    assert.deepEqual(resolveManagedStorage(paths), result);
    const identity = JSON.parse(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"));
    const bootstrap = JSON.parse(readFileSync(storageBootstrapPath(paths), "utf8"));
    assert.equal(identity.profileId, bootstrap.profileId); assert.equal(identity.epochId, bootstrap.epochId);
  }
});

if (process.platform === "win32") test("new runtime names never admit malformed files, links, unknown data or changed existing keys at any checkpoint", t => {
  for (const stage of ["consent", "identity", "bootstrap"]) for (const mutation of ["malformed", "nonempty-lock", "runtime-junction", "key-changed", "foreign", "partition"]) {
    const { root, paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const state = path.join(paths.defaultUserData, "Local State");
    if (mutation === "key-changed") writeFileSync(state, runtimeLocalState());
    const inspected = candidate(paths);
    const mutate = () => {
      if (mutation === "malformed") writeFileSync(state, "{partial");
      if (mutation === "nonempty-lock") writeFileSync(path.join(paths.defaultUserData, "lockfile"), "preserve");
      if (mutation === "runtime-junction") { const other = path.join(root, "other"); mkdirSync(other); symlinkSync(other, state, "junction"); }
      if (mutation === "key-changed") {
        const changed = JSON.parse(runtimeLocalState());
        changed.os_crypt.encrypted_key = Buffer.concat([Buffer.from("DPAPI"), Buffer.alloc(64, 1)]).toString("base64");
        writeFileSync(state, JSON.stringify(changed));
      }
      if (mutation === "foreign") writeFileSync(path.join(paths.defaultUserData, "foreign"), "preserve");
      if (mutation === "partition") mkdirSync(path.join(paths.defaultUserData, "Partitions", "review-workspace"), { recursive: true });
    };
    if (stage === "consent") mutate();
    const result = createInitialProfile(inspected, paths, { ...storageRecordIO, publishNew(from, to) {
      storageRecordIO.publishNew(from, to);
      if (to === (stage === "identity" ? storageIdentityPath(paths.defaultUserData) : stage === "bootstrap" ? storageBootstrapPath(paths) : "")) mutate();
    } });
    assert.equal(result.kind, "unavailable", `${stage}/${mutation}`);
    if (mutation === "malformed") assert.equal(readFileSync(state, "utf8"), "{partial");
    if (mutation === "foreign") assert.equal(readFileSync(path.join(paths.defaultUserData, "foreign"), "utf8"), "preserve");
    if (stage === "identity") assert.deepEqual(readdirSync(path.dirname(storageBootstrapPath(paths))), []);
    if (stage === "consent") assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  }
});

test("profile and bootstrap namespace replacements during publication cannot return a ready profile", t => {
  for (const replaced of ["profile", "bootstrap"]) {
    const { paths } = fixture(t); const inspected = candidate(paths);
    const result = createInitialProfile(inspected, paths, { ...storageRecordIO, publishNew(from, to) {
      storageRecordIO.publishNew(from, to);
      if (to !== storageIdentityPath(paths.defaultUserData)) return;
      const target = replaced === "profile" ? paths.defaultUserData : path.dirname(storageBootstrapPath(paths));
      renameSync(target, `${target}-preserved`); mkdirSync(target);
      if (replaced === "profile") {
        mkdirSync(path.dirname(storageIdentityPath(target)));
        writeFileSync(storageIdentityPath(target), readFileSync(storageIdentityPath(`${target}-preserved`)));
      }
    } });
    assert.equal(result.kind, "unavailable");
    assert.deepEqual(readdirSync(path.dirname(storageBootstrapPath(paths))), []);
    const original = replaced === "profile" ? storageIdentityPath(`${paths.defaultUserData}-preserved`) : storageIdentityPath(paths.defaultUserData);
    assert.equal(JSON.parse(readFileSync(original, "utf8")).formatVersion, 1);
  }
});

if (process.platform === "win32") test("Local State first observed after identity publication becomes bound before bootstrap confirmation", t => {
  const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
  const state = path.join(paths.defaultUserData, "Local State");
  const result = createInitialProfile(candidate(paths), paths, { ...storageRecordIO, publishNew(from, to) {
    storageRecordIO.publishNew(from, to);
    if (to === storageIdentityPath(paths.defaultUserData)) writeFileSync(state, runtimeLocalState());
    if (to === storageBootstrapPath(paths)) writeFileSync(state, runtimeLocalState("2"));
  } });
  assert.equal(result.kind, "unavailable");
  assert.equal(readFileSync(state, "utf8"), runtimeLocalState("2"));
  const identity = JSON.parse(readFileSync(storageIdentityPath(paths.defaultUserData), "utf8"));
  const bootstrap = JSON.parse(readFileSync(storageBootstrapPath(paths), "utf8"));
  assert.equal(identity.profileId, bootstrap.profileId); assert.equal(identity.epochId, bootstrap.epochId);
});

const debugRecord = (port = "33872") => `${port}\n/devtools/browser/10979ea8-1096-4e92-84c4-78f012c3f2a8`;

if (process.platform === "win32") test("debugger discovery is strictly typed runtime metadata, never a filename-only admission", t => {
  const malformed = ["", "user notes", debugRecord("0"), debugRecord("65536"), debugRecord("033872"),
    `${debugRecord()}\n`, debugRecord().replace("\n", "\r\n"), `${debugRecord()}?token=private`,
    debugRecord().replace("/devtools/browser/", "ws://localhost/devtools/browser/"), " ".repeat(4097), Buffer.from([0xff])];
  for (const contents of malformed) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "DevToolsActivePort"); writeFileSync(file, contents);
    assert.equal(initialProfileRejection(paths.defaultUserData), "debug_port_record_invalid");
    assert.equal(inspectInitialProfile(paths).kind, "unavailable");
    assert.deepEqual(readFileSync(file), Buffer.from(contents));
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
  }
  for (const port of ["1", "33872", "65535"]) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "DevToolsActivePort"); writeFileSync(file, debugRecord(port));
    assert.equal(isInitialRuntimeEntry(paths.defaultUserData, "DevToolsActivePort"), true);
    assert.equal(createInitialProfile(candidate(paths), paths).kind, "ready");
    assert.equal(readFileSync(file, "utf8"), debugRecord(port));
  }
});

if (process.platform === "win32") test("valid debugger metadata cannot admit unknown files, history, malformed runtime, links or initialization remnants", t => {
  for (const mutation of ["foreign", "history", "local-state", "lock", "junction", "profile-replaced", "managed-files", "identity-remnant", "bootstrap-remnant"]) {
    const { paths, root } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "DevToolsActivePort"); writeFileSync(file, debugRecord());
    const inspected = candidate(paths);
    if (mutation === "foreign") writeFileSync(path.join(paths.defaultUserData, "private-user-file"), "preserve");
    if (mutation === "history") mkdirSync(path.join(paths.defaultUserData, "Partitions", "review-workspace"), { recursive: true });
    if (mutation === "local-state") writeFileSync(path.join(paths.defaultUserData, "Local State"), "{partial");
    if (mutation === "lock") writeFileSync(path.join(paths.defaultUserData, "lockfile"), "preserve");
    if (mutation === "junction") { rmSync(file); const other = path.join(root, "other"); mkdirSync(other); symlinkSync(other, file, "junction"); }
    if (mutation === "profile-replaced") { renameSync(paths.defaultUserData, `${paths.defaultUserData}-preserved`); mkdirSync(paths.defaultUserData); writeFileSync(file, debugRecord()); }
    if (mutation === "managed-files") mkdirSync(path.join(paths.defaultUserData, "managed-files"));
    if (mutation === "identity-remnant") mkdirSync(path.dirname(storageIdentityPath(paths.defaultUserData)));
    if (mutation === "bootstrap-remnant") mkdirSync(path.dirname(storageBootstrapPath(paths)));
    assert.equal(createInitialProfile(inspected, paths).kind, "unavailable", mutation);
    if (mutation === "profile-replaced") {
      // 新候选不承诺跨进程识别已移走的目录；原候选必须拒绝替换，并保留原现场。
      assert.equal(readFileSync(path.join(`${paths.defaultUserData}-preserved`, "DevToolsActivePort"), "utf8"), debugRecord());
    } else assert.equal(inspectInitialProfile(paths).kind, "unavailable", mutation);
    assert.equal(existsSync(storageIdentityPath(paths.defaultUserData)), false);
  }
});

if (process.platform === "win32") test("typed debugger discovery may appear, disappear or change at checkpoints; malformed data stops publication", t => {
  for (const stage of ["consent", "identity", "bootstrap"]) for (const mutation of ["appears", "changed", "removed", "malformed"]) {
    const { paths } = fixture(t); mkdirSync(paths.defaultUserData);
    const file = path.join(paths.defaultUserData, "DevToolsActivePort");
    if (mutation !== "appears") writeFileSync(file, debugRecord());
    const inspected = candidate(paths);
    const mutate = () => mutation === "removed" ? rmSync(file) : writeFileSync(file,
      mutation === "malformed" ? "preserve" : debugRecord(mutation === "changed" ? "33873" : "33872"));
    if (stage === "consent") mutate();
    const result = createInitialProfile(inspected, paths, { ...storageRecordIO, publishNew(from, to) {
      storageRecordIO.publishNew(from, to);
      if (to === (stage === "identity" ? storageIdentityPath(paths.defaultUserData) : stage === "bootstrap" ? storageBootstrapPath(paths) : "")) mutate();
    } });
    assert.equal(result.kind, mutation === "malformed" ? "unavailable" : "ready", `${stage}/${mutation}`);
    if (mutation !== "malformed") assert.deepEqual(resolveManagedStorage(paths), result);
    if (stage === "identity" && mutation === "malformed") assert.deepEqual(readdirSync(path.dirname(storageBootstrapPath(paths))), []);
  }
});

if (process.platform === "win32") test("Windows file and directory symlinks never authorize profile creation or overwrite their targets", t => {
  // 本机令牌无创建 symlink 权限时必须失败；不提权或 skip。默认管理员 hosted job 执行实际反例。
  for (const [entry, contents] of [["lockfile", ""], ["Local State", runtimeLocalState()], ["DevToolsActivePort", debugRecord()]]) {
    const { paths, root } = fixture(t); mkdirSync(paths.defaultUserData);
    const targetRoot = path.join(root, "symbolic-target"); mkdirSync(targetRoot);
    const target = path.join(targetRoot, entry); writeFileSync(target, contents);
    assert.equal(isInitialRuntimeEntry(targetRoot, entry), true);
    const inspected = candidate(paths); const link = path.join(paths.defaultUserData, entry);
    symlinkSync(target, link, "file"); assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(createInitialProfile(inspected, paths).kind, "unavailable");
    assert.equal(inspectInitialProfile(paths).kind, "unavailable");
    assert.equal(readFileSync(target, "utf8"), contents);
    assert.equal(existsSync(storageIdentityPath(paths.defaultUserData)), false);
    assert.equal(existsSync(storageBootstrapPath(paths)), false);
  }
  const { paths, root } = fixture(t); mkdirSync(paths.defaultUserData); const inspected = candidate(paths);
  renameSync(paths.defaultUserData, path.join(root, "preserved-profile"));
  const target = path.join(root, "symbolic-directory"); mkdirSync(target); writeFileSync(path.join(target, "private-facts"), "preserve");
  symlinkSync(target, paths.defaultUserData, "dir"); assert.equal(lstatSync(paths.defaultUserData).isSymbolicLink(), true);
  assert.equal(createInitialProfile(inspected, paths).kind, "unavailable");
  assert.equal(inspectInitialProfile(paths).kind, "unavailable");
  assert.equal(readFileSync(path.join(target, "private-facts"), "utf8"), "preserve");
  assert.equal(existsSync(storageIdentityPath(target)), false);
});
