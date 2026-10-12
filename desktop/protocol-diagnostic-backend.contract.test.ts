import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnosticStorageFixture } from "../test-support/diagnostic-storage.ts";
import { protocolBackendInvocation, protocolRequestAuthorized } from "../test-support/protocol-diagnostic-guard.ts";

const helper = "test-support/protocol-diagnostic-backend.ts";
type Invocation = ReturnType<typeof protocolBackendInvocation>;
type Fixture = ReturnType<typeof diagnosticStorageFixture>;
function prepared(t: { after(fn: () => void): void; diagnostic(text: string): void }) {
  const fixture = diagnosticStorageFixture(true), token = randomBytes(32).toString("base64url");
  const invocation = protocolBackendInvocation(fixture.root, token);
  let passed = false;
  t.after(() => { if (passed) fixture.cleanup(); else t.diagnostic(`Protocol fixture retained: ${fixture.root}`); });
  return { fixture, token, invocation, pass: () => { passed = true; } };
}
function environment(fixture: Fixture, token: string | undefined) {
  return { ...process.env, RECALL_MANAGED_STORAGE_BOOTSTRAP: fixture.payload, REVIEW_DESKTOP_RUNTIME_TOKEN: token };
}
async function rejectsBeforeStorage(fixture: Fixture, invocation: object, env: NodeJS.ProcessEnv) {
  assert.equal(existsSync(fixture.config.managedFilesRoot), false);
  const child = fork(helper, [], { silent: true, execArgv: ["--experimental-strip-types"], env });
  let started = false;
  child.on("message", message => { if (message && typeof message === "object" && "url" in message) started = true; });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("owned protocol negative child timeout")); }, 8000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", value => { clearTimeout(timer); resolve(value); });
    child.send(invocation);
  });
  assert.equal(code, 1); assert.equal(started, false);
  assert.equal(existsSync(fixture.file), false); assert.equal(existsSync(fixture.config.managedFilesRoot), false);
}

test("protocol backend refuses standalone invocation before opening ambient storage", t => {
  const state = prepared(t);
  const child = spawnSync(process.execPath, ["--experimental-strip-types", helper], {
    env: environment(state.fixture, state.token), encoding: "utf8", windowsHide: true, timeout: 8000,
  });
  assert.equal(child.status, 1); assert.equal(existsSync(state.fixture.config.managedFilesRoot), false); state.pass();
});
const invalidInvocations: Array<[string, (value: Invocation) => object]> = [
  ["missing test authorization", value => ({ ...value, kind: "ordinary_request" })],
  ["wrong parent PID", value => ({ ...value, parentPid: value.parentPid + 1 })],
  ["real profile location", value => ({ ...value, fixtureRoot: path.join(os.homedir(), "AppData", "Roaming", "Recall") })],
];
for (const [name, change] of invalidInvocations) test(`protocol backend rejects ${name} before storage initialization`, async t => {
  const state = prepared(t);
  await rejectsBeforeStorage(state.fixture, change(state.invocation), environment(state.fixture, state.token)); state.pass();
});
for (const [name, token] of [["missing", undefined], ["mismatched", "x".repeat(43)]] as const)
  test(`protocol backend rejects ${name} configured token before storage initialization`, async t => {
    const state = prepared(t);
    await rejectsBeforeStorage(state.fixture, state.invocation, environment(state.fixture, token)); state.pass();
  });
test("protocol backend rejects unrecognized configured storage paths before repository open", async t => {
  const state = prepared(t), config = JSON.parse(state.fixture.payload);
  const realProfile = path.join(os.homedir(), "AppData", "Roaming", "Recall");
  const env = environment(state.fixture, state.token);
  env.RECALL_MANAGED_STORAGE_BOOTSTRAP = JSON.stringify({ ...config, managedRoot: realProfile, profileRoot: realProfile,
    managedFilesRoot: path.join(realProfile, "managed-files") });
  await rejectsBeforeStorage(state.fixture, state.invocation, env); state.pass();
});
test("protocol backend rejects a fixture without its parent ownership record", async t => {
  const state = prepared(t); unlinkSync(path.join(state.fixture.root, "protocol-test-owner.json"));
  await rejectsBeforeStorage(state.fixture, state.invocation, environment(state.fixture, state.token)); state.pass();
});
test("protocol backend rejects linked fixture layouts, using disposable targets only", async t => {
  const state = prepared(t), profile = state.fixture.config.profileRoot, target = profile + "-owned-target";
  renameSync(profile, target); symlinkSync(target, profile, process.platform === "win32" ? "junction" : "dir");
  await rejectsBeforeStorage(state.fixture, state.invocation, environment(state.fixture, state.token)); state.pass();
});
test("protocol backend rejects fixture identity disagreement before history initialization", async t => {
  const state = prepared(t), anchor = path.join(state.fixture.config.profileRoot, ".recall-storage", "identity.json");
  writeFileSync(anchor, JSON.stringify({ ...JSON.parse(readFileSync(anchor, "utf8")), profileId: randomUUID() }));
  await rejectsBeforeStorage(state.fixture, state.invocation, environment(state.fixture, state.token)); state.pass();
});
test("protocol backend requires exact nonempty request tokens and preserves history on denial", async t => {
  const state = prepared(t);
  assert.equal(protocolRequestAuthorized(undefined, undefined), false);
  const child = fork(helper, [], { silent: true, execArgv: ["--experimental-strip-types"], env: environment(state.fixture, state.token) });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("authorized protocol child timeout")), 8000);
      child.once("message", message => { clearTimeout(timer); resolve(String((message as { url: string }).url)); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("authorized protocol child exited")); });
      child.send(state.invocation);
    });
    const before = readFileSync(state.fixture.file);
    for (const supplied of [undefined, "", "x".repeat(43)]) {
      const denied = await fetch(url + "/diagnostic/resume", { headers: supplied === undefined ? {} : { "x-review-runtime-token": supplied } });
      assert.equal(denied.status, 403); assert.deepEqual(readFileSync(state.fixture.file), before);
    }
    assert.equal((await fetch(url + "/diagnostic/resume", { headers: { "x-review-runtime-token": state.token } })).status, 200);
  } finally {
    if (child.exitCode === null) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("owned protocol child shutdown timeout")); }, 8000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.send("stop");
    });
  }
  state.pass();
});
