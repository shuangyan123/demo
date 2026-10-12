import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import test from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { GET } from "../../api/internal/diagnostic-ready/route.ts";
import { closeDiagnosticRuntime, composeDiagnosticRuntime, readDiagnosticRuntimeReadiness } from "./runtime.ts";
import { commitDiagnosticSubmission } from "./assessment-submission.ts";
import { reconstructDiagnosticLearnerState } from "./state-reconstruction.ts";

const request = (token?: string) => new Request("http://127.0.0.1/api/internal/diagnostic-ready", {
  headers: token ? { "x-review-startup-token": token } : {},
});

test("ordinary Web and unauthorized internal callers cannot read runtime or create storage", t => {
  closeDiagnosticRuntime(); const storage = diagnosticStorageFixture(true); t.after(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  const original = process.env.REVIEW_DESKTOP_RUNTIME_TOKEN;
  t.after(() => { if (original === undefined) delete process.env.REVIEW_DESKTOP_RUNTIME_TOKEN; else process.env.REVIEW_DESKTOP_RUNTIME_TOKEN = original; });
  delete process.env.REVIEW_DESKTOP_RUNTIME_TOKEN; assert.equal(GET(request()).status, 404);
  const token = randomBytes(32).toString("base64url"); process.env.REVIEW_DESKTOP_RUNTIME_TOKEN = token;
  for (const value of [undefined, "wrong", "x".repeat(43), "é".repeat(43)]) assert.equal(GET(request(value)).status, 403);
  assert.deepEqual(readDiagnosticRuntimeReadiness(), { kind: "storage_config_unavailable" });
  assert.equal(existsSync(storage.file), false);
});

test("authenticated readiness is minimal, no-store and never initializes an absent runtime", async t => {
  closeDiagnosticRuntime(); const storage = diagnosticStorageFixture(true); t.after(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  const token = randomBytes(32).toString("base64url"); const original = process.env.REVIEW_DESKTOP_RUNTIME_TOKEN;
  process.env.REVIEW_DESKTOP_RUNTIME_TOKEN = token;
  t.after(() => { if (original === undefined) delete process.env.REVIEW_DESKTOP_RUNTIME_TOKEN; else process.env.REVIEW_DESKTOP_RUNTIME_TOKEN = original; });
  const missing = GET(request(token)); assert.equal(missing.status, 503); assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.deepEqual(await missing.json(), { kind: "storage_config_unavailable" }); assert.equal(existsSync(storage.file), false);
  composeDiagnosticRuntime(storage.config); const bytes = readFileSync(storage.file, "utf8");
  for (let index = 0; index < 3; index++) {
    const response = GET(request(token)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { kind: "ready" });
    assert.equal(readFileSync(storage.file, "utf8"), bytes);
  }
  const empty = reconstructDiagnosticLearnerState({ specId: "int-add-2-3", specRevision: "r1", asOf: new Date().toISOString() });
  assert.equal(empty.kind, "complete"); if (empty.kind !== "complete") throw new Error("empty required");
  assert.equal(empty.scope.captureCount, 0); assert.deepEqual(empty.events, []); assert.deepEqual(empty.evidence, []); assert.equal(empty.state, null);
  assert.deepEqual(empty.decision, { kind: "none", reason: "incomplete_effective_state" });
  closeDiagnosticRuntime(); unlinkSync(storage.file); composeDiagnosticRuntime(storage.config);
  const incomplete = GET(request(token)); assert.equal(incomplete.status, 503); assert.deepEqual(await incomplete.json(), { kind: "history_incomplete" });
  assert.equal(existsSync(storage.file), false);
});

test("fresh setup → confirmed first submission → independent process recovery preserves canonical state and WHAT", async t => {
  closeDiagnosticRuntime(); const storage = diagnosticStorageFixture(true); t.after(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  const runtime = composeDiagnosticRuntime(storage.config); const issued = runtime.issue();
  assert.equal(issued.kind, "issued"); if (issued.kind !== "issued") throw new Error("issue required");
  const submitted = await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId: "five" });
  assert.equal(submitted.kind, "submitted"); if (submitted.kind !== "submitted") throw new Error("submission required");
  const asOf = new Date().toISOString(); const expected = reconstructDiagnosticLearnerState({ specId: "int-add-2-3", specRevision: "r1", asOf });
  const bytes = readFileSync(storage.file, "utf8"); closeDiagnosticRuntime();
  const script = `import {initializeDiagnosticRuntime,closeDiagnosticRuntime} from './app/server/diagnostic/runtime.ts';
    import {reconstructDiagnosticLearnerState} from './app/server/diagnostic/state-reconstruction.ts';
    initializeDiagnosticRuntime(); process.stdout.write(JSON.stringify(reconstructDiagnosticLearnerState({specId:'int-add-2-3',specRevision:'r1',asOf:process.argv[1]}))); closeDiagnosticRuntime();`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, asOf], {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true, env: { ...process.env, RECALL_MANAGED_STORAGE_BOOTSTRAP: storage.payload },
  });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), expected);
  assert.equal(readFileSync(storage.file, "utf8"), bytes);
  const stored = JSON.parse(bytes); assert.equal(stored.profileId, storage.config.profileId); assert.equal(stored.epochId, storage.config.epochId);
  assert.deepEqual(stored.captures[0], submitted.attempt);
});
