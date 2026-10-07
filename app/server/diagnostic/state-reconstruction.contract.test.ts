import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe, beforeEach, afterEach } from "node:test";
import { diagnosticStorageFixture } from "../../../test-support/diagnostic-storage.ts";
import { composeDiagnosticRuntime, closeDiagnosticRuntime } from "./runtime.ts";
import { commitDiagnosticSubmission } from "./assessment-submission.ts";
import { loadCompleteDiagnosticLearningHistory } from "./learning-history.ts";
import { reconstructDiagnosticLearnerState, reconstructDiagnosticStateWith } from "./state-reconstruction.ts";
import { FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER } from "../../services/first-party-diagnostic/spec-authority.ts";
import { deriveLearnerTargetStates } from "../../services/learning-kernel/derive-learner-state.ts";
import { decideNextVerification } from "../../services/learning-kernel/verification-policy.ts";

const request = { specId: "int-add-2-3", specRevision: "r1", asOf: "2026-10-07T10:00:00.000Z" };
const early = Date.parse("2026-10-07T08:00:00.000Z");
const late = early + 60000;

describe("complete diagnostic history → state → WHAT", () => {
  let storage: ReturnType<typeof diagnosticStorageFixture>;
  beforeEach(() => { closeDiagnosticRuntime(); storage = diagnosticStorageFixture(); });
  afterEach(() => { closeDiagnosticRuntime(); storage.cleanup(); });
  function result(input = request) {
    const value = reconstructDiagnosticLearnerState(input);
    assert.equal(value.kind, "complete");
    if (value.kind !== "complete") throw new Error("expected complete reconstruction");
    assert.deepEqual(value.derivation, deriveLearnerTargetStates(value.events, value.evidence, { asOf: input.asOf }));
    assert.deepEqual(value.decision, decideNextVerification(value.derivation, value.target));
    return value;
  }
  function submit(context: test.TestContext, answers: string[], times: number[]) {
    let instant = early;
    context.mock.method(Date, "now", () => instant);
    let active = composeDiagnosticRuntime(storage.config);
    return answers.map((selectedOptionId, index) => {
      if (index && index % 200 === 0) { closeDiagnosticRuntime(); active = composeDiagnosticRuntime(storage.config); }
      instant = times[index];
      const issued = active.issue();
      if (issued.kind !== "issued") throw new Error("issue failed");
      const value = commitDiagnosticSubmission({ sessionId: issued.sessionId, selectedOptionId });
      if (value.kind !== "submitted") throw new Error(`submit failed: ${JSON.stringify(value)}`);
      return value;
    });
  }
  test("complete-empty is unmeasured with valid WHAT, and scope names only current source epoch", () => {
    composeDiagnosticRuntime(storage.config);
    const value = result();
    assert.deepEqual(value.events, []); assert.deepEqual(value.evidence, []);
    assert.equal(value.measurement, "unmeasured"); assert.equal(value.state, null);
    assert.equal(value.targetCaptureCount, 0);
    assert.deepEqual(value.scope, { completeness: "all_durable_captures_in_source_epoch", sourceOwnerId: "recall-diagnostic",
      profileId: storage.config.profileId, epochId: storage.config.epochId, generation: 0, captureCount: 0 });
    assert.equal(value.decision.kind, "none"); assert.equal(value.decision.reason, "incomplete_effective_state");
  });
  for (const [answer, direction, understanding, independence, reason] of [
    ["five", "supports", "emerging", "independent", "no_authorized_verification_target"],
    ["four", "refutes", "unknown", "unknown", "ambiguous_verification_target"],
  ]) test(`one ${answer}: canonical ${direction} and unchanged policy`, context => {
    const live = submit(context, [answer], [early]); const value = result();
    assert.deepEqual(value.evidence, live[0].evidence);
    assert.equal(value.evidence[0].outcome.direction, direction);
    assert.equal(value.measurement, "measured"); assert.equal(value.state?.understanding, understanding);
    assert.equal(value.state?.independence, independence);
    assert.equal(value.state?.retention, "untested"); assert.equal(value.state?.transfer, "untested");
    assert.equal(value.decision.kind, "none"); assert.equal(value.decision.reason, reason);
    const resolved = FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(request.specId, request.specRevision);
    if (resolved.kind !== "resolved") throw new Error("canonical spec missing");
    assert.deepEqual(value.target, resolved.spec.learningTarget);
  });
  for (const [answers, understanding, independence] of [
    [["four", "five"], "emerging", "independent"], [["five", "four"], "unknown", "unknown"],
  ] as const) test(`${answers.join(" then ")}: all attempts survive; latest becomes effective, earlier historical`, context => {
    const live = submit(context, [...answers], [early, late]); const value = result();
    assert.equal(value.events.length, 2); assert.equal(value.evidence.length, 2); assert.equal(value.scope.captureCount, 2);
    assert.equal(new Set(value.events.map(event => event.id)).size, 2);
    const earlier = live[0].evidence[0].id; const later = live[1].evidence[0].id;
    assert.deepEqual(value.state?.promotionEligibility.understanding.effectiveEvidenceIds, [later]);
    assert.deepEqual(value.state?.promotionEligibility.understanding.historicalQualifiedEvidenceIds, [earlier]);
    assert.equal(value.state?.understanding, understanding); assert.equal(value.state?.independence, independence);
    assert.deepEqual(value.events.map(event => event.occurredAt), live.map(item => item.attempt.occurredAt));
  });
  test("same actual occurrence instant support + refute preserves conflict/fail closed", context => {
    submit(context, ["five", "four"], [early, early]); const value = result();
    assert.equal(value.events.length, 2); assert.equal(value.state?.understanding, "unknown");
    assert.equal(value.state?.independence, "unknown");
    assert.equal(value.state?.promotionEligibility.understanding.effectiveEvidenceIds.length, 2);
    assert.equal(value.decision.kind, "none"); assert.equal(value.decision.reason, "ambiguous_evidence_qualification");
  });
  test("repository order cannot replace occurrence order or dedupe same-spec attempts", context => {
    const live = submit(context, ["five", "four", "five"], [late, early, late + 60000]); const value = result();
    assert.equal(value.events.length, 3);
    assert.deepEqual(value.events.map(event => event.occurredAt), live.map(item => item.attempt.occurredAt));
    assert.deepEqual(value.state?.promotionEligibility.understanding.effectiveEvidenceIds, [live[2].evidence[0].id]);
    assert.equal(value.state?.promotionEligibility.understanding.historicalQualifiedEvidenceIds.length, 2);
  });
  test("future records remain canonical history; Kernel alone handles asOf", context => {
    submit(context, ["four", "five"], [early, late]);
    const value = result({ ...request, asOf: new Date(early + 1000).toISOString() });
    assert.equal(value.events.length, 2); assert.equal(value.evidence.length, 2);
    assert.equal(value.scope.captureCount, 2); assert.equal(value.state?.understanding, "unknown");
    assert.ok(value.derivation.diagnostics.some(item => item.code === "evidence_after_as_of"));
    const before = result({ ...request, asOf: new Date(early - 1).toISOString() });
    assert.equal(before.state, null); assert.equal(before.targetCaptureCount, 2);
  });
  test("all captures retained well beyond former session retention; no latest-100 or latest-per-spec read", context => {
    submit(context, Array.from({ length: 260 }, (_, index) => index % 2 ? "five" : "four"), Array(260).fill(early));
    const value = result(); assert.equal(value.events.length, 260); assert.equal(value.evidence.length, 260);
    assert.equal(value.scope.generation, 260); assert.equal(new Set(value.events.map(event => event.id)).size, 260);
  });
  test("complete source containing only another target is distinguishable from failure (internal catalog fixture only)", context => {
    submit(context, ["five"], [early]);
    const resolved = FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(request.specId, request.specRevision);
    if (resolved.kind !== "resolved") throw new Error("canonical spec missing");
    // 专用 resolver fixture 模拟未来已批准 catalog 的另一个 exact target；不会注册/扩展 production spec。
    const otherSpecId = "test-only-other-spec";
    const value = reconstructDiagnosticStateWith({ ...request, specId: otherSpecId }, { load: loadCompleteDiagnosticLearningHistory,
      resolveSpec: (id, revision) => id === otherSpecId && revision === "r1"
        ? { ...resolved, spec: { ...resolved.spec, id: otherSpecId, learningTarget: { ...resolved.spec.learningTarget, id: "test-only-other-canonical-target" } } }
        : FIRST_PARTY_DIAGNOSTIC_SPEC_OWNER.resolveSpec(id, revision),
      derive: deriveLearnerTargetStates, decide: decideNextVerification });
    assert.equal(value.kind, "complete"); if (value.kind !== "complete") throw new Error("expected complete target absence");
    assert.equal(value.scope.captureCount, 1); assert.equal(value.targetCaptureCount, 0);
    assert.equal(value.state, null); assert.equal(value.measurement, "unmeasured");
    assert.deepEqual(value.events, []); assert.equal(value.decision.reason, "incomplete_effective_state");
  });
  test("read reconstruction never initializes/repairs or persists derived data", context => {
    submit(context, ["five", "four"], [early, late]);
    const before = readFileSync(storage.file, "utf8");
    for (let i = 0; i < 3; i++) result();
    assert.equal(readFileSync(storage.file, "utf8"), before);
    assert.deepEqual(Object.keys(JSON.parse(before)).toSorted(), ["formatVersion", "profileId", "epochId", "generation", "captures", "integrity"].toSorted());
    assert.doesNotMatch(before, /learningTarget|sourceEventIds|sourceEvidenceIds|promotionEligibility|verifiedCorrectOption|decision/);
  });
  test("invalid caller target/history/root/verified/dependency and invalid asOf cannot obtain state", () => {
    composeDiagnosticRuntime(storage.config);
    for (const field of ["target", "targetId", "history", "events", "evidence", "state", "verified", "managedRoot", "profileId", "epochId", "owner", "dependencies"]) {
      assert.deepEqual(reconstructDiagnosticLearnerState({ ...request, [field]: "caller" }), { kind: "authority_failure", code: "invalid_request" });
    }
    assert.deepEqual(reconstructDiagnosticLearnerState({ ...request, get asOf() { throw new Error("getter must not run"); } }), { kind: "authority_failure", code: "invalid_request" });
    assert.deepEqual(reconstructDiagnosticLearnerState({ ...request, asOf: "invalid" }), { kind: "authority_failure", code: "state_derivation_failure" });
    assert.deepEqual(reconstructDiagnosticLearnerState({ ...request, specRevision: "missing-revision" }), { kind: "authority_failure", code: "spec_resolution_failure" });
  });
});
