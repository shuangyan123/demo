import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceRecordV1 } from "../../types/domains/learning-kernel.ts";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { adaptReviewAttempt, adaptInterviewEvaluation } from "./legacy-event-adapter.ts";
import { evaluateLearnerStatePromotionEligibility, LEARNER_STATE_POLICY_VERSION } from "./learner-state-policy.ts";
import { compareLearningEventText } from "./learning-event.ts";

const instant = "2026-10-02T08:00:00Z";
const sentinel = "PRIVATE-POLICY-CONTENT-MUST-NOT-LEAK";
function reviewEvidence(): EvidenceRecordV1[] {
  return deriveEvidence(adaptReviewAttempt({ id: "review", mistakeId: "target", result: "correct",
    confidence: 4, reviewedAt: "2026-10-02" }).events).evidence;
}
function rubricEvidence(): EvidenceRecordV1[] {
  const session: InterviewSession = { id: "session", questionId: "question", type: "structured", title: sentinel,
    questionPrompt: sentinel, questionMaterial: sentinel, transcriptText: sentinel,
    status: "evaluated", stage: "evaluated", startedAt: instant, completedAt: instant,
    totalDurationSec: 120, createdAt: instant, updatedAt: instant };
  const evaluation: InterviewEvaluation = { id: "evaluation", sessionId: "session", type: "structured", totalScore: 100,
    dimensions: [{ name: "dimension-1", score: 20, maxScore: 20, comment: sentinel },
      { name: "dimension-2", score: 20, maxScore: 20, comment: sentinel }],
    strengths: [sentinel], problems: [sentinel], suggestions: [sentinel], evidence: [sentinel], createdAt: instant, updatedAt: instant };
  return deriveEvidence(adaptInterviewEvaluation(evaluation, session).events).evidence;
}

test("V1 is completed before runtime adoption; blocked explanations are separate from dimension values", () => {
  assert.equal(LEARNER_STATE_POLICY_VERSION, "learner-state-policy/v1");
  const policy = evaluateLearnerStatePromotionEligibility(reviewEvidence());
  assert.deepEqual(Object.keys(policy), ["understanding", "independence", "retention", "transfer"]);
  assert.deepEqual(policy.understanding.blockers,
    ["assistance_unknown", "no_independent_grader", "no_qualified_direct_evidence", "self_report_only"]);
  assert.deepEqual(policy.independence.blockers, policy.understanding.blockers);
  assert.deepEqual(policy.retention.blockers,
    [...policy.understanding.blockers, "missing_delayed_verification"].toSorted(compareLearningEventText));
  assert.deepEqual(policy.transfer.blockers,
    [...policy.understanding.blockers, "missing_transfer_context"].toSorted(compareLearningEventText));
  for (const eligibility of Object.values(policy)) {
    assert.equal(eligibility.status, "blocked");
    assert.deepEqual(eligibility.eligibleEvidenceIds, []);
    assert.equal(eligibility.candidateEvidenceIds.length, 1);
    assert.equal(eligibility.candidateMeasurementGroupIds.length, 1);
  }
});

test("empty or strong completion-only scope has no candidate learning measurements", () => {
  const evidence = [...reviewEvidence(), ...rubricEvidence()].filter((item) => item.claim === "completion");
  assert.ok(evidence.every((item) => item.strength === "strong"));
  assert.deepEqual(evaluateLearnerStatePromotionEligibility(evidence), evaluateLearnerStatePromotionEligibility([]));
  for (const eligibility of Object.values(evaluateLearnerStatePromotionEligibility(evidence))) {
    assert.equal(eligibility.status, "blocked");
    assert.deepEqual(eligibility.candidateEvidenceIds, []);
    assert.deepEqual(eligibility.candidateMeasurementGroupIds, []);
    assert.deepEqual(eligibility.eligibleEvidenceIds, []);
  }
});

test("overall + rubric slices share one measurement; completion and duplicates cannot multiply authority", () => {
  const evidence = rubricEvidence();
  const learning = evidence.filter((item) => item.claim === "performance");
  assert.equal(learning.length, 3);
  const policy = evaluateLearnerStatePromotionEligibility(evidence);
  assert.deepEqual(policy, evaluateLearnerStatePromotionEligibility(learning));
  assert.deepEqual(policy, evaluateLearnerStatePromotionEligibility([...evidence, ...structuredClone(evidence)].reverse()));
  for (const eligibility of Object.values(policy)) {
    assert.deepEqual(eligibility.candidateEvidenceIds, learning.map((item) => item.id));
    assert.deepEqual(eligibility.candidateMeasurementGroupIds, [learning[0].measurementGroupId]);
    assert.ok(eligibility.blockers.includes("model_assessment_only"));
    assert.ok(eligibility.blockers.includes("current_projection"));
    assert.ok(eligibility.blockers.includes("history_incomplete"));
    assert.equal(eligibility.status, "blocked");
    assert.deepEqual(eligibility.eligibleEvidenceIds, []);
  }
});

test("shape alone cannot authorize human assessment, no assistance, strong strength or missing grader limitations", () => {
  const item = reviewEvidence().find((item) => item.claim === "correctness")!;
  for (const patch of [{ evidenceClass: "human_assessment" }, { assistance: "none" }, { strength: "strong" },
    { provenance: { ...item.provenance, limitations: [] } },
    { evidenceClass: "human_assessment", assistance: "none", strength: "strong",
      provenance: { ...item.provenance, modelAuthored: false, limitations: [] } }]) {
    // 恶意输入仅检验 policy 没有 shape-based eligible 捷径；派生器另有完整 canonical integrity 检验。
    const forged = { ...item, ...patch } as EvidenceRecordV1;
    for (const eligibility of Object.values(evaluateLearnerStatePromotionEligibility([forged]))) {
      assert.equal(eligibility.status, "blocked");
      assert.deepEqual(eligibility.eligibleEvidenceIds, []);
      assert.ok(eligibility.blockers.includes("no_qualified_direct_evidence"));
    }
  }
});

test("blockers project only versioned codes; private provenance, outcomes and extra fields never enter policy output", () => {
  const evidence = reviewEvidence().map((item) => ({ ...item, privateProse: sentinel,
    outcome: { ...item.outcome, answer: sentinel }, provenance: { ...item.provenance, providerResponse: sentinel,
      limitations: [...item.provenance.limitations, sentinel] } } as unknown as EvidenceRecordV1));
  const policy = evaluateLearnerStatePromotionEligibility(evidence);
  assert.equal(JSON.stringify(policy).includes(sentinel), false);
  assert.deepEqual(policy, evaluateLearnerStatePromotionEligibility(reviewEvidence()));
});

test("policy is immutable, byte deterministic and reads no clock, random or locale", (context) => {
  const evidence = [...reviewEvidence(), ...rubricEvidence()];
  const before = structuredClone(evidence);
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
  };
  freeze(evidence);
  const expected = evaluateLearnerStatePromotionEligibility(evidence);
  const fail = () => { throw new Error("clock/random/locale forbidden"); };
  context.mock.method(Date, "now", fail);
  context.mock.method(Math, "random", fail);
  context.mock.method(globalThis.crypto, "randomUUID", fail);
  context.mock.method(String.prototype, "localeCompare", fail);
  context.mock.method(globalThis, "Date", new Proxy(Date, {
    construct(target, args) { if (args.length === 0) fail(); return Reflect.construct(target, args); },
    apply() { return fail(); },
  }));
  const actual = evaluateLearnerStatePromotionEligibility([...evidence].reverse());
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.deepEqual(evidence, before);
  actual.understanding.candidateEvidenceIds.push("output-mutation");
  actual.understanding.candidateMeasurementGroupIds.push("output-mutation");
  actual.understanding.blockers.length = 0;
  assert.deepEqual(actual.independence, expected.independence);
  assert.deepEqual(evidence, before);
});
