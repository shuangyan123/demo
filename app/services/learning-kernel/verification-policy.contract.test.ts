import assert from "node:assert/strict";
import test from "node:test";
import type {
  LearnerStateDerivationV1, LearningEventV1, LearningTargetV1, VerificationDecisionV1, VerifiedAssessmentAssistanceV1,
} from "../../types/domains/learning-kernel.ts";
import { adaptVerifiedAssessment } from "./verified-assessment-adapter.ts";
import { adaptReviewAttempt } from "./legacy-event-adapter.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { deriveLearnerTargetStates } from "./derive-learner-state.ts";
import { decideNextVerification } from "./verification-policy.ts";

const asOf = { asOf: "2026-10-05T08:00:00Z" };
const target: LearningTargetV1 = { category: "question", namespace: "verified_assessment_question", id: "item" };
const verify = { kind: "verify", target: "independence", reason: "assistance_present" } satisfies VerificationDecisionV1;
const noTarget = { kind: "none", reason: "no_authorized_verification_target" } satisfies VerificationDecisionV1;
function events(id: string, correct = true, assistance: VerifiedAssessmentAssistanceV1 = "none",
  at = "2026-10-04T08:00:00Z", specId = "item"): LearningEventV1[] {
  return adaptVerifiedAssessment({ schemaVersion: 1, id: specId, optionCount: 2, verifiedCorrectOptionIndex: 1 },
    { schemaVersion: 1, id, specId, selectedOptionIndex: correct ? 1 : 0, occurredAt: at, assistance }).events;
}
function derive(input: LearningEventV1[]): LearnerStateDerivationV1 {
  return deriveLearnerTargetStates(input, deriveEvidence(input).evidence, asOf);
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
}

for (const assistance of ["hint", "guided", "solution"] as const) {
  test(`current qualified ${assistance}-only support identifies independence without progressing through understanding`, () => {
    const state = derive(events("assisted", true, assistance));
    assert.equal(state.states[0].understanding, "unknown");
    assert.equal(state.states[0].independence, "unknown");
    assert.deepEqual(decideNextVerification(state, target), verify);
  });
}

test("independent current support has no authorized next target; untested is not a retention/transfer instruction", () => {
  for (const input of [events("clean"), [...events("clean"), ...events("assisted", true, "hint")],
    [...events("old-wrong", false, "none", "2026-10-01T08:00:00Z"), ...events("clean")]]) {
    const state = derive(input);
    assert.equal(state.states[0].understanding, "emerging");
    assert.equal(state.states[0].independence, "independent");
    assert.equal(state.states[0].retention, "untested");
    assert.equal(state.states[0].transfer, "untested");
    assert.deepEqual(decideNextVerification(state, target), noTarget);
  }
});

test("latest qualified state changes the decision in both directions, without historical positive lock-in", () => {
  const oldClean = events("old-clean", true, "none", "2026-10-01T08:00:00Z");
  const assisted = events("assisted", true, "hint", "2026-10-02T08:00:00Z");
  const wrong = events("wrong", false, "none", "2026-10-03T08:00:00Z");
  const recovery = events("recovery");
  assert.deepEqual(decideNextVerification(derive(oldClean), target), noTarget);
  assert.deepEqual(decideNextVerification(derive([...oldClean, ...assisted]), target), verify);
  assert.deepEqual(decideNextVerification(derive([...oldClean, ...assisted, ...wrong]), target),
    { kind: "none", reason: "ambiguous_verification_target" });
  assert.deepEqual(decideNextVerification(derive([...oldClean, ...assisted, ...wrong, ...recovery]), target), noTarget);
});

for (const assistance of ["none", "hint", "guided", "solution"] as const) {
  test(`qualified refutation with ${assistance} cannot distinguish understanding from independence`, () => {
    assert.deepEqual(decideNextVerification(derive(events("wrong", false, assistance)), target),
      { kind: "none", reason: "ambiguous_verification_target" });
  });
}

test("same actual instant conflict fails closed, including equivalent offsets", () => {
  const input = [...events("support", true, "hint", "2026-10-04T08:00:00Z"),
    ...events("refute", false, "none", "2026-10-04T16:00:00+08:00")];
  assert.deepEqual(decideNextVerification(derive(input), target), { kind: "none", reason: "ambiguous_evidence_qualification" });
  assert.deepEqual(decideNextVerification(derive(input.toReversed()), target), decideNextVerification(derive(input), target));
});

test("no qualified direct evidence, including legacy self-report, cannot invent a target", () => {
  const input = adaptReviewAttempt({ id: "review", mistakeId: "mistake", result: "correct", confidence: 5,
    reviewedAt: "2026-10-04" }).events;
  assert.deepEqual(decideNextVerification(derive(input), input[0].target), { kind: "none", reason: "no_qualified_direct_evidence" });
  assert.deepEqual(decideNextVerification(derive([]), target), { kind: "none", reason: "incomplete_effective_state" });
});

test("target identity is exact, isolated and never chosen by ordering or another target's state", () => {
  const state = derive([...events("first", true, "hint"), ...events("second", true, "none", undefined, "other")]);
  assert.deepEqual(decideNextVerification(state, target), verify);
  assert.deepEqual(decideNextVerification(state, { ...target, id: "other" }), noTarget);
  for (const requested of [{ ...target, namespace: "other" }, { ...target, category: "skill" as const }, { ...target, id: "missing" }])
    assert.deepEqual(decideNextVerification(state, requested), { kind: "none", reason: "incomplete_effective_state" });
  assert.deepEqual(decideNextVerification({ ...state, states: [state.states[0], state.states[0]] }, target),
    { kind: "none", reason: "ambiguous_evidence_qualification" });
});

test("complete derivation diagnostics cannot be hidden by selecting a seemingly valid target", () => {
  const valid = derive(events("valid", true, "hint"));
  const broken = derive([...events("same-attempt"), ...events("same-attempt", false)]);
  assert.ok(broken.diagnostics.some((item) => item.code === "conflicting_source_identity"));
  assert.deepEqual(decideNextVerification(broken, target), { kind: "none", reason: "ambiguous_evidence_qualification" });
  const input = events("valid", true, "hint");
  const incomplete = deriveLearnerTargetStates(input, [], asOf);
  assert.equal(incomplete.diagnostics[0].code, "incomplete_evidence_scope");
  assert.deepEqual(decideNextVerification(incomplete, target), { kind: "none", reason: "ambiguous_evidence_qualification" });
  assert.deepEqual(decideNextVerification({ ...valid, diagnostics: broken.diagnostics }, target),
    { kind: "none", reason: "ambiguous_evidence_qualification" });
});

test("future measurements stay excluded; their diagnostic does not invalidate a current effective set", () => {
  const input = [...events("current", true, "hint"), ...events("future", true, "none", "2026-10-06T08:00:00Z")];
  const state = derive(input);
  assert.deepEqual(state.diagnostics.map((item) => item.code), ["evidence_after_as_of"]);
  assert.deepEqual(decideNextVerification(state, target), verify);
});

test("incomplete effective summaries fail closed without throwing or selecting a default target", () => {
  const valid = derive(events("valid", true, "hint"));
  const mutations: Array<(state: LearnerStateDerivationV1) => void> = [
    (state) => { Reflect.deleteProperty(state, "diagnostics"); },
    (state) => { Reflect.deleteProperty(state.states[0], "promotionEligibility"); },
    (state) => { Reflect.deleteProperty(state.states[0].promotionEligibility, "retention"); },
    (state) => { Reflect.deleteProperty(state.states[0].promotionEligibility.understanding, "effectiveEvidenceIds"); },
    (state) => { Reflect.deleteProperty(state.states[0].promotionEligibility.independence, "blockers"); },
    (state) => { Reflect.deleteProperty(state.states[0], "evidenceReferences"); },
    (state) => { Reflect.deleteProperty(state.states[0], "timeContext"); },
    (state) => { Reflect.deleteProperty(state.states[0], "understanding"); },
    (state) => { state.states[0].lastVerifiedAt = null; },
    (state) => { state.states[0].promotionEligibility.understanding.effectiveEvidenceIds = Array<string>(1); },
    (state) => { state.states[0].promotionEligibility.understanding.effectiveEvidenceIds.push(
      state.states[0].promotionEligibility.understanding.effectiveEvidenceIds[0]); },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(valid);
    mutate(state);
    assert.deepEqual(decideNextVerification(state, target), { kind: "none", reason: "incomplete_effective_state" });
  }
});

test("inconsistent effective qualification, references or status cannot authorize a decision", () => {
  const valid = derive(events("valid", true, "hint"));
  const mutations: Array<(state: LearnerStateDerivationV1) => void> = [
    (state) => { state.states[0].promotionEligibility.understanding.effectiveRefutingEvidenceIds =
      [...state.states[0].promotionEligibility.understanding.effectiveSupportingEvidenceIds]; },
    (state) => { state.states[0].promotionEligibility.independence.effectiveEvidenceIds = []; },
    (state) => { state.states[0].promotionEligibility.independence.blockers = []; },
    (state) => { state.states[0].promotionEligibility.understanding.status = "eligible"; },
    (state) => { state.states[0].evidenceReferences.understanding = ["unrelated"]; },
    (state) => { state.states[0].understanding = "emerging"; },
    (state) => { state.states[0].evidenceReferences.retention = ["unrelated"]; },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(valid);
    mutate(state);
    assert.deepEqual(decideNextVerification(state, target), { kind: "none", reason: "ambiguous_evidence_qualification" });
  }
});

test("unimplemented dimension states and qualification contexts are explicitly unsupported", () => {
  const valid = derive(events("valid", true, "hint"));
  const mutations: Array<(state: LearnerStateDerivationV1) => void> = [
    (state) => { state.states[0].understanding = "supported"; },
    (state) => { state.states[0].independence = "partial"; },
    (state) => { state.states[0].retention = "at_risk"; },
    (state) => { state.states[0].transfer = "weak"; },
    (state) => { state.states[0].promotionEligibility.retention.status = "eligible"; },
    (state) => { state.states[0].promotionEligibility.transfer.effectiveSupportingEvidenceIds = ["unrelated"]; },
    (state) => { Reflect.set(state.states[0], "policyVersion", "learner-state-policy/future"); },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(valid);
    mutate(state);
    assert.deepEqual(decideNextVerification(state, target), { kind: "none", reason: "unsupported_effective_state" });
  }
});

test("decision bytes are deterministic across repeated calls, reordered summaries and duplicate source measurements", () => {
  const input = [...events("history", true, "none", "2026-10-01T08:00:00Z"),
    ...events("current-a", true, "hint"), ...events("current-b", true, "solution")];
  const state = derive(input);
  const expected = JSON.stringify(decideNextVerification(state, target));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(decideNextVerification(state, target)), expected);
  assert.equal(JSON.stringify(decideNextVerification(derive([...input, ...input].toReversed()), target)), expected);
  for (const eligibility of Object.values(state.states[0].promotionEligibility)) {
    eligibility.effectiveEvidenceIds.reverse();
    eligibility.effectiveSupportingEvidenceIds.reverse();
    eligibility.blockers.reverse();
  }
  assert.equal(JSON.stringify(decideNextVerification(state, target)), expected);
});

test("frozen inputs and complete historical Evidence are preserved; the decision carries only closed domain values", () => {
  const input = [...events("historical-pass", true, "none", "2026-10-01T08:00:00Z"),
    ...events("historical-refute", false, "none", "2026-10-02T08:00:00Z"), ...events("current", true, "hint")];
  const evidence = deriveEvidence(input).evidence;
  const state = deriveLearnerTargetStates(input, evidence, asOf);
  const before = JSON.stringify({ input, evidence, state, target });
  freeze(input); freeze(evidence); freeze(state); freeze(target);
  const decision = decideNextVerification(state, target);
  assert.deepEqual(decision, verify);
  assert.deepEqual(Object.keys(decision), ["kind", "target", "reason"]);
  assert.equal(state.states[0].promotionEligibility.understanding.historicalQualifiedEvidenceIds.length, 2);
  assert.equal(JSON.stringify({ input, evidence, state, target }), before);
  assert.deepEqual(deriveEvidence(input).evidence, evidence);
  assert.deepEqual(decideNextVerification(derive(events("clean")), target), noTarget);
  assert.deepEqual(Object.keys(noTarget), ["kind", "reason"]);
});
