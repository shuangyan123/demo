import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { createSmokeScope, exerciseSmokeTool, judgeSmokeEvidence, missingSmokeGates, smokeEnvironment } from "./packaged-main-smoke-safety.mjs";

const gates = ["artifactBinding", "desktopInteraction", "knownFolderIsolation", "freshProfile", "networkBoundary", "processContainment", "storageBoundary"];
const assertions = ["packagedExecutable", "bundledStandalone", "externalRendererRejected", "reviewAppDocument", "mockDisabledInWindow", "networkConfined", "storageConfined", "normalExit"];
const verified = keys => Object.fromEntries(keys.map(key => [key, { executed: true, passed: true }]));
function fixtureDriver(overrides = {}) {
  const calls = [];
  const driver = { calls,
    async prepare() { calls.push("prepare"); return verified(gates); },
    async start() { calls.push("start"); }, async observe() { calls.push("observe"); return verified(assertions); },
    async closeNormally() { calls.push("close"); }, async stopAndConfirm() { calls.push("stop"); return true; }, ...overrides };
  return driver;
}
async function temporary(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "recall-smoke-tools-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("every missing OS precondition prevents target startup, including unknown Known Folders", async () => {
  for (const omitted of gates) {
    const driver = fixtureDriver({ async prepare() { const result = verified(gates); delete result[omitted]; return result; } });
    const result = await exerciseSmokeTool(driver);
    assert.equal(result.code, "precondition_failed"); assert.equal(result.cleaned, true);
    assert.equal(driver.calls.includes("start"), false); assert.equal(result.actualPackagedAcceptance, false);
  }
  assert.equal(missingSmokeGates(Object.fromEntries(gates.map(key => [key, true]))).length, gates.length);
});
test("unexecuted assertions cannot pass and simulation never becomes actual acceptance", async () => {
  for (const omitted of assertions) {
    const records = verified(assertions); records[omitted] = { passed: true };
    assert.equal(judgeSmokeEvidence(records, false).status, "INCOMPLETE");
  }
  const driver = fixtureDriver();
  const result = await exerciseSmokeTool(driver);
  assert.equal(result.status, "SIMULATION_PASSED"); assert.equal(result.actualPackagedAcceptance, false);
  assert.deepEqual(driver.calls, ["prepare", "start", "observe", "close", "stop"]);
  assert.equal(judgeSmokeEvidence({ ...verified(assertions), http409: { executed: true, source: "ui-inference", status: 409 } }, false).http409, "unobserved");
  assert.equal(judgeSmokeEvidence({ ...verified(assertions), http409: { executed: true, source: "independent-os-observation", status: 409 } }, true).http409, "simulated");
  assert.equal(judgeSmokeEvidence({ ...verified(assertions), http409: { executed: true, source: "independent-os-observation", status: 409 } }, false).http409, "reported_unvalidated");
  assert.equal(judgeSmokeEvidence(verified(assertions), false).actualPackagedAcceptance, false);
  const getter = Object.defineProperty({}, "packagedExecutable", { get() { throw new Error("synthetic-secret"); } });
  assert.equal(judgeSmokeEvidence(getter, false).status, "INCOMPLETE");
});
test("exception paths stop and clean, without exposing raw driver errors or environment", async () => {
  const secret = "synthetic-sensitive-value-never-export";
  for (const method of ["prepare", "start", "observe", "closeNormally"]) {
    const driver = fixtureDriver({ async [method]() { throw new Error(secret); } });
    const result = await exerciseSmokeTool(driver);
    assert.equal(result.code, "driver_failed"); assert.equal(result.stopped, true); assert.equal(result.cleaned, true);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  const hostileError = Object.defineProperty({}, "smokeCode", { get() { throw new Error(secret); } });
  const rejected = await exerciseSmokeTool(fixtureDriver({ async observe() { throw hostileError; } }));
  assert.equal(rejected.code, "driver_failed"); assert.equal(rejected.cleaned, true);
  assert.equal(JSON.stringify(rejected).includes(secret), false);
});
test("deadline aborts outstanding observation before process stop and cleanup", async () => {
  let aborted = false;
  const driver = fixtureDriver({ async observe(_scope, signal) {
    await new Promise((resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true }));
  } });
  const result = await exerciseSmokeTool(driver, { timeoutMs: 30 });
  assert.equal(aborted, true); assert.equal(result.code, "deadline_exceeded");
  assert.equal(result.cleaned, true); assert.equal(result.status, "INCOMPLETE");
});
test("late or unconfirmed operations cannot race cleanup or launch after a preflight timeout", async () => {
  await temporary(async parent => {
    let release;
    const driver = fixtureDriver({ async prepare() { return new Promise(resolve => { release = () => resolve(verified(gates)); }); } });
    const result = await exerciseSmokeTool(driver, { parent, timeoutMs: 20, stopTimeoutMs: 20 });
    assert.equal(result.code, "containment_unconfirmed"); assert.equal(result.cleaned, false);
    assert.equal((await readdir(parent)).length, 1);
    release(); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(driver.calls.includes("start"), false);
  });
});
test("unconfirmed process termination preserves the owned directory and cannot report pass", async () => {
  await temporary(async parent => {
    const result = await exerciseSmokeTool(fixtureDriver({ async stopAndConfirm() { return false; } }), { parent });
    assert.equal(result.code, "containment_unconfirmed"); assert.equal(result.cleaned, false);
    assert.equal((await readdir(parent)).length, 1); assert.equal(result.status, "INCOMPLETE");
  });
});
test("cleanup does not touch sibling data, and rejects a replaced ownership marker", async () => {
  await temporary(async parent => {
    const unrelated = path.join(parent, "unrelated-user-data"); await writeFile(unrelated, "preserve");
    const first = await createSmokeScope(parent); await writeFile(path.join(first.scope.temp, "fixture"), "test");
    await first.cleanup(); assert.equal(await readFile(unrelated, "utf8"), "preserve");
    const second = await createSmokeScope(parent); await writeFile(path.join(second.scope.root, ".smoke-owner"), "replaced");
    await assert.rejects(second.cleanup(), /unsafe_cleanup_owner/);
    assert.equal(await readFile(unrelated, "utf8"), "preserve");
  });
});
test("cleanup refuses junctions without following them into another directory", async () => {
  await temporary(async parent => {
    const external = await mkdtemp(path.join(os.tmpdir(), "recall-smoke-external-fixture-"));
    try {
      await writeFile(path.join(external, "preserve"), "unrelated");
      const owned = await createSmokeScope(parent);
      const link = path.join(owned.scope.temp, "redirect");
      await symlink(external, link, process.platform === "win32" ? "junction" : "dir");
      assert.equal((await lstat(link)).isSymbolicLink(), true);
      await assert.rejects(owned.cleanup(), /unsafe_cleanup_link/);
      assert.equal(await readFile(path.join(external, "preserve"), "utf8"), "unrelated");
      await rm(link); await owned.cleanup();
    } finally { await rm(external, { recursive: true, force: true }); }
  });
});
test("child environment is an exact whitelist, without inherited CI/Node/provider secrets", async () => {
  const owned = await createSmokeScope();
  try {
    const environment = smokeEnvironment(owned.scope, path.parse(process.execPath).root, path.dirname(process.execPath), "http://127.0.0.1:45678/sentinel");
    assert.deepEqual(Object.keys(environment).sort(), ["ELECTRON_RENDERER_URL", "PATH", "RECALL_UPDATE_MOCK_SCENARIO", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR"].sort());
    for (const key of ["GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN", "NODE_OPTIONS", "DEBUG", "REVIEW_DESKTOP_RUNTIME_TOKEN", "API_KEY", "APPDATA", "LOCALAPPDATA"])
      assert.equal(Object.hasOwn(environment, key), false);
    assert.throws(() => smokeEnvironment(owned.scope, path.parse(process.execPath).root, path.dirname(process.execPath), "https://external.example/"));
  } finally { await owned.cleanup(); }
});

// 原生 Job 测试只运行 Node 模拟进程，不接受 Recall 或任意目标程序路径。
async function nativeJob(parent, behavior, timeoutMs, terminateGuardian = false) {
  const scope = await createSmokeScope(parent);
  const worker = path.join(scope.scope.root, "mock-child.mjs");
  const heartbeat = path.join(scope.scope.temp, "heartbeat");
  const details = path.join(scope.scope.temp, "environment.json");
  await writeFile(worker, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
    const [role,heartbeat,details]=process.argv.slice(2);
    if(role==='child'){setInterval(()=>writeFileSync(heartbeat,String(Date.now())),15);}
    else if(role==='tree'){const child=spawn(process.execPath,[import.meta.filename,'child',heartbeat,details],{stdio:'ignore',env:process.env});writeFileSync(details,JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},100);}
    else if(role==='orphan'){spawn(process.execPath,[import.meta.filename,'child',heartbeat,details],{detached:true,stdio:'ignore',env:process.env}).unref();}
    else if(role==='nonzero'){process.exitCode=7;}
    else {writeFileSync(details,JSON.stringify(Object.keys(process.env))); console.log('synthetic-child-output-must-not-be-propagated');}
  `);
  const request = path.join(scope.scope.root, "job.json");
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, TEMP: scope.scope.temp, TMP: scope.scope.temp };
  await writeFile(request, JSON.stringify({ mode: "node-tool-fixture", executable: process.execPath, arguments: [worker, behavior, heartbeat, details], cwd: scope.scope.root, environment: env, timeoutMs }));
  const shell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const driver = spawn(shell, ["-NoProfile", "-NonInteractive", "-File", path.resolve("scripts/packaged-main-job.ps1"), "-RequestPath", request], { windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; driver.stdout.on("data", chunk => { output += chunk; }); driver.stderr.resume();
  const killGuardian = (async () => {
    if (!terminateGuardian) return;
    const deadline = Date.now() + 5000;
    while (true) {
      try { await access(heartbeat); break; } catch { /* 等待模拟子进程首次实际写入。 */ }
      if (Date.now() > deadline || driver.exitCode !== null) throw new Error("mock_tree_not_started");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    driver.kill();
  })();
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { driver.kill(); reject(new Error("native_guardian_timeout")); }, 15000);
    driver.once("error", error => { clearTimeout(timer); reject(error); });
    driver.once("exit", code => { clearTimeout(timer); resolve(code); });
  });
  await killGuardian;
  if (terminateGuardian) {
    const pids = JSON.parse(await readFile(details, "utf8"));
    const deadline = Date.now() + 3000;
    function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } }
    while (Object.values(pids).some(alive) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(Object.values(pids).some(alive), false);
    return { ...scope, heartbeat, details, result: { guardianKilled: true, activeProcesses: 0 } };
  }
  assert.equal(exitCode, 0, output); assert.equal(output.includes("synthetic-child-output-must-not-be-propagated"), false);
  const result = JSON.parse(output.trim());
  return { ...scope, result, heartbeat, details };
}
if (process.platform === "win32") {
  test("native Windows Job timeout terminates parent and grandchild; heartbeat stops", async () => {
    const owned = await nativeJob(undefined, "tree", 1000);
    try {
      assert.equal(owned.result.timedOut, true); assert.equal(owned.result.activeProcesses, 0);
      const last = await readFile(owned.heartbeat, "utf8"); await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await readFile(owned.heartbeat, "utf8"), last);
    } finally { await owned.cleanup(); }
  });
  test("native Windows Job also contains a descendant whose parent already exited", async () => {
    const owned = await nativeJob(undefined, "orphan", 1000);
    try { assert.equal(owned.result.activeProcesses, 0); assert.equal(owned.result.normalExit, false); assert.equal(owned.result.containmentUsed, true); }
    finally { await owned.cleanup(); }
  });
  test("guardian termination closes the native Job and kills its entire mock tree", async () => {
    const owned = await nativeJob(undefined, "tree", 10000, true);
    try { assert.equal(owned.result.guardianKilled, true); assert.equal(owned.result.activeProcesses, 0); }
    finally { await owned.cleanup(); }
  });
  test("native child receives only its explicit environment and normal exit is distinguished", async t => {
    t.mock.property(process, "env", { ...process.env, RECALL_SMOKE_SYNTHETIC_SECRET: "synthetic-private-value" });
    const owned = await nativeJob(undefined, "environment", 1000);
    try {
      assert.equal(owned.result.normalExit, true); assert.equal(owned.result.activeProcesses, 0);
      const keys = JSON.parse(await readFile(owned.details, "utf8"));
      for (const key of keys) assert.ok(["SYSTEMROOT", "WINDIR", "TEMP", "TMP"].includes(key.toUpperCase()), key);
    } finally { await owned.cleanup(); }
  });
  test("native Job handles owned paths containing spaces", async () => {
    await temporary(async parent => {
      const spaced = path.join(parent, "owned parent with spaces"); await mkdir(spaced);
      const owned = await nativeJob(spaced, "environment", 1000);
      try { assert.equal(owned.result.normalExit, true); assert.equal(owned.result.activeProcesses, 0); }
      finally { await owned.cleanup(); }
    });
  });
  test("nonzero natural process exit cannot be reported as normal success", async () => {
    const owned = await nativeJob(undefined, "nonzero", 1000);
    try {
      assert.equal(owned.result.processExited, true); assert.equal(owned.result.exitCode, 7);
      assert.equal(owned.result.normalExit, false); assert.equal(owned.result.timedOut, false);
      assert.equal(owned.result.activeProcesses, 0);
    } finally { await owned.cleanup(); }
  });
  test("native guardian rejects a forbidden environment before the canary target can start", async () => {
    const owned = await createSmokeScope();
    try {
      const root = owned.scope.root, canary = path.join(root, "must-not-exist");
      const worker = path.join(root, "mock-child.mjs"), request = path.join(root, "request.json");
      await writeFile(worker, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(canary)},'started');`);
      const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, TEMP: owned.scope.temp, TMP: owned.scope.temp };
      await writeFile(request, JSON.stringify({ mode: "node-tool-fixture", executable: process.execPath,
        arguments: [worker, "environment", path.join(root, "temp", "heartbeat"), path.join(root, "temp", "environment.json")],
        cwd: root, timeoutMs: 1000, environment: { ...env, GITHUB_TOKEN: "synthetic-rejected-credential" } }));
      const result = spawnSync(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-File", path.resolve("scripts/packaged-main-job.ps1"), "-RequestPath", request],
        { env, windowsHide: true, encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1); assert.equal(result.error, undefined);
      assert.deepEqual(JSON.parse(result.stdout), { error: "owned_process_job_failed" });
      assert.equal((result.stdout + result.stderr).includes("synthetic-rejected-credential"), false);
      await assert.rejects(access(canary), { code: "ENOENT" });
    } finally { await owned.cleanup(); }
  });
}

test("empty observation still fails even when the driver exits normally", async () => {
  const result = await exerciseSmokeTool(fixtureDriver({ async observe() { return {}; } }));
  assert.equal(result.status, "INCOMPLETE"); assert.equal(result.code, "assertion_incomplete");
  assert.equal(result.cleaned, true); assert.equal(result.actualPackagedAcceptance, false);
});
