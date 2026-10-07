import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { composeDiagnosticRuntime, closeDiagnosticRuntime } from "./runtime.ts";
import { commitDiagnosticSubmission, continueDiagnosticSubmission } from "./assessment-submission.ts";
import { createDiagnosticHistoryRepository } from "./history/repository-core.ts";
import { diagnosticHistoryIO, diagnosticReplacementObservation, type DiagnosticHistoryIO } from "./history/io.ts";
import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { adaptVerifiedAssessment } from "../../services/learning-kernel/verified-assessment-adapter.ts";
import { reconstructDiagnosticLearnerState } from "./state-reconstruction.ts";

const failure = () => Object.assign(Error("native replacement candidate"), { code: "EPERM", syscall: "rename", errno: -4048 });
function fixture(context: test.TestContext, override: Partial<DiagnosticHistoryIO>) {
  closeDiagnosticRuntime();
  const storage = diagnosticStorageFixture();
  const runtime = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config,
    { ...diagnosticHistoryIO, replacementPlatform: "win32", waitForReplacementRetry() {}, ...override }));
  context.after(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  const issued = runtime.issue();
  if (issued.kind !== "issued") throw Error("issue failed");
  return { ...storage, runtime, input: { sessionId: issued.sessionId, selectedOptionId: "five" },
    disk: () => JSON.parse(readFileSync(storage.file, "utf8")) };
}

for (const failures of [1, 2]) test(`F3: ${failures} EPERM then durable owner/admission/Event/Evidence/reveal with one capture`, context => {
  context.mock.method(Date, "now", () => Date.parse("2026-10-07T08:00:00.000Z"));
  let calls = 0; let capturedId = "";
  const state = fixture(context, { publishReplacement(from, to) {
    calls++;
    const captured = JSON.parse(readFileSync(from, "utf8")).captures[0];
    capturedId ||= captured.id;
    assert.equal(captured.id, capturedId); assert.equal(captured.occurredAt, "2026-10-07T08:00:00.000Z");
    assert.equal(state.runtime.resolveAttempt(capturedId), undefined); assert.equal(state.runtime.read(state.input.sessionId).kind, "pending");
    if (calls <= failures) throw failure();
    diagnosticHistoryIO.publishReplacement(from, to);
  } });
  const result = continueDiagnosticSubmission(state.input, state.runtime, request => {
    assert.equal(state.disk().generation, 1); assert.equal(state.disk().captures.length, 1);
    assert.equal(state.runtime.read(state.input.sessionId).kind, "pending");
    assert.equal(state.runtime.resolveAttempt(capturedId)?.id, capturedId);
    return admitVerifiedAssessment(request);
  });
  assert.equal(result.kind, "submitted");
  if (result.kind !== "submitted") throw Error("submit failed");
  assert.equal(calls, failures + 1); assert.deepEqual(state.disk().captures, [result.attempt]);
  assert.equal(result.attempt.id, capturedId); assert.equal(result.attempt.assistance, "none");
  const events = adaptVerifiedAssessment(result.admitted.spec, result.admitted.attempt).events;
  assert.equal(events.length, 1); assert.equal(result.evidence.length, 1);
  assert.equal(state.runtime.read(state.input.sessionId).kind, "revealed");
  closeDiagnosticRuntime(); composeDiagnosticRuntime(state.config);
  const reloaded = reconstructDiagnosticLearnerState({ specId: "int-add-2-3", specRevision: "r1", asOf: "2026-10-07T10:00:00.000Z" });
  assert.equal(reloaded.kind, "complete");
  if (reloaded.kind !== "complete") throw Error("reconstruction failed");
  assert.deepEqual(reloaded.events, events); assert.deepEqual(reloaded.evidence, result.evidence);
});

test("F3: exhausted rename budget seals attempt without owner/admission/Evidence/reveal; manual continuation reuses it", context => {
  let failing = true; let calls = 0;
  const state = fixture(context, { publishReplacement(from, to) { calls++; if (failing) throw failure(); diagnosticHistoryIO.publishReplacement(from, to); } });
  let admissions = 0;
  const result = continueDiagnosticSubmission(state.input, state.runtime, request => { admissions++; return admitVerifiedAssessment(request); });
  assert.equal(result.kind, "captured_not_durable");
  if (result.kind !== "captured_not_durable") throw Error("expected sealed capture");
  assert.equal(calls, 4); assert.equal(admissions, 0); assert.equal(diagnosticReplacementObservation(result.failure)?.terminalReason, "retry_exhausted");
  assert.equal(state.disk().generation, 0); assert.deepEqual(state.disk().captures, []);
  assert.equal(state.runtime.resolveAttempt(result.attempt.id), undefined);
  assert.equal(admitVerifiedAssessment({ sourceOwnerId: result.attempt.sourceOwnerId, specId: result.attempt.specId,
    specRevision: result.attempt.specRevision, attemptId: result.attempt.id }).kind, "rejected");
  assert.equal(state.runtime.read(state.input.sessionId).kind, "pending"); assert.equal("evidence" in result, false);
  assert.deepEqual(commitDiagnosticSubmission({ ...state.input, selectedOptionId: "four" }), { kind: "rejected", reason: "sealed_response_conflict" });
  const later = Date.now() + 1000;
  context.mock.method(Date, "now", () => later);
  failing = false;
  const continued = commitDiagnosticSubmission(state.input);
  assert.equal(continued.kind, "submitted");
  if (continued.kind !== "submitted") throw Error("continuation failed");
  assert.equal(continued.attempt, result.attempt); assert.equal(calls, 5);
  assert.deepEqual(state.disk().captures, [result.attempt]); assert.equal(state.disk().generation, 1);
  assert.equal(state.runtime.read(state.input.sessionId).kind, "revealed"); assert.equal(continued.evidence.length, 1);
});

test("F3: successful rename retry with failed final confirmation permits no owner or reveal until manual confirmation", () => {
  closeDiagnosticRuntime();
  const storage = diagnosticStorageFixture(); let calls = 0; let published = false;
  try {
    const runtime = composeDiagnosticRuntime(storage.config, config => createDiagnosticHistoryRepository(config, {
      ...diagnosticHistoryIO, replacementPlatform: "win32", waitForReplacementRetry() {},
      publishReplacement(from, to) { if (++calls === 1) throw failure(); diagnosticHistoryIO.publishReplacement(from, to); published = true; },
      read(file, observe) { return published ? { kind: "unavailable", code: "storage_unavailable", reason: "snapshot_read_failed" } : diagnosticHistoryIO.read(file, observe); },
    }));
    const issued = runtime.issue(); if (issued.kind !== "issued") throw Error("issue failed");
    const input = { sessionId: issued.sessionId, selectedOptionId: "five" };
    const result = commitDiagnosticSubmission(input);
    assert.equal(result.kind, "captured_not_durable"); if (result.kind !== "captured_not_durable") throw Error("expected failure");
    assert.equal(calls, 2); assert.equal(runtime.resolveAttempt(result.attempt.id), undefined);
    assert.equal(runtime.read(input.sessionId).kind, "pending"); assert.equal("evidence" in result, false);
    published = false;
    const continued = commitDiagnosticSubmission(input);
    assert.equal(continued.kind, "submitted"); if (continued.kind !== "submitted") throw Error("continuation failed");
    assert.equal(continued.attempt, result.attempt); assert.equal(calls, 2, "existing NEW is confirmed without another publication");
    assert.equal(JSON.parse(readFileSync(storage.file, "utf8")).generation, 1);
  } finally { closeDiagnosticRuntime(); storage.cleanup(); }
});
