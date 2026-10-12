import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import test, { beforeEach, afterEach, describe } from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { composeDiagnosticRuntime, closeDiagnosticRuntime } from "./runtime.ts";
import { commitDiagnosticSubmission } from "./assessment-submission.ts";
import { reconstructDiagnosticLearnerState } from "./state-reconstruction.ts";
import type { DiagnosticReconstructionFailure } from "./reconstruction-types.ts";
import { loadDiagnosticResumeView, projectDiagnosticResumeView } from "./resume-view.ts";

const failures = [
  { kind: "unavailable", code: "storage_config_unavailable" }, { kind: "unavailable", code: "storage_unavailable" },
  { kind: "incomplete", code: "history_uninitialized" }, { kind: "incomplete", code: "history_incomplete" },
  { kind: "corrupt", code: "history_corrupt" }, { kind: "corrupt", code: "profile_mismatch" }, { kind: "corrupt", code: "epoch_mismatch" },
  { kind: "unsupported", code: "history_unsupported" }, { kind: "authority_failure", code: "invalid_request" },
  { kind: "authority_failure", code: "spec_resolution_failure" }, { kind: "authority_failure", code: "admission_failure" },
  { kind: "authority_failure", code: "event_derivation_failure" }, { kind: "authority_failure", code: "evidence_derivation_failure" },
  { kind: "authority_failure", code: "state_derivation_failure" },
] as const satisfies readonly DiagnosticReconstructionFailure[];
for (const failure of failures) test(`resume preserves ${failure.kind}/${failure.code} without empty success or raw diagnostics`, () => {
  const privateFailure = { ...failure, privateBody: "RAW_SECRET_SENTINEL" };
  const projected = projectDiagnosticResumeView(privateFailure, "2026-10-08T00:00:00.000Z");
  assert.deepEqual(projected, failure);
  assert.doesNotMatch(JSON.stringify(projected), /RAW_SECRET|"state":|"attempts":|evidenceCount|complete-empty/);
});

describe("source-backed resume projection", () => {
  let storage: ReturnType<typeof diagnosticStorageFixture>;
  beforeEach(() => { closeDiagnosticRuntime(); storage = diagnosticStorageFixture(); });
  afterEach(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  function complete() {
    const result = reconstructDiagnosticLearnerState({ specId: "int-add-2-3", specRevision: "r1", asOf: new Date().toISOString() });
    assert.equal(result.kind, "complete");
    if (result.kind !== "complete") throw new Error("expected complete history");
    return result;
  }
  async function submit(answer: string) {
    const runtime = composeDiagnosticRuntime(storage.config);
    const issued = runtime.issue(); assert.equal(issued.kind, "issued");
    if (issued.kind !== "issued") throw new Error("expected issued diagnostic");
    const result = await commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId: answer });
    assert.equal(result.kind, "submitted");
    if (result.kind !== "submitted") throw new Error("expected submitted diagnostic");
    return result;
  }
  test("without startup the facade stays unavailable and does not initialize the domain", () => {
    assert.deepEqual(loadDiagnosticResumeView(), { kind: "unavailable", code: "storage_config_unavailable" });
    assert.equal(existsSync(storage.file), false);
  });
  test("complete-empty is source-scoped; repeated reads do not write, create attempts or replace state", () => {
    composeDiagnosticRuntime(storage.config);
    const bytes = readFileSync(storage.file, "utf8");
    for (let count = 0; count < 3; count++) {
      const view = loadDiagnosticResumeView(); assert.equal(view.kind, "complete");
      if (view.kind !== "complete") throw new Error("expected complete resume");
      assert.equal(view.history, "complete-empty"); assert.equal(view.attemptCount, 0); assert.equal(view.evidenceCount, 0);
      assert.equal(view.measurement, "unmeasured"); assert.equal(view.state, null); assert.deepEqual(view.attempts, []);
      assert.deepEqual(view.decision, { kind: "none", reason: "incomplete_effective_state" });
      assert.equal(view.scope.completeness, "all_durable_captures_in_source_epoch");
    }
    assert.equal(readFileSync(storage.file, "utf8"), bytes);
  });
  test("a genuine confirmed attempt preserves UUID, time, provenance summary, state and exact WHAT", async () => {
    const submitted = await submit("five");
    const bytes = readFileSync(storage.file, "utf8");
    const raw = complete(); const view = loadDiagnosticResumeView();
    assert.equal(view.kind, "complete"); if (view.kind !== "complete") throw new Error("expected complete resume");
    assert.equal(view.history, "resumed"); assert.equal(view.attemptCount, 1); assert.equal(view.evidenceCount, 1);
    assert.deepEqual(view.attempts, [{ attemptId: submitted.attempt.id, occurredAt: submitted.attempt.occurredAt,
      direction: "supports", assistance: "none",
      provenance: { modelAuthored: false, keySource: "verified_assessment", scoringMethod: "verified_key_comparison" } }]);
    assert.equal(view.state?.understanding, "emerging"); assert.equal(view.state?.independence, "independent");
    assert.equal(view.state?.retention, "untested"); assert.equal(view.state?.transfer, "untested");
    assert.equal(view.state?.nextVerificationAt, null); assert.deepEqual(view.decision, raw.decision);
    assert.equal(readFileSync(storage.file, "utf8"), bytes);
    assert.doesNotMatch(JSON.stringify(view), /five|four|selectedOption|verifiedCorrect|sourceEventIds|sourceRecordRefs|measurementGroupId|verified_assessment_question|profileId|epochId/);
  });
  test("whitelist projection strips raw payloads, answer-bound IDs and added authority metadata", async () => {
    await submit("four"); const raw = structuredClone(complete());
    Object.assign(raw, { privateBody: "RAW_SECRET_SENTINEL" });
    Object.assign(raw.scope, { privateBody: "RAW_SECRET_SENTINEL" });
    Object.assign(raw.events[0].payload, { privateBody: "RAW_SECRET_SENTINEL" });
    Object.assign(raw.decision, { privateBody: "RAW_SECRET_SENTINEL" });
    const projected = projectDiagnosticResumeView(raw, new Date().toISOString());
    assert.equal(projected.kind, "complete");
    const serialized = JSON.stringify(projected);
    assert.doesNotMatch(serialized, /RAW_SECRET_SENTINEL|verifiedCorrect|selectedOption|"target":|sourceRecordRefs|"payload":/);
    assert.ok(!serialized.includes(raw.events[0].id)); assert.ok(!serialized.includes(raw.target.id));
    assert.ok(!serialized.includes(raw.evidence[0].id));
  });
  test("unsafe attempt display identity fails closed rather than serializing answer-bound text", async () => {
    await submit("five"); const raw = complete(); raw.events[0].attemptId = "answer-bound-five";
    assert.deepEqual(projectDiagnosticResumeView(raw, new Date().toISOString()), { kind: "authority_failure", code: "evidence_derivation_failure" });
  });
  test("future captures remain visible facts without being promoted into a current measured state", async () => {
    const submitted = await submit("five");
    const asOf = new Date(Date.parse(submitted.attempt.occurredAt) - 1000).toISOString();
    const raw = reconstructDiagnosticLearnerState({ specId: "int-add-2-3", specRevision: "r1", asOf });
    const view = projectDiagnosticResumeView(raw, asOf);
    assert.equal(view.kind, "complete"); if (view.kind !== "complete") throw new Error("expected complete resume");
    assert.equal(view.history, "resumed"); assert.equal(view.attemptCount, 1);
    assert.equal(view.measurement, "unmeasured"); assert.equal(view.state, null);
    assert.deepEqual(view.decision, { kind: "none", reason: "incomplete_effective_state" });
  });
  test("missing initialized record and corrupt bytes never become complete-empty or mutate storage", () => {
    composeDiagnosticRuntime(storage.config); unlinkSync(storage.file);
    assert.deepEqual(loadDiagnosticResumeView(), { kind: "incomplete", code: "history_incomplete" });
    assert.equal(existsSync(storage.file), false);
    writeFileSync(storage.file, "invalid snapshot");
    assert.deepEqual(loadDiagnosticResumeView(), { kind: "corrupt", code: "history_corrupt" });
    assert.equal(readFileSync(storage.file, "utf8"), "invalid snapshot");
  });
});
