import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { diagnosticStorageFixture } from "../test-support/diagnostic-storage.ts";
import { protocolBackendInvocation } from "../test-support/protocol-diagnostic-guard.ts";

if (process.platform === "win32") test("actual Electron native POST commits, redirects and resumes across backend restart without rewriting Fetch Metadata", async () => {
  const fixture = diagnosticStorageFixture(true); const token = randomBytes(32).toString("base64url");
  const invocation = protocolBackendInvocation(fixture.root, token);
  const traces: unknown[] = []; const workers: ReturnType<typeof fork>[] = []; let passed = false;
  async function launch() {
    const child = fork("test-support/protocol-diagnostic-backend.ts", [], { silent: true, execArgv: ["--experimental-strip-types"],
      env: { ...process.env, RECALL_MANAGED_STORAGE_BOOTSTRAP: fixture.payload, REVIEW_DESKTOP_RUNTIME_TOKEN: token } });
    workers.push(child);
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("test backend startup timeout")), 10000);
      child.on("message", message => { if (message && typeof message === "object" && "url" in message) { clearTimeout(timer); resolve(String(message.url)); } else traces.push(message); });
      child.once("error", reject); child.once("exit", code => { clearTimeout(timer); reject(new Error(`test backend exited ${code}`)); });
      child.send(invocation);
    });
    return { child, url };
  }
  async function stop(child: ReturnType<typeof fork>) {
    if (child.exitCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("test backend shutdown timeout")), 10000);
      child.once("exit", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error("test backend failed")); }); child.send("stop");
    });
  }
  async function native(url: string, mode: string, oldSession = "") {
    writeFileSync(path.join(fixture.root, "native-config.json"), JSON.stringify({ baseUrl: url, token, oldSession }), { mode: 0o600 });
    const stdout = execFileSync(path.resolve("node_modules/electron/dist/electron.exe"),
      ["test-support/protocol-diagnostic-native.cjs", fixture.root, mode],
      { cwd: process.cwd(), windowsHide: true, timeout: 25000, encoding: "utf8" });
    return JSON.parse(stdout.trim());
  }
  try {
    const a = await launch();
    const denied = await fetch(a.url + "/diagnostic/resume"); assert.equal(denied.status, 403);
    const foreignHeaders: Record<string, string>[] = [{ origin: "https://foreign.example" }, { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" }, { origin: "null", "sec-fetch-site": "none" }];
    for (const headers of foreignHeaders) {
      const response = await fetch(a.url + "/api/diagnostic/submit", { method: "POST", redirect: "manual",
        headers: { "x-review-runtime-token": token, "content-type": "application/x-www-form-urlencoded", ...headers }, body: "sessionId=unknown&selectedOptionId=five" });
      assert.equal(response.status, 403);
    }
    const first = await native(a.url, "first");
    assert.equal(first.before.history, "complete-empty"); assert.equal(first.after.attemptCount, 1); assert.equal(first.after.evidenceCount, 1);
    const firstBytes = readFileSync(fixture.file); const firstSnapshot = JSON.parse(firstBytes.toString("utf8"));
    assert.equal(firstSnapshot.generation, 1); assert.equal(firstSnapshot.captures[0].selectedOptionId, "five");
    await stop(a.child);
    const b = await launch(); assert.notEqual(b.child.pid, a.child.pid);
    const second = await native(b.url, "repeat", first.sessionId); assert.notEqual(second.mainPid, first.mainPid);
    assert.deepEqual(second.before.attempts, first.after.attempts); assert.deepEqual(second.before.state, first.after.state);
    assert.deepEqual(second.before.decision, first.after.decision);
    const secondSnapshot = JSON.parse(readFileSync(fixture.file, "utf8"));
    assert.equal(secondSnapshot.generation, 2); assert.deepEqual(secondSnapshot.captures[0], firstSnapshot.captures[0]);
    assert.notEqual(secondSnapshot.captures[1].id, firstSnapshot.captures[0].id);
    assert.equal(secondSnapshot.captures[1].selectedOptionId, "four"); assert.equal(second.after.evidenceCount, 2);
    assert.deepEqual(second.after.decision, { kind: "none", reason: "ambiguous_verification_target" });
    assert.equal(second.after.state.understanding, "unknown");
    await stop(b.child);
    assert.equal(traces.filter(trace => (trace as { status: number }).status === 303).length, 2);
    assert.ok(traces.filter(trace => (trace as { status: number }).status === 303).every(trace => (trace as { site: null }).site === null));
    passed = true;
  } finally {
    for (const worker of workers) await stop(worker);
    if (passed) fixture.cleanup();
    else writeFileSync(path.join(fixture.root, "native-protocol-failure.json"), JSON.stringify({ fixtureRoot: fixture.root, traces }, null, 2));
  }
});
