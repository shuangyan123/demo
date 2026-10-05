import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import type { TutoringTurn, TutoringPlan } from "../../types/domains/tutoring.ts";
import type { LearningEventV1, VerifiedAssessmentAttemptV1, VerifiedAssessmentSpecV1 } from "../../types/domains/learning-kernel.ts";
import { nextStateAfterReview } from "../../lib/review-utils.ts";
import { deriveLearnerStateSnapshot, type LearnerStateFacts } from "../learner-state-service.ts";
import { adaptReviewAttempt, adaptKnowledgeAttempt, adaptTutoringMicroAssessment, adaptInterviewEvaluation, projectLegacyLearningEvents } from "./legacy-event-adapter.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { buildEvidenceShadowReport } from "./evidence-shadow.ts";
import { EVIDENCE_POLICY_VERSION, MAX_EVIDENCE_ID_LENGTH, validateEvidenceEvent } from "./evidence-policy.ts";
import { legacyLearningEventId } from "./learning-event.ts";
import { adaptVerifiedAssessment } from "./verified-assessment-adapter.ts";

const instant = "2026-10-02T08:00:00.000Z";
const secret = "PRIVATE-SENTINEL-MUST-NOT-LEAK";
const today = new Date(instant);
function review(patch: Partial<Attempt> = {}): Attempt {
  return { id: "attempt-1", mistakeId: "mistake-1", result: "correct", confidence: 4, reviewedAt: "2026-10-02", ...patch };
}
function knowledge(patch: Partial<KnowledgeAttempt> = {}): KnowledgeAttempt {
  return { id: "knowledge-attempt-1", knowledgeId: "knowledge-1", result: "uncertain", confidence: 2, reviewedAt: "2026-10-02", ...patch };
}
function tutoring(): TutoringTurn {
  return { id: "turn-1", sessionId: "tutor-session-1", speaker: "ai_tutor", content: secret,
    detectedProblem: secret, confidence: 0.999, frameDescription: secret,
    observation: { capturedAt: instant, source: "camera", summary: secret, confidence: 0.999 },
    microAssessment: { questions: [
      { id: "micro-1", prompt: secret, options: [secret, secret], correctOptionIndex: 1, explanation: secret },
      { id: "micro-2", prompt: secret, options: [secret, secret], correctOptionIndex: 0, explanation: secret },
    ], selections: [1, 1], correctCount: 1, completedAt: instant }, createdAt: instant };
}
function session(): InterviewSession {
  return { id: "session-1", questionId: "question-1", type: "structured", title: secret, questionPrompt: secret,
    questionMaterial: secret, transcriptText: secret, status: "evaluated", stage: "evaluated",
    startedAt: instant, completedAt: instant, totalDurationSec: 120, createdAt: instant, updatedAt: instant };
}
function evaluation(): InterviewEvaluation {
  return { id: "evaluation-1", sessionId: "session-1", type: "structured", totalScore: 30,
    dimensions: [{ name: "表达能力", score: 2, maxScore: 20, comment: secret },
      { name: "分析能力", score: 12, maxScore: 30, comment: secret }],
    strengths: [secret], problems: [secret], suggestions: [secret], evidence: [secret], createdAt: instant, updatedAt: instant };
}
function allEvents(): LearningEventV1[] {
  return projectLegacyLearningEvents({ reviewAttempts: [review()], knowledgeAttempts: [knowledge()],
    tutoringTurns: [tutoring()], interviewSessions: [session()], interviewEvaluations: [evaluation()] }).events;
}
function reviewEvent(): LearningEventV1<"review.completed"> {
  const event = adaptReviewAttempt(review()).events[0];
  assert.equal(event.kind, "review.completed");
  return event as LearningEventV1<"review.completed">;
}
function report(events = allEvents()) {
  const derivation = deriveEvidence(events);
  return buildEvidenceShadowReport(events, derivation);
}
function facts(patch: Partial<LearnerStateFacts> = {}): LearnerStateFacts {
  return { mistakes: [], attempts: [], knowledgeEntries: [], knowledgeAttempts: [], interviewEvaluations: [],
    interviewPracticePlans: [], interviewSessions: [], tutoringSessions: [], tutoringTurns: [], tutoringPlans: [], ...patch };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
}

test("legacy v1 Evidence bytes remain identical to the 2e870fb baseline for all four source families", () => {
  // 在修改前基线 deriveEvidence 上核对的完整 JSON 摘要：覆盖 IDs、provenance、limitations 与 outcome。
  const evidence = deriveEvidence(allEvents()).evidence;
  assert.equal(evidence.length, 12);
  assert.ok(evidence.every((item) => item.policyVersion === "evidence-policy/v1"));
  assert.equal(createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    "ba50bbb380eec9e5e1a3f963c15d789ec6c1b0af743bad7d17297ff8caa76985");
});

for (const matches of [true, false]) {
  for (const assistance of ["none", "hint", "guided", "solution"] as const) {
    test(`verified ${matches ? "correct" : "wrong"} with ${assistance} is v2 strong scoped correctness only`, () => {
      const events = adaptVerifiedAssessment({ schemaVersion: 1, id: "verified-item", optionCount: 2, verifiedCorrectOptionIndex: 1 },
        { schemaVersion: 1, id: "verified-attempt", specId: "verified-item", selectedOptionIndex: matches ? 1 : 0,
          occurredAt: instant, assistance }).events;
      const result = deriveEvidence(events);
      assert.deepEqual(result.diagnostics, []);
      assert.equal(result.evidence.length, 1, "本来源不额外发 completion");
      const item = result.evidence[0];
      assert.equal(item.policyVersion, "evidence-policy/v2");
      assert.equal(item.claim, "correctness");
      assert.equal(item.evidenceClass, "scored_performance");
      assert.equal(item.strength, "strong");
      assert.equal(item.assistance, assistance);
      assert.deepEqual(item.outcome, { kind: "verified_key_comparison", matchesVerifiedKey: matches,
        direction: matches ? "supports" : "refutes" });
      assert.deepEqual(item.provenance.limitations, []);
      assert.equal(item.provenance.adapterId, "recall-verified-assessment/v1");
      assert.deepEqual(item.sourceRecordRefs, events[0].source.records);
      assert.deepEqual(item.sourceEventIds, [events[0].id]);
      assert.equal(item.measurementGroupId, events[0].id);
      const mixed = deriveEvidence([...allEvents(), ...events]);
      assert.deepEqual(mixed.evidence.filter((record) => record.policyVersion === "evidence-policy/v1"), deriveEvidence(allEvents()).evidence);
      assert.equal(buildEvidenceShadowReport(events, result).policyVersion, "evidence-policy/v2");
      assert.equal(buildEvidenceShadowReport(events, result).countsByEventKind["verification.assessed"], 1);
      assert.equal(report().policyVersion, "evidence-policy/v1");
      assert.equal(Object.hasOwn(report().countsByEventKind, "verification.assessed"), false);
    });
  }
}

function verifiedSourceEvent(attempt: Partial<VerifiedAssessmentAttemptV1> = {}, spec: Partial<VerifiedAssessmentSpecV1> = {}) {
  return adaptVerifiedAssessment({ schemaVersion: 1, id: "stable-item", optionCount: 2, verifiedCorrectOptionIndex: 1, ...spec },
    { schemaVersion: 1, id: "stable-attempt", specId: "stable-item", selectedOptionIndex: 1,
      occurredAt: instant, assistance: "none", ...attempt }).events[0];
}

for (const [name, revision] of [
  ["attempt assistance", verifiedSourceEvent({ assistance: "hint" })],
  ["attempt selected option", verifiedSourceEvent({ selectedOptionIndex: 0 })],
  ["attempt occurrence", verifiedSourceEvent({ occurredAt: "2026-10-03T08:00:00Z" })],
  ["attempt spec association", verifiedSourceEvent({ specId: "other-item" }, { id: "other-item" })],
  ["spec verified key", verifiedSourceEvent({ id: "other-attempt", selectedOptionIndex: 0 }, { verifiedCorrectOptionIndex: 0 })],
  ["spec option count", verifiedSourceEvent({ id: "other-attempt" }, { optionCount: 3 })],
] as const) {
  test(`verified source identity rejects conflicting ${name} revisions across different Event IDs`, () => {
    const events = [verifiedSourceEvent(), revision];
    assert.notEqual(events[0].id, events[1].id, "不同 revision 的 Event ID 不再绕过稳定来源身份约束");
    events.forEach((event) => assert.equal(validateEvidenceEvent(event), null));
    const expected = { evidence: [], diagnostics: events.map((event) => event.id).toSorted().map((sourceEventId) => (
      { code: "conflicting_source_identity", sourceEventId }
    )) };
    for (const input of [events, [...events].reverse(), [...events, ...structuredClone(events)].reverse()]) {
      assert.deepEqual(deriveEvidence(input), expected);
      assert.equal(JSON.stringify(deriveEvidence(input)), JSON.stringify(expected));
    }
    const mixed = deriveEvidence([...allEvents(), ...events]);
    assert.deepEqual(mixed.evidence, deriveEvidence(allEvents()).evidence, "legacy Evidence 全部保持原值");
    assert.deepEqual(mixed.diagnostics, expected.diagnostics);
    assert.equal(buildEvidenceShadowReport(events, deriveEvidence(events)).diagnosticsByCode.conflicting_source_identity, 2);
    assert.equal(Object.hasOwn(report().diagnosticsByCode, "conflicting_source_identity"), false);
  });
}

test("verified source identity permits distinct attempts sharing one immutable spec and collapses identical duplicates", () => {
  const events = [verifiedSourceEvent({ id: "stable-item" }), verifiedSourceEvent({ id: "other-attempt" })];
  const expected = deriveEvidence(events);
  assert.deepEqual(expected.diagnostics, []);
  assert.equal(expected.evidence.length, 2);
  assert.equal(new Set(expected.evidence.map((item) => item.measurementGroupId)).size, 2);
  assert.deepEqual(events[0].source.records[1], events[1].source.records[1]);
  const reordered = events.map((event) => ({ ...Object.fromEntries(Object.entries(event).reverse()),
    source: { ...event.source, records: event.source.records.map((ref) => Object.fromEntries(Object.entries(ref).reverse())) },
  }) as LearningEventV1);
  const input = [...events, ...structuredClone(events), ...reordered].reverse();
  const before = structuredClone(input);
  freeze(input);
  assert.deepEqual(deriveEvidence(input), expected);
  assert.equal(JSON.stringify(deriveEvidence(input)), JSON.stringify(expected));
  assert.deepEqual(input, before);
});

test("verified source identity conflict rejects only implicated records and diagnostics never expose private content", () => {
  const privateFields = { questionText: secret, explanation: secret, providerResponse: secret };
  const events = [verifiedSourceEvent(), verifiedSourceEvent({ assistance: "hint" }), verifiedSourceEvent({ id: "independent-attempt" })]
    .map((event) => ({ ...event, ...privateFields, payload: { ...event.payload, ...privateFields } }));
  const result = deriveEvidence(events);
  assert.deepEqual(result.evidence, deriveEvidence([events[2]]).evidence);
  assert.equal(result.diagnostics.length, 2);
  result.diagnostics.forEach((item) => assert.deepEqual(Object.keys(item).toSorted(), ["code", "sourceEventId"]));
  assert.equal(JSON.stringify([result, buildEvidenceShadowReport(events, result)]).includes(secret), false);
  assert.deepEqual(deriveEvidence([...events].reverse()), result);
});

test("verified source identity conflicts cannot be hidden by dropping an Event-ID-conflicting group first", () => {
  const assisted = verifiedSourceEvent({ assistance: "hint" });
  const invalid = { ...assisted, payload: { ...assisted.payload, assistance: "none" as const } };
  const unassisted = verifiedSourceEvent();
  const events = [assisted, invalid, unassisted];
  const result = deriveEvidence(events);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.diagnostics.map((item) => item.code).toSorted(), ["conflicting_event_identity", "conflicting_source_identity"]);
  assert.deepEqual(deriveEvidence([...events].reverse()), result);
});

test("verified source identity cannot ignore a separately invalid event's contradictory source revision", () => {
  const valid = verifiedSourceEvent();
  const invalid = { ...valid, id: "invalid-revision", source: { ...valid.source,
    records: [{ ...valid.source.records[0], revision: secret }, valid.source.records[1]] } };
  const result = deriveEvidence([valid, invalid]);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.diagnostics.map((item) => item.code).toSorted(), ["conflicting_source_identity", "invalid_lineage"]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(deriveEvidence([invalid, valid]), result);
});

test("identical and shuffled inputs produce byte/deep equal evidence, diagnostics and counts without clock/random", (context) => {
  const fail = () => { throw new Error("clock/random forbidden"); };
  context.mock.method(Math, "random", fail);
  context.mock.method(Date, "now", fail);
  context.mock.method(globalThis.crypto, "randomUUID", fail);
  const events = allEvents();
  const first = deriveEvidence(events);
  assert.equal(first.diagnostics.length, 0);
  for (const input of [events, [...events].reverse(), [...events.slice(2), ...events.slice(0, 2)]]) {
    assert.deepEqual(deriveEvidence(input), first);
    assert.equal(JSON.stringify(deriveEvidence(input)), JSON.stringify(first));
    assert.deepEqual(report(input), report(events));
    assert.equal(JSON.stringify(report(input)), JSON.stringify(report(events)));
  }
});

test("source events are immutable inputs and evidence has detached lineage/provenance/targets", () => {
  const events = allEvents();
  const before = structuredClone(events);
  freeze(events);
  const result = deriveEvidence(events);
  assert.deepEqual(events, before);
  for (const item of result.evidence) {
    assert.ok(item.sourceEventIds.length > 0);
    const event = events.find((event) => event.id === item.sourceEventIds[0])!;
    assert.ok(event);
    assert.deepEqual(item.sourceRecordRefs, event.source.records);
    assert.notEqual(item.sourceRecordRefs[0], event.source.records[0]);
    assert.deepEqual(item.target, event.target);
    assert.notEqual(item.target, event.target);
    assert.notEqual(item.provenance, event.provenance);
    assert.equal(item.policyVersion, EVIDENCE_POLICY_VERSION);
    assert.equal(item.measurementGroupId, event.id);
    assert.ok(item.id.length <= MAX_EVIDENCE_ID_LENGTH);
    assert.equal(item.assistance, "unknown");
  }
  assert.equal(new Set(result.evidence.map((item) => item.id)).size, result.evidence.length);
});

for (const result of ["correct", "wrong", "uncertain"] as const) {
  for (const source of ["review", "knowledge"] as const) {
    test(`${source} ${result} yields strong completion and weak scoped self-report only`, () => {
      const events = source === "review" ? adaptReviewAttempt(review({ result })).events : adaptKnowledgeAttempt(knowledge({ result })).events;
      const evidence = deriveEvidence(events).evidence;
      assert.equal(evidence.length, 2);
      const completion = evidence.find((item) => item.claim === "completion")!;
      assert.equal(completion.evidenceClass, "workflow_fact");
      assert.equal(completion.strength, "strong");
      assert.deepEqual(completion.outcome, { kind: "workflow_completed", direction: "supports" });
      const correctness = evidence.find((item) => item.claim === "correctness")!;
      assert.equal(correctness.evidenceClass, "self_report");
      assert.equal(correctness.strength, "weak");
      assert.deepEqual(correctness.outcome, { kind: "self_reported_result", result,
        direction: result === "correct" ? "supports" : result === "wrong" ? "refutes" : "inconclusive" });
      assert.ok(correctness.provenance.limitations.includes("self_report_only"));
      assert.ok(correctness.provenance.limitations.includes("no_independent_grader"));
      assert.ok(evidence.every((item) => ["completion", "correctness"].includes(item.claim)));
    });
  }
}

test("legacy mastery heuristic never changes evidence identity, strength or scoped outcome", () => {
  const baseline = deriveEvidence(adaptReviewAttempt(review({ confidence: 1 })).events);
  for (const confidence of [2, 3, 4, 5]) assert.deepEqual(deriveEvidence(adaptReviewAttempt(review({ confidence })).events), baseline);
});

test("micro supplied key match/refutation preserves model key limits and unknown assistance", () => {
  const events = adaptTutoringMicroAssessment(tutoring()).events;
  const evidence = deriveEvidence(events).evidence;
  assert.equal(evidence.length, 4);
  assert.equal(evidence.filter((item) => item.claim === "completion" && item.strength === "strong").length, 2);
  for (const event of events) {
    assert.equal(event.kind, "assessment.submitted");
    const item = evidence.find((item) => item.sourceEventIds[0] === event.id && item.claim === "correctness")!;
    const matches = (event as LearningEventV1<"assessment.submitted">).payload.matchesSuppliedKey;
    assert.deepEqual(item.outcome, { kind: "supplied_key_comparison", matchesSuppliedKey: matches, direction: matches ? "supports" : "refutes" });
    assert.equal(item.evidenceClass, "scored_performance");
    assert.equal(item.strength, "weak");
    assert.equal(item.provenance.modelAuthored, true);
    for (const limit of ["model_authored_key", "no_independent_grader", "assistance_unknown", "current_projection", "history_incomplete"] as const)
      assert.ok(item.provenance.limitations.includes(limit));
  }
  assert.equal(new Set(evidence.map((item) => item.measurementGroupId)).size, 2);
});

test("interview completion is separate; overall and dimensions retain model performance and one measurement group", () => {
  const events = adaptInterviewEvaluation(evaluation(), session()).events;
  const result = deriveEvidence(events);
  assert.equal(result.evidence.length, 4);
  const completion = result.evidence.find((item) => item.claim === "completion")!;
  assert.equal(completion.strength, "strong");
  const performance = result.evidence.filter((item) => item.claim === "performance");
  assert.equal(performance.length, 3);
  assert.equal(new Set(performance.map((item) => item.measurementGroupId)).size, 1);
  assert.notEqual(completion.measurementGroupId, performance[0].measurementGroupId);
  assert.deepEqual(performance.map((item) => item.outcome).toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [
    { kind: "model_rubric_score", scope: "overall", score: 30, maxScore: 100, direction: "inconclusive" },
    { kind: "model_rubric_score", scope: "dimension", dimension: "表达能力", dimensionIndex: 0, score: 2, maxScore: 20, direction: "inconclusive" },
    { kind: "model_rubric_score", scope: "dimension", dimension: "分析能力", dimensionIndex: 1, score: 12, maxScore: 30, direction: "inconclusive" },
  ].toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  for (const item of performance) {
    assert.equal(item.evidenceClass, "model_assessment");
    assert.equal(item.strength, "weak");
    assert.equal(item.assistance, "unknown");
    assert.deepEqual(item.target, { category: "question", namespace: "interview_question", id: "question-1" });
    assert.ok(item.provenance.limitations.includes("model_assessment_only"));
    assert.ok(item.provenance.limitations.includes("history_incomplete"));
  }
});

test("empty and repeated-label interview dimensions preserve overall and distinct slices without inventing targets", () => {
  for (const dimensions of [[], [evaluation().dimensions[0], evaluation().dimensions[0]]]) {
    const events = adaptInterviewEvaluation({ ...evaluation(), dimensions }, session()).events;
    const result = deriveEvidence(events);
    assert.equal(result.diagnostics.length, 0);
    assert.equal(result.evidence.length, dimensions.length + 2);
    assert.equal(new Set(result.evidence.map((item) => item.id)).size, result.evidence.length);
  }
});

test("mismatched provenance for every supported kind fails closed, including modelAuthored false", () => {
  for (const event of allEvents()) {
    for (const patch of [{ modality: "sensor" }, { modelAuthored: false }, { keySource: "unknown" },
      { scoringMethod: "human_rubric" }, { normalizationVersion: "forged/v1" }, { history: "forged" }, { timePrecision: "unknown" }]) {
      const forged = { ...event, provenance: { ...event.provenance, ...patch } } as LearningEventV1;
      const result = deriveEvidence([forged]);
      assert.deepEqual(result.evidence, []);
      assert.equal(result.diagnostics[0].code, "invalid_provenance");
    }
    const result = deriveEvidence([{ ...event, source: { ...event.source, adapterId: "third-party" } } as unknown as LearningEventV1]);
    assert.equal(result.diagnostics[0].code, "invalid_provenance");
  }
});

test("orphan/mismatched lineage and forged targets fail closed", () => {
  const event = reviewEvent();
  for (const forged of [
    { ...event, source: { ...event.source, records: [] } },
    { ...event, source: { ...event.source, records: [{ recordType: "review_attempt", recordId: "different" }] } },
    { ...event, target: { category: "skill", namespace: "skill", id: "invented" } },
    { ...event, target: { ...event.target, id: "" } },
    { ...event, attemptId: "different" }, { ...event, recordedAt: instant },
  ]) {
    const result = deriveEvidence([forged as LearningEventV1]);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.diagnostics.length, 1);
  }
});

test("missing legacy time stays unknown; interview completion cannot forge date precision", () => {
  const reviewEvents = adaptReviewAttempt(review({ reviewedAt: "" })).events;
  assert.equal(deriveEvidence(reviewEvents).evidence.length, 2);
  const interviewEvents = adaptInterviewEvaluation(evaluation(), { ...session(), completedAt: undefined }).events;
  assert.equal(deriveEvidence(interviewEvents).evidence.length, 4);
  const completion = interviewEvents[0];
  assert.equal(completion.occurredAt, null);
  const forged = { ...completion, occurredAt: "2026-10-02", provenance: { ...completion.provenance, timePrecision: "date" as const } };
  assert.deepEqual(deriveEvidence([forged]).evidence, []);
  assert.equal(deriveEvidence([forged]).diagnostics[0].code, "invalid_provenance");
});

test("contradictory measurements, malformed dimensions and source revision mismatch fail closed", () => {
  const micro = adaptTutoringMicroAssessment(tutoring()).events[0] as LearningEventV1<"assessment.submitted">;
  const interview = adaptInterviewEvaluation(evaluation(), session()).events[1] as LearningEventV1<"interview.evaluated">;
  const forged: LearningEventV1[] = [
    { ...reviewEvent(), payload: { reportedResult: "forged", legacyMasteryAfter: 4 } } as unknown as LearningEventV1,
    { ...micro, payload: { ...micro.payload, matchesSuppliedKey: false } },
    { ...micro, payload: { ...micro.payload, questionOrdinal: 2 } },
    { ...micro, payload: { ...micro.payload, selectedOptionIndex: 99, matchesSuppliedKey: false } },
    { ...micro, payload: { ...micro.payload, submittedCorrectCount: 2 } },
    { ...interview, payload: { ...interview.payload, totalScore: 101 } },
    { ...interview, payload: { ...interview.payload, dimensions: [null] } } as unknown as LearningEventV1,
    { ...interview, payload: { ...interview.payload, dimensions: new Array(2) } },
    { ...interview, payload: { ...interview.payload, dimensions: [{ name: "x", score: 5, maxScore: 0 }] } },
  ];
  for (const event of forged) {
    const result = deriveEvidence([event]);
    assert.deepEqual(result.evidence, []);
    assert.equal(result.diagnostics.length, 1);
    assert.ok(["invalid_event", "invalid_measurement"].includes(result.diagnostics[0].code));
  }
  assert.equal(validateEvidenceEvent(null), "invalid_event");
  assert.equal(validateEvidenceEvent({ ...reviewEvent(), provenance: null }), "invalid_event");
});

test("exact duplicate events collapse regardless of object key order", () => {
  const event = reviewEvent();
  const reordered = Object.fromEntries(Object.entries(event).reverse()) as LearningEventV1;
  assert.deepEqual(deriveEvidence([event, structuredClone(event), reordered]), deriveEvidence([event]));
});

test("same identity conflicting payload/provenance rejects entire group independent of ordering", () => {
  const event = reviewEvent();
  for (const conflict of [{ ...event, payload: { ...event.payload, reportedResult: "wrong" as const } },
    { ...event, provenance: { ...event.provenance, modelAuthored: false } },
    { ...event, payload: { ...event.payload, legacyMasteryAfter: 5 } }]) {
    const other = adaptKnowledgeAttempt(knowledge()).events[0];
    const first = deriveEvidence([event, conflict, other]);
    assert.deepEqual(first, deriveEvidence([other, conflict, event]));
    assert.ok(first.evidence.every((item) => !item.sourceEventIds.includes(event.id)));
    assert.deepEqual(first.diagnostics, [{ code: "conflicting_event_identity", sourceEventId: event.id }]);
    assert.equal(first.evidence.length, 2);
  }
});

test("uncomparable/cyclic events cannot launder a valid same-ID event", () => {
  const event = reviewEvent();
  const cyclic = Object.assign(structuredClone(event), { extra: {} });
  cyclic.extra = cyclic;
  assert.equal(deriveEvidence([cyclic]).diagnostics[0].code, "invalid_event");
  assert.deepEqual(deriveEvidence([event, cyclic]), deriveEvidence([cyclic, event]));
  assert.deepEqual(deriveEvidence([event, cyclic]).evidence, []);
});

test("signed zero cannot create an input-order winner for the same model measurement", () => {
  const event = adaptInterviewEvaluation({ ...evaluation(), totalScore: 0 }, session()).events[1];
  assert.equal(event.kind, "interview.evaluated");
  const negative = { ...event, payload: { ...(event as LearningEventV1<"interview.evaluated">).payload, totalScore: -0 } } as LearningEventV1;
  assert.deepEqual(deriveEvidence([event, negative]), deriveEvidence([negative, event]));
  assert.deepEqual(deriveEvidence([event, negative]).evidence, []);
  assert.equal(deriveEvidence([event, negative]).diagnostics[0].code, "conflicting_event_identity");
});

test("escaped IDs distinguish separators and oversized evidence IDs reject whole measurement without truncation", () => {
  const left = adaptReviewAttempt(review({ id: "a/b:%中文", mistakeId: "target/a" })).events;
  const right = adaptReviewAttempt(review({ id: "a/b", mistakeId: "%中文/target/a" })).events;
  assert.notEqual(deriveEvidence(left).evidence[0].id, deriveEvidence(right).evidence[0].id);
  const event = adaptTutoringMicroAssessment(tutoring()).events[0] as LearningEventV1<"assessment.submitted">;
  const revision = JSON.parse(event.source.records[0].revision!);
  revision[1] = "中".repeat(256);
  revision[2][1][0][0] = revision[1];
  const ref = { ...event.source.records[0], recordId: "中".repeat(256), revision: JSON.stringify(revision) };
  const id = legacyLearningEventId(ref, event.kind);
  assert.ok(id);
  const large: LearningEventV1 = { ...event, id, source: { ...event.source, records: [ref] },
    target: { ...event.target, id: `${encodeURIComponent(ref.recordId)}:${encodeURIComponent(revision[1])}` } };
  assert.equal(validateEvidenceEvent(large), null);
  const result = deriveEvidence([large]);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.diagnostics[0].code, "identity_out_of_bounds");
});

test("shadow counts are safe, stable and distinguish rubric records from measurements", () => {
  const output = report();
  assert.equal(output.eventCount, 6);
  assert.equal(output.evidenceCount, 12);
  assert.equal(output.measurementGroupCount, 6);
  assert.deepEqual(output.countsByEvidenceClass, { workflow_fact: 5, self_report: 2, scored_performance: 2,
    human_assessment: 0, model_assessment: 3, sensor_observation: 0 });
  assert.deepEqual(output.countsByClaim, { completion: 5, correctness: 4, performance: 3,
    understanding: 0, independence: 0, retention: 0, transfer: 0, misconception: 0 });
  assert.equal(output.authorityLimitationCounts.assistance_unknown, 12);
  assert.equal(output.authorityLimitationCounts.current_projection, 8);
  assert.equal(output.authorityLimitationCounts.history_incomplete, 8);
  assert.equal(Object.values(output.diagnosticsByCode).reduce((a, b) => a + b), 0);
  const event = reviewEvent();
  const conflict = { ...event, payload: { ...event.payload, reportedResult: "wrong" as const } };
  assert.equal(report([event, conflict]).diagnosticsByCode.conflicting_event_identity, 1);
  assert.equal(report([event, conflict]).evidenceCount, 0);
  assert.equal(report([]).eventCount, 0);
});

test("sentinel prose, hidden/provider/media/credential content is absent even from extra event fields", () => {
  const fields = ["stem", "answer", "explanation", "title", "body", "content", "prompt", "options", "teacherProse",
    "detectedProblem", "confidence", "transcript", "comment", "strengths", "problems", "suggestions", "evidenceProse",
    "frameDataUrl", "rawMedia", "providerResponse", "credentials", "reasoning", "thoughtSignature"];
  const privateFields = Object.fromEntries(fields.map((key) => [key, secret]));
  // Review confidence 是既有数值 heuristic；隐私 sentinel 不应先破坏 adapter 的有效输入。
  const sourceProse = Object.fromEntries(fields.filter((key) => key !== "confidence").map((key) => [key, secret]));
  const rawEvents = projectLegacyLearningEvents({ reviewAttempts: [Object.assign(review(), sourceProse)],
    knowledgeAttempts: [Object.assign(knowledge(), sourceProse)], tutoringTurns: [tutoring()],
    interviewSessions: [session()], interviewEvaluations: [evaluation()] }).events;
  const events = rawEvents.map((event) => ({ ...event, ...privateFields, target: { ...event.target, ...privateFields },
    provenance: { ...event.provenance, ...privateFields },
    source: { ...event.source, records: event.source.records.map((ref) => ({ ...ref, ...privateFields })) } }));
  const result = deriveEvidence(events);
  assert.equal(result.evidence.length, 12);
  const serialized = JSON.stringify([result, buildEvidenceShadowReport(events, result)]);
  assert.ok(!serialized.includes(secret));
  for (const field of fields) assert.ok(!serialized.includes(`"${field}":`));
  assert.ok(serialized.includes("表达能力"));
  assert.ok(!JSON.stringify(buildEvidenceShadowReport(events, result)).includes("表达能力"));
});

test("legacy review raises scheduling/mastery heuristic while shadow records self-report only", () => {
  const mistake: Mistake = { id: "mistake-1", board: "判断推理", source: "test", stem: secret, answer: secret,
    explanation: secret, reasons: [], tags: [], mastery: 2, nextReviewAt: "2026-10-02", createdAt: instant, updatedAt: instant };
  const next = nextStateAfterReview(mistake, "correct", today);
  assert.ok(next.mastery > mistake.mastery);
  assert.ok(next.nextReviewAt > mistake.nextReviewAt);
  const evidence = deriveEvidence(adaptReviewAttempt(review({ confidence: next.mastery })).events).evidence;
  assert.deepEqual(evidence.map((item) => item.claim).toSorted(), ["completion", "correctness"]);
  assert.equal(evidence.find((item) => item.claim === "correctness")?.evidenceClass, "self_report");
});

test("legacy micro pass suppresses immediate retry; shadow preserves supplied model key only", () => {
  const turn = tutoring();
  turn.microAssessment!.selections = [1, 0];
  turn.microAssessment!.correctCount = 2;
  const plan: TutoringPlan = { id: "auto:tutor-session-1", title: "plan", objective: "practice", linkedKnowledgeIds: [],
    linkedMistakeIds: [], nextTask: "practice", nextPracticeAt: "2026-10-05", status: "active", createdAt: instant, updatedAt: instant };
  const input = facts({ tutoringTurns: [turn], tutoringPlans: [plan] });
  const before = deriveLearnerStateSnapshot(input, today);
  const actions = before.recommendations.filter((item) => item.kind === "retry_tutoring");
  assert.deepEqual(actions.map((item) => item.priority), [400]);
  const evidence = deriveEvidence(adaptTutoringMicroAssessment(turn).events).evidence;
  assert.ok(evidence.filter((item) => item.claim === "correctness").every((item) => item.outcome.kind === "supplied_key_comparison"));
  assert.ok(evidence.every((item) => ["completion", "correctness"].includes(item.claim)));
  assert.deepEqual(deriveLearnerStateSnapshot(input, today), before);
});

test("legacy interview score exposes weakness; shadow produces model performance without canonical skill state", () => {
  const input = facts({ interviewSessions: [session()], interviewEvaluations: [evaluation()] });
  const before = deriveLearnerStateSnapshot(input, today);
  assert.ok(before.signals.some((item) => item.kind === "weakness" && item.evidence.some((ref) => ref.id === "evaluation-1")));
  const result = deriveEvidence(adaptInterviewEvaluation(evaluation(), session()).events);
  assert.ok(result.evidence.every((item) => ["completion", "performance"].includes(item.claim)));
  assert.doesNotMatch(JSON.stringify(result), /weakness|mastery|lastVerifiedAt|nextVerificationAt|emerging|developing|supported/);
  assert.deepEqual(deriveLearnerStateSnapshot(input, today), before);
});
