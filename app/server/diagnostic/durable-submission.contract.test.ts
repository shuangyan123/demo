import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync } from "node:fs";
import test, { describe, beforeEach, afterEach } from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { parseDiagnosticStorageConfig } from "./storage-config.ts";
import { composeDiagnosticRuntime, closeDiagnosticRuntime, initializeDiagnosticRuntime } from "./runtime.ts";
import { commitDiagnosticSubmission, continueDiagnosticSubmission } from "./assessment-submission.ts";
import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { createDiagnosticHistoryRepository } from "./history/repository-core.ts";
import { diagnosticHistoryIO } from "./history/io.ts";
import { POST } from "../../api/diagnostic/submit/route.ts";

const locator = (attempt: { id: string }) => ({ sourceOwnerId: "recall-diagnostic", specId: "int-add-2-3", specRevision: "r1", attemptId: attempt.id });
const script = `
import { initializeDiagnosticRuntime } from './app/server/diagnostic/runtime.ts';
import { commitDiagnosticSubmission } from './app/server/diagnostic/assessment-submission.ts';
import { admitVerifiedAssessment } from './app/services/verification-source/verification-source-admission.ts';
import { adaptVerifiedAssessment } from './app/services/learning-kernel/verified-assessment-adapter.ts';
import { deriveEvidence } from './app/services/learning-kernel/derive-evidence.ts';
const input = JSON.parse(process.argv[1]);
const runtime = initializeDiagnosticRuntime();
if (runtime.readiness().kind !== 'ready') throw Error('child_not_ready');
function facts(attempt) {
 const admitted = admitVerifiedAssessment({ sourceOwnerId: 'recall-diagnostic', specId: 'int-add-2-3', specRevision: 'r1', attemptId: attempt.id });
 if (admitted.kind !== 'admitted') throw Error('child_admission_failed');
 const adapted = adaptVerifiedAssessment(admitted.spec, admitted.attempt);
 return { attempt, admitted, events: adapted.events, evidence: deriveEvidence(adapted.events).evidence };
}
let result;
if (input.mode === 'submit') {
 result = []; for (const selectedOptionId of ['five', 'four']) {
   const issued = runtime.issue();
   if (issued.kind !== 'issued') throw Error('child_issue_failed');
   const submitted = await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId });
   if (submitted.kind !== 'submitted') throw Error('child_submit_failed');
   result.push({ ...facts(submitted.attempt), sessionId: issued.sessionId });
 }
} else if (input.mode === 'crash') {
 const issued = runtime.issue();
 const captured = runtime.capture({ sessionId: issued.sessionId, selectedOptionId: 'four' });
 if (captured.kind !== 'captured' || (await runtime.append(captured.attempt)).kind !== 'committed') throw Error('child_commit_failed');
 result = captured.attempt; // 进程在 durable commit 后、admission/HTTP 成功前退出。
} else {
 result = input.attempts.map(attempt => {
   if (runtime.read(attempt.sessionId).kind !== 'unavailable') throw Error('historical_session_survived');
   return facts(runtime.resolveAttempt(attempt.id));
 });
}
process.stdout.write(JSON.stringify(result));
if (input.mode === 'crash') process.exitCode = 23;
else runtime.close();
`;
function child(payload: string, input: unknown, exit = 0) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, JSON.stringify(input)],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15000, env: { ...process.env, RECALL_MANAGED_STORAGE_BOOTSTRAP: payload } });
  assert.equal(result.status, exit, result.stderr);
  return JSON.parse(result.stdout);
}

describe("production durable submission and owner recovery", () => {
  let storage: ReturnType<typeof diagnosticStorageFixture>;
  beforeEach(() => { closeDiagnosticRuntime(); storage = diagnosticStorageFixture(); });
  afterEach(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  function runtime() { return composeDiagnosticRuntime(storage.config); }
  function issue(active = initializeDiagnosticRuntime()) {
    const issued = active.issue();
    assert.equal(issued.kind, "issued");
    if (issued.kind !== "issued") throw new Error("issue failed");
    return { sessionId: issued.sessionId, selectedOptionId: "five" };
  }
  function record() { return JSON.parse(readFileSync(storage.file, "utf8")); }
  function mutate(change: (value: Record<string, unknown>) => void) {
    const value = record(); change(value);
    delete value.integrity;
    value.integrity = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    writeFileSync(storage.file, JSON.stringify(value));
  }

  test("Main serialized config strictly reconstructs expected profile, epoch and root", () => {
    const parsed = parseDiagnosticStorageConfig(storage.payload);
    assert.equal(parsed.kind, "configured");
    if (parsed.kind !== "configured") throw new Error("config unavailable");
    assert.deepEqual(parsed.config, storage.config);
    assert.ok(Object.isFrozen(parsed.config));
    const active = composeDiagnosticRuntime(parsed.config);
    assert.equal(active.readiness().kind, "ready");
    assert.deepEqual(record().captures, []);
    assert.equal(record().generation, 0);
    assert.equal(record().profileId, storage.config.profileId);
    assert.equal(record().epochId, storage.config.epochId);
  });
  test("serialized config rejects absence, malformed/duplicate/unknown fields and topology overrides", () => {
    for (const payload of [undefined, "", "[]", "{}", "{", "x".repeat(8193),
      storage.payload.replace('{"formatVersion":1,', '{"formatVersion":1,"formatVersion":1,'),
      JSON.stringify({ ...JSON.parse(storage.payload), secret: "caller" }),
      ...[{ formatVersion: 2 }, { profileId: "caller" }, { epochId: "caller" }, { managedRoot: "." },
        { managedFilesRoot: storage.root }, { profileRoot: storage.root }, { managedRoot: storage.root + "\\.." }]
        .map(patch => JSON.stringify({ ...JSON.parse(storage.payload), ...patch }))])
      assert.equal(parseDiagnosticStorageConfig(payload).kind, "storage_config_unavailable");
  });
  test("absent trusted composition cannot issue session or create domain", () => {
    const active = composeDiagnosticRuntime(undefined);
    assert.equal(active.readiness().kind, "storage_config_unavailable");
    assert.equal(active.issue().kind, "unavailable");
    assert.equal(existsSync(storage.file), false);
  });
  test("capture failure writes no attempt and permits no reveal", async () => {
    const active = runtime(); const input = issue(active);
    assert.equal((await commitDiagnosticSubmission({ ...input, selectedOptionId: "impossible" })).kind, "rejected");
    assert.deepEqual(record().captures, []);
    assert.equal(active.read(input.sessionId).kind, "issued");
  });
  for (const selectedOptionId of ["five", "four"]) test(`${selectedOptionId}: durable confirmation precedes owner/admission/Evidence/reveal`, async () => {
    const active = runtime(); const input = { ...issue(active), selectedOptionId };
    const result = (await continueDiagnosticSubmission(input, active, request => {
      assert.equal(record().captures.length, 1);
      assert.equal(active.read(input.sessionId).kind, "pending");
      return admitVerifiedAssessment(request);
    }));
    assert.equal(result.kind, "submitted");
    if (result.kind !== "submitted") throw new Error("submit failed");
    assert.deepEqual(active.resolveAttempt(result.attempt.id), result.attempt);
    assert.equal(result.evidence[0].outcome.direction, selectedOptionId === "five" ? "supports" : "refutes");
    assert.equal(active.read(input.sessionId).kind, "revealed");
    assert.equal(result.attempt.assistance, "none");
  });
  test("append failure retains sealed same attempt; manual continuation never recaptures or edits response", async (context) => {
    let failing = false;
    const active = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
      ...diagnosticHistoryIO, publishReplacement(from, to) { if (failing) throw new Error("disk unavailable"); diagnosticHistoryIO.publishReplacement(from, to); },
    }));
    const input = issue(active); failing = true;
    const result = (await commitDiagnosticSubmission(input));
    assert.equal(result.kind, "captured_not_durable");
    if (result.kind !== "captured_not_durable") throw new Error("expected sealed capture");
    assert.deepEqual(record().captures, []);
    assert.equal(active.resolveAttempt(result.attempt.id), undefined);
    assert.equal(admitVerifiedAssessment(locator(result.attempt)).kind, "rejected");
    assert.equal(active.read(input.sessionId).kind, "pending");
    assert.equal(active.issue().kind, "unavailable");
    const response = await POST(new Request("http://localhost:4320/api/diagnostic/submit", { method: "POST",
      headers: { origin: "http://localhost:4320", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(input) }));
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /返回作答页/);
    assert.doesNotMatch(body, /saved|已提交|正确答案|explanation/);
    assert.deepEqual((await commitDiagnosticSubmission({ ...input, selectedOptionId: "four" })), { kind: "rejected", reason: "sealed_response_conflict" });
    const now = Date.now(); context.mock.method(Date, "now", () => now + 1000);
    const again = (await commitDiagnosticSubmission(input));
    assert.equal(again.kind, "captured_not_durable");
    if (again.kind !== "captured_not_durable") throw new Error("retry failed");
    assert.equal(again.attempt, result.attempt, "same sealed object; ID/time/assistance/provenance unchanged");
    failing = false;
    const continued = (await commitDiagnosticSubmission(input));
    assert.equal(continued.kind, "submitted");
    if (continued.kind !== "submitted") throw new Error("continuation failed");
    assert.equal(continued.attempt, result.attempt);
    assert.equal(record().captures.length, 1);
    assert.equal(record().generation, 1);
  });
  test("unconfirmed publication can be manually confirmed idempotently without creating another attempt", async () => {
    let fault = false;
    const active = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
      ...diagnosticHistoryIO, publishReplacement(from, to) {
        diagnosticHistoryIO.publishReplacement(from, to); if (fault) throw new Error("confirmation interrupted");
      },
    }));
    const input = issue(active); fault = true;
    const result = (await commitDiagnosticSubmission(input));
    assert.equal(result.kind, "captured_not_durable");
    if (result.kind !== "captured_not_durable") throw new Error("expected unconfirmed");
    assert.equal(record().captures.length, 1);
    assert.equal(active.resolveAttempt(result.attempt.id), undefined, "published but unconfirmed is not owner authority");
    fault = false;
    assert.equal((await commitDiagnosticSubmission(input)).kind, "submitted");
    assert.equal(record().generation, 1);
  });
  test("durable then admission failure keeps record, no reveal; restart still re-admits", async () => {
    const active = runtime(); const input = issue(active);
    const result = (await continueDiagnosticSubmission(input, active, () => ({ kind: "rejected", reason: "invalid_attempt", policyVersion: "source-admission/v1" })));
    assert.equal(result.kind, "durable_not_admitted");
    if (result.kind !== "durable_not_admitted") throw new Error("expected durable failure");
    assert.equal(record().captures[0].id, result.attempt.id);
    assert.equal(active.read(input.sessionId).kind, "pending");
    assert.equal(admitVerifiedAssessment(locator(result.attempt)).kind, "admitted");
    closeDiagnosticRuntime();
    const restored = child(storage.payload, { mode: "reopen", attempts: [result.attempt] });
    assert.equal(restored[0].attempt.id, result.attempt.id);
    assert.equal(record().generation, 1);
  });
  test("already durable continuation uses repository confirmation and cannot replace captured facts", async () => {
    const active = runtime(); const input = issue(active);
    const failed = (await continueDiagnosticSubmission(input, active, () => ({ kind: "rejected", reason: "invalid_attempt", policyVersion: "source-admission/v1" })));
    assert.equal(failed.kind, "durable_not_admitted");
    if (failed.kind !== "durable_not_admitted") throw new Error("expected durable failure");
    const confirmed = (await commitDiagnosticSubmission(input));
    assert.equal(confirmed.kind, "submitted");
    if (confirmed.kind !== "submitted") throw new Error("continuation failed");
    assert.equal(confirmed.attempt, failed.attempt);
    assert.equal(record().generation, 1);
  });
  test("owner admission is synchronous over loaded complete index, with no repository read at admission", async () => {
    let reads = 0;
    const active = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
      ...diagnosticHistoryIO, read(file) { reads += 1; return diagnosticHistoryIO.read(file); },
    }));
    const result = (await commitDiagnosticSubmission(issue(active)));
    assert.equal(result.kind, "submitted");
    if (result.kind !== "submitted") throw new Error("submit failed");
    const before = reads;
    assert.deepEqual(admitVerifiedAssessment(locator(result.attempt)), result.admitted);
    assert.equal(reads, before);
  });
  test("independent A→B process restart preserves both Event/Evidence identity and factual meaning without sessions", () => {
    const original = child(storage.payload, { mode: "submit" });
    const recovered = child(storage.payload, { mode: "reopen", attempts: original.map((value: { attempt: { id: string }; sessionId: string }) => ({ ...value.attempt, sessionId: value.sessionId })) });
    assert.deepEqual(recovered, original.map((value: Record<string, unknown>) => ({
      attempt: value.attempt, admitted: value.admitted, events: value.events, evidence: value.evidence,
    })));
    assert.deepEqual(recovered.map((value: { evidence: { outcome: { direction: string } }[] }) => value.evidence[0].outcome.direction), ["supports", "refutes"]);
  });
  test("process exits after durable commit before admission: B still re-admits canonical refuting Evidence", () => {
    const attempt = child(storage.payload, { mode: "crash" }, 23);
    const recovered = child(storage.payload, { mode: "reopen", attempts: [attempt] });
    assert.deepEqual(recovered[0].attempt, attempt);
    assert.equal(recovered[0].evidence[0].outcome.direction, "refutes");
  });
  for (const [name, patch, expected] of [
    ["corrupt", { integrity: "broken" }, "history_corrupt"],
    ["unsupported", { formatVersion: 2 }, "unsupported_history"],
    ["profile mismatch", { profileId: randomUUID() }, "history_corrupt"],
    ["epoch mismatch", { epochId: randomUUID() }, "history_corrupt"],
  ] as const) test(`${name} startup fails closed; no empty initialization or owner fallback`, () => {
    runtime(); closeDiagnosticRuntime();
    if (name === "corrupt") writeFileSync(storage.file, "{broken"); else mutate(value => Object.assign(value, patch));
    const before = readFileSync(storage.file, "utf8"); const active = runtime();
    assert.equal(active.readiness().kind, expected);
    assert.equal(active.issue().kind, "unavailable");
    assert.equal(readFileSync(storage.file, "utf8"), before);
    assert.equal(admitVerifiedAssessment(locator({ id: "unknown" })).kind, "rejected");
  });
  test("unknown/corrupt durable capture prevents whole snapshot admission", async () => {
    runtime(); const result = (await commitDiagnosticSubmission(issue()));
    assert.equal(result.kind, "submitted");
    if (result.kind !== "submitted") throw new Error("submit failed");
    closeDiagnosticRuntime();
    mutate(value => { (value.captures as Record<string, unknown>[])[0].specRevision = "unknown-revision"; });
    const active = runtime();
    assert.equal(active.readiness().kind, "history_corrupt");
    assert.equal(active.resolveAttempt(result.attempt.id), undefined);
    assert.equal(admitVerifiedAssessment(locator(result.attempt)).kind, "rejected");
  });
  test("missing initialized file is incomplete and never initialized empty", () => {
    runtime(); closeDiagnosticRuntime(); unlinkSync(storage.file);
    const active = runtime(); assert.equal(active.readiness().kind, "history_incomplete");
    assert.equal(active.issue().kind, "unavailable"); assert.equal(existsSync(storage.file), false);
  });
  test("unavailable managed drive has no root/default/temp fallback", () => {
    runtime(); closeDiagnosticRuntime();
    renameSync(storage.config.managedRoot, storage.config.managedRoot + "-offline");
    const active = runtime(); assert.equal(active.readiness().kind, "storage_unavailable");
    assert.equal(active.issue().kind, "unavailable"); assert.equal(existsSync(storage.config.managedRoot), false);
  });
  test("initialization failure leaves unavailable reservation and next startup incomplete", () => {
    const active = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
      ...diagnosticHistoryIO, publishNew() { throw new Error("initialization failed"); },
    }));
    assert.equal(active.readiness().kind, "initialization_failed"); assert.equal(active.issue().kind, "unavailable");
    closeDiagnosticRuntime(); assert.equal(runtime().readiness().kind, "history_incomplete");
  });
  test("HTTP rejects root/profile/epoch/owner overrides before capture", async () => {
    const active = runtime(); const input = issue(active);
    for (const field of ["managedRoot", "managedFilesRoot", "profileId", "epochId", "sourceOwnerId", "occurredAt", "assistance", "canonicalAnswer", "verified"]) {
      const response = await POST(new Request("http://localhost:4320/api/diagnostic/submit", { method: "POST",
        headers: { origin: "http://localhost:4320", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...input, [field]: "caller" }) }));
      assert.equal(response.status, 400);
    }
    assert.deepEqual(record().captures, []);
  });
});
