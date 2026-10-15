import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { completeInitialProfileDecision, createInitialProfile, inspectInitialProfile } from "./profile-initialization.ts";
import { gateManagedStorageStartup, resolveManagedStorage, storageBootstrapPath, storageIdentityPath, type StorageHostPaths } from "./storage-bootstrap.ts";
import { storageRecordIO } from "./storage-bootstrap-io.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const temporaryRoot = realpathSync.native(os.tmpdir());
  const root = mkdtempSync(path.join(temporaryRoot, "recall-fresh-profile-test-"));
  t.after(() => {
    assert.equal(path.dirname(root), temporaryRoot); assert.match(path.basename(root), /^recall-fresh-profile-test-/);
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

if (process.platform === "win32") test("Local State changes after native inspection or during publication stop creation without overwrite", t => {
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
    assert.equal(createInitialProfile(inspected, current).kind, "unavailable");
    assert.equal(readdirSync(paths.appData).includes("recall-storage"), false);
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
