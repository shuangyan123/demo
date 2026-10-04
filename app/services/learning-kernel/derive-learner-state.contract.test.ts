import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceRecordV1, LearnerStateTimeContextV1, LearnerTargetStateV1, LearningEventV1 } from "../../types/domains/learning-kernel.ts";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import type { Attempt } from "../../types/domains/review.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { deriveLearnerTargetStates, LEARNER_STATE_POLICY_VERSION } from "./derive-learner-state.ts";
import { adaptReviewAttempt, adaptKnowledgeAttempt, adaptTutoringMicroAssessment, adaptInterviewEvaluation } from "./legacy-event-adapter.ts";
import { compareLearningEventText } from "./learning-event.ts";

const instant = "2026-10-02T08:00:00.000Z";
const timeContext = { asOf: "2026-10-04T09:00:00+08:00" };
const privateSentinel = "PRIVATE-CONTENT-MUST-NOT-LEAK";
function review(patch: Partial<Attempt> = {}): LearningEventV1[] {
  return adaptReviewAttempt({ id: "review-1", mistakeId: "target-1", result: "correct", confidence: 4,
    reviewedAt: "2026-10-02", ...patch }).events;
}
function knowledge(patch: Partial<KnowledgeAttempt> = {}): LearningEventV1[] {
  return adaptKnowledgeAttempt({ id: "knowledge-review-1", knowledgeId: "target-1", result: "correct", confidence: 4,
    reviewedAt: "2026-10-02", ...patch }).events;
}
function tutoring(passed: boolean, at = instant): LearningEventV1[] {
  const turn: TutoringTurn = { id: "turn-1", sessionId: "tutor-session-1", speaker: "ai_tutor", content: privateSentinel,
    detectedProblem: privateSentinel, confidence: 0.999, frameDescription: privateSentinel,
    microAssessment: { questions: [{ id: "micro-1", prompt: privateSentinel, options: [privateSentinel, privateSentinel],
      correctOptionIndex: 1, explanation: privateSentinel }], selections: [passed ? 1 : 0], correctCount: passed ? 1 : 0,
    completedAt: at }, createdAt: at };
  return adaptTutoringMicroAssessment(turn).events;
}
function interview(score = 30, id = "evaluation-1", at = instant): LearningEventV1[] {
  const session: InterviewSession = { id: "interview-session-1", questionId: "interview-question-1", type: "structured",
    title: privateSentinel, questionPrompt: privateSentinel, questionMaterial: privateSentinel, transcriptText: privateSentinel,
    status: "evaluated", stage: "evaluated", startedAt: at, completedAt: at, totalDurationSec: 120, createdAt: at, updatedAt: at };
  const evaluation: InterviewEvaluation = { id, sessionId: session.id, type: "structured", totalScore: score,
    dimensions: [{ name: "表达能力", score: score / 5, maxScore: 20, comment: privateSentinel },
      { name: "分析能力", score: score / 5, maxScore: 20, comment: privateSentinel }],
    strengths: [privateSentinel], problems: [privateSentinel], suggestions: [privateSentinel], evidence: [privateSentinel],
    createdAt: at, updatedAt: at };
  return adaptInterviewEvaluation(evaluation, session).events;
}
function allEvents(): LearningEventV1[] {
  return [...review(), ...knowledge(), ...tutoring(true), ...interview()];
}
function derive(events = allEvents(), evidence = deriveEvidence(events).evidence) {
  return deriveLearnerTargetStates(events, evidence, timeContext);
}
function assertFloor(state: LearnerTargetStateV1): void {
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.understanding, "unknown");
  assert.equal(state.independence, "unknown");
  assert.equal(state.retention, "untested");
  assert.equal(state.transfer, "untested");
  assert.deepEqual(state.evidenceReferences, { understanding: [], independence: [], retention: [], transfer: [] });
  assert.equal(state.lastVerifiedAt, null);
  assert.equal(state.nextVerificationAt, null);
  assert.equal(state.policyVersion, LEARNER_STATE_POLICY_VERSION);
  assert.deepEqual(state.timeContext, timeContext);
  for (const [dimension, eligibility] of Object.entries(state.promotionEligibility)) {
    assert.equal(eligibility.status, "blocked");
    assert.deepEqual(eligibility.eligibleEvidenceIds, []);
    assert.deepEqual(eligibility.candidateEvidenceIds, state.sourceEvidenceIds);
    assert.deepEqual(eligibility.candidateMeasurementGroupIds, eligibility.candidateMeasurementGroupIds.toSorted(compareLearningEventText));
    assert.equal(new Set(eligibility.candidateMeasurementGroupIds).size, eligibility.candidateMeasurementGroupIds.length);
    assert.deepEqual(eligibility.blockers, eligibility.blockers.toSorted(compareLearningEventText));
    assert.equal(new Set(eligibility.blockers).size, eligibility.blockers.length);
    assert.ok(eligibility.blockers.includes("no_qualified_direct_evidence"));
    assert.ok(eligibility.blockers.includes("assistance_unknown"));
    assert.ok(eligibility.blockers.includes("no_independent_grader"));
    if (dimension === "retention") assert.ok(eligibility.blockers.includes("missing_delayed_verification"));
    if (dimension === "transfer") assert.ok(eligibility.blockers.includes("missing_transfer_context"));
  }
  assert.deepEqual(Object.keys(state).toSorted(), ["schemaVersion", "target", "understanding", "independence", "retention",
    "transfer", "evidenceReferences", "sourceEvidenceIds", "lastEvidenceAt", "lastVerifiedAt", "nextVerificationAt",
    "policyVersion", "timeContext", "promotionEligibility"].toSorted(), "不得增加 mastery/confidence/weakness/misconception 字段");
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
}

test("empty events/evidence produce empty states; events alone fail closed on incomplete Evidence scope", () => {
  assert.deepEqual(derive([], []), { states: [], diagnostics: [] });
  assert.deepEqual(derive(allEvents(), []), { states: [], diagnostics: deriveEvidence(allEvents()).evidence.map((item) => (
    { code: "incomplete_evidence_scope", sourceEventId: null, sourceEvidenceId: item.id }
  )) });
});

test("strong workflow completion alone never creates a target state for any legacy source", () => {
  const events = allEvents();
  const evidence = deriveEvidence(events).evidence.filter((item) => item.claim === "completion");
  assert.ok(evidence.length > 0 && evidence.every((item) => item.evidenceClass === "workflow_fact" && item.strength === "strong"));
  const incomplete = derive(events, evidence);
  assert.deepEqual(incomplete.states, []);
  assert.equal(incomplete.diagnostics.length, deriveEvidence(events).evidence.length - evidence.length);
  assert.ok(incomplete.diagnostics.every((item) => item.code === "incomplete_evidence_scope"));
  const completionEvents = interview().filter((event) => event.kind === "interview.completed");
  assert.deepEqual(derive(completionEvents), { states: [], diagnostics: [] });
});

for (const result of ["correct", "wrong", "uncertain"] as const) {
  for (const source of [review, knowledge]) {
    test(`${source.name} self-report ${result} creates only default dimensions, never strength or weakness`, () => {
      const events = source({ result });
      const canonical = deriveEvidence(events);
      const stateResult = derive(events, canonical.evidence);
      assert.equal(stateResult.states.length, 1);
      assert.deepEqual(stateResult.diagnostics, []);
      const state = stateResult.states[0];
      assertFloor(state);
      assert.deepEqual(state.sourceEvidenceIds, canonical.evidence.filter((item) => item.claim !== "completion").map((item) => item.id));
      assert.deepEqual(state.lastEvidenceAt, { value: "2026-10-02", precision: "date" });
      // 直接检查 Phase C 原有 authority 与 outcome，E1 不重写 Evidence。
      assert.deepEqual(deriveEvidence(events), canonical);
      const learning = canonical.evidence.find((item) => item.claim === "correctness")!;
      assert.equal(learning.evidenceClass, "self_report");
      assert.equal(learning.strength, "weak");
      assert.deepEqual(learning.outcome, { kind: "self_reported_result", result,
        direction: result === "correct" ? "supports" : result === "wrong" ? "refutes" : "inconclusive" });
      assert.deepEqual(learning.provenance.limitations, ["assistance_unknown", "no_independent_grader", "self_report_only"]);
      assert.ok(state.promotionEligibility.understanding.blockers.includes("self_report_only"));
    });
  }
}

for (const passed of [true, false]) {
  test(`model-authored supplied-key ${passed ? "pass" : "fail"} grants neither understanding nor independence`, () => {
    const events = tutoring(passed);
    const canonical = deriveEvidence(events);
    const result = derive(events, canonical.evidence);
    assert.equal(result.states.length, 1);
    assert.deepEqual(result.diagnostics, []);
    assertFloor(result.states[0]);
    assert.deepEqual(result.states[0].lastEvidenceAt, { value: instant, precision: "instant" });
    const item = canonical.evidence.find((item) => item.claim === "correctness")!;
    assert.equal(item.evidenceClass, "scored_performance");
    assert.equal(item.assistance, "unknown");
    assert.equal(item.strength, "weak");
    assert.deepEqual(item.outcome, { kind: "supplied_key_comparison", matchesSuppliedKey: passed, direction: passed ? "supports" : "refutes" });
    assert.deepEqual(item.provenance.limitations, ["assistance_unknown", "current_projection", "history_incomplete", "model_authored_key", "no_independent_grader"]);
    assert.ok(result.states[0].promotionEligibility.understanding.blockers.includes("model_authored_key"));
    assert.deepEqual(deriveEvidence(events), canonical);
  });
}

for (const score of [0, 100]) {
  test(`Interview score ${score} and rubric labels cannot create canonical strength/weakness or skill targets`, () => {
    const events = interview(score);
    const canonical = deriveEvidence(events);
    const result = derive(events, canonical.evidence);
    assert.equal(result.states.length, 1);
    assert.deepEqual(result.diagnostics, []);
    assertFloor(result.states[0]);
    assert.deepEqual(result.states[0].target, { category: "question", namespace: "interview_question", id: "interview-question-1" });
    assert.equal(result.states[0].sourceEvidenceIds.length, 3);
    const learning = canonical.evidence.filter((item) => item.claim !== "completion");
    assert.equal(new Set(learning.map((item) => item.measurementGroupId)).size, 1, "rubric slices 是一次测量");
    assert.ok(learning.every((item) => item.claim === "performance" && item.evidenceClass === "model_assessment"
      && item.strength === "weak" && item.outcome.direction === "inconclusive"));
    assert.deepEqual(deriveEvidence(events), canonical);
    const withoutCompletion = derive(events, learning);
    assert.deepEqual(withoutCompletion.states, [], "completion 也属于必须完整提供的 canonical scope");
    assert.ok(withoutCompletion.diagnostics.every((item) => item.code === "incomplete_evidence_scope"));
    for (const eligibility of Object.values(result.states[0].promotionEligibility)) {
      assert.equal(eligibility.candidateMeasurementGroupIds.length, 1, "多个 rubric slices 只是一份候选测量");
      assert.deepEqual(eligibility.candidateEvidenceIds, learning.map((item) => item.id));
      assert.ok(eligibility.blockers.includes("model_assessment_only"));
    }
    assert.doesNotMatch(JSON.stringify(result.states), /"(?:score|maxScore|dimension|weakness|strength|mastery|confidence)":/);
  });
}

test("all current sources remain unverified and unscheduled; elapsed time alone grants no retention or transfer", () => {
  const result = derive();
  assert.equal(result.states.length, 4);
  result.states.forEach(assertFloor);
  const later = deriveLearnerTargetStates(allEvents(), deriveEvidence(allEvents()).evidence, { asOf: "2030-01-01T00:00:00Z" });
  assert.deepEqual(later.states.map((state) => ({ ...state, timeContext })), result.states);
});

test("legacy 1..5 mastery is never promoted into canonical state or a probability", () => {
  const baseline = derive(review({ confidence: 1 }));
  for (const confidence of [2, 3, 4, 5]) assert.deepEqual(derive(review({ confidence })), baseline);
});

test("workflow completion cannot refresh learner evidence recency", () => {
  const learningEvents = interview().filter((event) => event.kind === "interview.evaluated");
  const completionEvents = interview(30, "evaluation-1", "2026-10-03T08:00:00Z")
    .filter((event) => event.kind === "interview.completed");
  assert.deepEqual(derive([...learningEvents, ...completionEvents]), derive(learningEvents));
});

test("unknown source occurrence remains null; a known date stays a civil date", () => {
  for (const source of [review, knowledge]) {
    const unknown = source({ reviewedAt: "" });
    const result = derive(unknown);
    assert.equal(result.states.length, 1);
    assert.equal(result.states[0].lastEvidenceAt, null);
    assert.deepEqual(result.diagnostics, []);
    const known = source({ id: "known", reviewedAt: "2026-10-01" });
    assert.deepEqual(derive([...unknown, ...known]).states[0].lastEvidenceAt, { value: "2026-10-01", precision: "date" });
  }
});

test("same target groups Evidence, different IDs and namespaces never pool; newest date is stable", () => {
  const events = [...review({ id: "first", reviewedAt: "2026-10-01" }), ...review({ id: "latest" }),
    ...review({ id: "other", mistakeId: "target-2" }), ...knowledge()];
  const result = derive(events);
  assert.equal(result.states.length, 3);
  assert.deepEqual(result.states.map((state) => [state.target.category, state.target.id, state.sourceEvidenceIds.length]),
    [["knowledge", "target-1", 1], ["mistake", "target-1", 2], ["mistake", "target-2", 1]]);
  assert.deepEqual(result.states[1].lastEvidenceAt, { value: "2026-10-02", precision: "date" });
  assert.deepEqual(result, derive([...events].reverse()));
});

test("instant ordering uses actual offsets and preserves the source value; equal instants have a lexical tie break", () => {
  const first = interview(30, "early", "2026-10-02T16:30:00+09:00");
  const latest = interview(60, "late", "2026-10-02T08:00:00Z");
  assert.deepEqual(derive([...first, ...latest]).states[0].lastEvidenceAt, { value: "2026-10-02T08:00:00Z", precision: "instant" });
  const equal = interview(60, "equivalent", "2026-10-02T16:00:00+08:00");
  const events = [...first, ...latest, ...equal];
  assert.deepEqual(derive(events).states[0].lastEvidenceAt, { value: "2026-10-02T08:00:00Z", precision: "instant" });
  assert.deepEqual(derive(events), derive([...events].reverse()));
});

test("a forged mixed-precision occurrence cannot invent an instant or pass existing Event authority", () => {
  const events = review();
  const evidence = deriveEvidence(events).evidence;
  const forged = { ...events[0], occurredAt: instant, provenance: { ...events[0].provenance, timePrecision: "instant" } } as LearningEventV1;
  const result = derive([forged], evidence);
  assert.deepEqual(result.states, []);
  assert.ok(result.diagnostics.some((item) => item.code === "invalid_provenance"));
});

test("identical duplicate Events/Evidence collapse, including reordered object properties", () => {
  const events = allEvents();
  const evidence = deriveEvidence(events).evidence;
  const reorderedEvents = events.map((event) => Object.fromEntries(Object.entries(event).reverse()) as LearningEventV1);
  const reorderedEvidence = evidence.map((item) => ({ ...Object.fromEntries(Object.entries(item).reverse()),
    provenance: Object.fromEntries(Object.entries(item.provenance).reverse()) }) as EvidenceRecordV1);
  assert.deepEqual(derive([...events, ...structuredClone(events), ...reorderedEvents],
    [...evidence, ...structuredClone(evidence), ...reorderedEvidence]), derive(events, evidence));
});

test("ordering never changes bytes, diagnostics, source IDs or default references", () => {
  const events = allEvents();
  const evidence = deriveEvidence(events).evidence;
  const baseline = derive(events, evidence);
  for (const eventOrder of [events, [...events].reverse(), [...events.slice(2), ...events.slice(0, 2)]]) {
    for (const evidenceOrder of [evidence, [...evidence].reverse()]) {
      assert.deepEqual(derive(eventOrder, evidenceOrder), baseline);
      assert.equal(JSON.stringify(derive(eventOrder, evidenceOrder)), JSON.stringify(baseline));
    }
  }
  for (const state of baseline.states) {
    assertFloor(state);
    assert.deepEqual(state.sourceEvidenceIds, state.sourceEvidenceIds.toSorted(compareLearningEventText));
    assert.equal(new Set(state.sourceEvidenceIds).size, state.sourceEvidenceIds.length);
  }
});

test("conflicting Event diagnostics survive; stale supplied Evidence rejects the complete scope", () => {
  const events = review();
  const conflict = review({ result: "wrong" })[0];
  const other = knowledge();
  const evidence = deriveEvidence([...events, ...other]).evidence;
  const result = derive([...events, conflict, ...other], evidence);
  assert.deepEqual(result.states, []);
  assert.ok(result.diagnostics.some((item) => item.code === "conflicting_event_identity"));
  assert.deepEqual(result, derive([...other, conflict, ...events], [...evidence].reverse()));
  const exact = derive([...events, conflict, ...other]);
  assert.equal(exact.states.length, 1, "只提供重算后完整 canonical Evidence 时无关 target 可保留");
  assert.equal(exact.states[0].target.category, "knowledge");
  assert.deepEqual(exact.diagnostics, [{ code: "conflicting_event_identity", sourceEventId: events[0].id, sourceEvidenceId: null }]);
});

const mutations: Array<[string, (item: EvidenceRecordV1) => EvidenceRecordV1]> = [
  ["class", (item) => ({ ...item, evidenceClass: "human_assessment" })],
  ["strength", (item) => ({ ...item, strength: "strong" })],
  ["limitations", (item) => ({ ...item, provenance: { ...item.provenance, limitations: [] } })],
  ["provenance", (item) => ({ ...item, provenance: { ...item.provenance, modelAuthored: false } })],
  ["assistance", (item) => ({ ...item, assistance: "none" })],
  ["target", (item) => ({ ...item, target: { ...item.target, id: "forged-target" } })],
  ["skill mapping", (item) => ({ ...item, target: { category: "interview_skill", namespace: "rubric", id: "label" } })],
  ["measurement group", (item) => ({ ...item, measurementGroupId: "other" })],
  ["policy version", (item) => ({ ...item, policyVersion: "forged/v1" } as unknown as EvidenceRecordV1)],
  ["outcome", (item) => ({ ...item, outcome: { kind: "self_reported_result", result: "wrong", direction: "refutes" } })],
  ["claim", (item) => ({ ...item, claim: "understanding" })],
  ["record lineage", (item) => ({ ...item, sourceRecordRefs: [{ recordType: "review_attempt", recordId: "forged" }] })],
  ["empty Event lineage", (item) => ({ ...item, sourceEventIds: [] } as unknown as EvidenceRecordV1)],
];
for (const [name, mutate] of mutations) {
  test(`forged Evidence ${name} fails closed, including same-ID conflict in either order`, () => {
    const events = review();
    const evidence = deriveEvidence(events).evidence;
    const canonical = evidence.find((item) => item.claim !== "completion")!;
    const completion = evidence.filter((item) => item.claim === "completion");
    const forged = mutate(structuredClone(canonical));
    const alone = derive(events, [...completion, forged]);
    assert.deepEqual(alone.states, []);
    assert.deepEqual(alone.diagnostics, [{ code: "noncanonical_evidence", sourceEventId: null, sourceEvidenceId: canonical.id }]);
    const conflict = derive(events, [...completion, canonical, forged]);
    assert.deepEqual(conflict.states, []);
    assert.deepEqual(conflict.diagnostics, [{ code: "conflicting_evidence_identity", sourceEventId: null, sourceEvidenceId: canonical.id }]);
    assert.deepEqual(conflict, derive(events, [forged, canonical, ...completion]));
  });
}

test("orphan, substituted or augmented sourceEventIds cannot borrow another Event's authority", () => {
  const events = [...review(), ...knowledge()];
  const evidence = deriveEvidence(events).evidence;
  const item = evidence.find((item) => item.claim === "correctness" && item.target.category === "mistake")!;
  for (const ids of [["orphan"], [events[1].id], [events[0].id, events[1].id]]) {
    const forged = { ...item, sourceEventIds: ids } as EvidenceRecordV1;
    const result = derive(events, evidence.map((candidate) => candidate.id === item.id ? forged : candidate));
    assert.deepEqual(result.states, []);
    assert.equal(result.diagnostics[0].code, ids[0] === "orphan" ? "orphan_evidence" : "noncanonical_evidence");
  }
  assert.deepEqual(derive([], [item]).states, []);
  assert.equal(derive([], [item]).diagnostics[0].code, "orphan_evidence");
});

test("malformed, cyclic and uncomparable Evidence fail closed without leaking content", () => {
  const events = review();
  const item = deriveEvidence(events).evidence.find((item) => item.claim === "correctness")!;
  const cyclic = Object.assign(structuredClone(item), { extra: {} });
  cyclic.extra = cyclic;
  for (const input of [null, { id: "" }, { ...item, outcome: null }, { ...item, strength: Number.NaN },
    { ...item, sourceEventIds: null }, cyclic, { ...item, providerResponse: privateSentinel }]) {
    const result = derive(events, [input as EvidenceRecordV1]);
    assert.deepEqual(result.states, []);
    assert.ok(!JSON.stringify(result).includes(privateSentinel));
  }
  assert.deepEqual(derive(events, [item, cyclic]), derive(events, [cyclic, item]));
  assert.deepEqual(derive(events, [item, cyclic]).states, []);
});

test("invalid time context, including date-only or timezone-less values, fails closed", () => {
  for (const context of [null, {}, { asOf: "" }, { asOf: "2026-10-04" }, { asOf: "2026-10-04T00:00:00" },
    { asOf: "2026-02-30T00:00:00Z" }, { asOf: "2026-10-04T24:00:00Z" }, { asOf: "2026-10-04T00:00:00+24:00" },
    { asOf: privateSentinel }]) {
    const result = deriveLearnerTargetStates(allEvents(), deriveEvidence(allEvents()).evidence, context as LearnerStateTimeContextV1);
    assert.deepEqual(result, { states: [], diagnostics: [{ code: "invalid_time_context", sourceEventId: null, sourceEvidenceId: null }] });
  }
});

test("inputs are immutable and every output target, reference array and time context is detached", () => {
  const events = allEvents();
  const evidence = deriveEvidence(events).evidence;
  const context = { ...timeContext };
  const before = structuredClone({ events, evidence, context });
  freeze(events); freeze(evidence); freeze(context);
  const result = deriveLearnerTargetStates(events, evidence, context);
  assert.deepEqual({ events, evidence, context }, before);
  for (const state of result.states) {
    assert.notEqual(state.target, evidence.find((item) => item.target.id === state.target.id)!.target);
    assert.notEqual(state.timeContext, context);
  }
  result.states[0].sourceEvidenceIds.push("output-mutation");
  result.states[0].promotionEligibility.understanding.candidateEvidenceIds.push("output-mutation");
  result.states[0].promotionEligibility.understanding.candidateMeasurementGroupIds.push("output-mutation");
  result.states[0].promotionEligibility.understanding.blockers.length = 0;
  result.states[0].target.id = "output-mutation";
  result.states[0].timeContext.asOf = "output-mutation";
  assert.deepEqual({ events, evidence, context }, before);
});

test("derivation calls no clock, zero-argument Date constructor, random, locale or global mutable state", (context) => {
  const events = allEvents();
  const evidence = deriveEvidence(events).evidence;
  const expected = derive(events, evidence);
  const fail = () => { throw new Error("clock/random/locale forbidden"); };
  context.mock.method(Date, "now", fail);
  context.mock.method(Math, "random", fail);
  context.mock.method(globalThis.crypto, "randomUUID", fail);
  context.mock.method(String.prototype, "localeCompare", fail);
  const OriginalDate = Date;
  context.mock.method(globalThis, "Date", new Proxy(OriginalDate, {
    construct(target, args) { if (args.length === 0) fail(); return Reflect.construct(target, args); },
    apply() { return fail(); },
  }));
  assert.deepEqual(derive(events, evidence), expected);
  assert.equal(JSON.stringify(derive([...events].reverse(), [...evidence].reverse())), JSON.stringify(expected));
});

test("private-content sentinels in sources, Events and time context never enter state or diagnostics", () => {
  const fields = ["answer", "explanation", "content", "prompt", "options", "teacherProse", "detectedProblem", "confidence",
    "comment", "strengths", "problems", "suggestions", "evaluationEvidence", "questionPrompt", "questionMaterial",
    "transcript", "providerResponse", "reasoning", "credentials", "rawMedia", "traceData", "traceRef"];
  const privateFields = Object.fromEntries(fields.map((key) => [key, privateSentinel]));
  const events = allEvents().map((event) => ({ ...event, ...privateFields,
    payload: { ...event.payload, ...privateFields }, target: { ...event.target, ...privateFields },
    provenance: { ...event.provenance, ...privateFields }, source: { ...event.source, ...privateFields } } as LearningEventV1));
  const evidence = deriveEvidence(events).evidence;
  const result = deriveLearnerTargetStates(events, evidence, { ...timeContext, ...privateFields });
  assert.equal(result.states.length, 4);
  result.states.forEach(assertFloor);
  assert.deepEqual(result.diagnostics, []);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(privateSentinel));
  for (const field of fields) assert.ok(!serialized.includes(`"${field}":`));
});

for (const omittedClaim of ["completion", "correctness"] as const) {
  test(`omitting canonical ${omittedClaim} Evidence rejects all states, including unrelated targets`, () => {
    const events = [...review(), ...knowledge()];
    const evidence = deriveEvidence(events).evidence;
    const omitted = evidence.find((item) => item.claim === omittedClaim && item.target.category === "mistake")!;
    assert.deepEqual(derive(events, evidence.filter((item) => item.id !== omitted.id)), {
      states: [], diagnostics: [{ code: "incomplete_evidence_scope", sourceEventId: null, sourceEvidenceId: omitted.id }],
    });
  });
}

test("omitting contrary Evidence cannot select only a favorable history", () => {
  const events = [...review({ id: "pass" }), ...review({ id: "fail", result: "wrong" }), ...knowledge()];
  const evidence = deriveEvidence(events).evidence;
  const negative = evidence.find((item) => item.outcome.direction === "refutes")!;
  assert.ok(negative);
  assert.deepEqual(derive(events, evidence.filter((item) => item.id !== negative.id)), {
    states: [], diagnostics: [{ code: "incomplete_evidence_scope", sourceEventId: null, sourceEvidenceId: negative.id }],
  });
  derive(events, evidence).states.forEach(assertFloor);
});

test("unexpected and conflicting Evidence fail the entire scope even with full valid unrelated Evidence", () => {
  const events = allEvents();
  const evidence = deriveEvidence(events).evidence;
  const item = evidence.find((item) => item.claim === "correctness")!;
  for (const extra of [{ ...item, id: "unexpected-evidence" }, { ...item, strength: "strong" as const }]) {
    const result = derive(events, [...evidence, extra]);
    assert.deepEqual(result.states, []);
    assert.deepEqual(result.diagnostics, [{ code: extra.id === item.id ? "conflicting_evidence_identity" : "noncanonical_evidence",
      sourceEventId: null, sourceEvidenceId: extra.id }]);
    assert.deepEqual(result, derive([...events].reverse(), [extra, ...evidence].reverse()));
  }
});

for (const [name, at, usable] of [
  ["before", "2026-10-04T08:59:59.999+08:00", true],
  ["exactly at", timeContext.asOf, true],
  ["same instant with another offset", "2026-10-04T01:00:00Z", true],
  ["after", "2026-10-04T01:00:00.001Z", false],
] as const) {
  test(`instant Evidence ${name} asOf uses actual offset ordering for targets, candidates and recency`, () => {
    const events = interview(100, "temporal", at);
    const evidence = deriveEvidence(events).evidence;
    const result = derive(events, evidence);
    if (usable) {
      assert.equal(result.states.length, 1);
      assertFloor(result.states[0]);
      assert.deepEqual(result.states[0].lastEvidenceAt, { value: at, precision: "instant" });
      assert.deepEqual(result.diagnostics, []);
    } else {
      assert.deepEqual(result.states, []);
      assert.equal(result.diagnostics.length, evidence.length);
      assert.ok(result.diagnostics.every((item) => item.code === "evidence_after_as_of"));
      assert.deepEqual(new Set(result.diagnostics.map((item) => item.sourceEvidenceId)), new Set(evidence.map((item) => item.id)));
    }
    assert.deepEqual(derive([...events].reverse(), [...evidence].reverse()), result);
  });
}

test("future Evidence cannot enter an existing target's sources, eligibility or lastEvidenceAt", () => {
  const past = interview(0, "past", "2026-10-03T08:00:00Z");
  const future = interview(100, "future", "2026-10-04T01:00:00.001Z");
  const events = [...past, ...future];
  const evidence = deriveEvidence(events).evidence;
  const result = derive(events, evidence);
  assert.deepEqual(result.states, derive(past).states);
  assert.ok(result.diagnostics.every((item) => item.code === "evidence_after_as_of"));
  assert.equal(result.diagnostics.length, deriveEvidence(future).evidence.length);
  assert.deepEqual(result, derive([...events].reverse(), [...evidence].reverse()));
  // 完整 scope 校验在 cutoff 前；调用方不能用时间过滤隐藏未提供的 Evidence。
  const incomplete = derive(events, deriveEvidence(past).evidence);
  assert.deepEqual(incomplete.states, []);
  assert.ok(incomplete.diagnostics.every((item) => item.code === "incomplete_evidence_scope"));
});

for (const source of [review, knowledge]) {
  for (const [at, usable] of [["2026-10-03", true], ["2026-10-04", true], ["2026-10-05", false]] as const) {
    test(`${source.name} civil date ${at} compares only with the asOf civil date`, () => {
      const events = source({ reviewedAt: at });
      const context = { asOf: "2026-10-04T00:00:00+14:00" };
      const result = deriveLearnerTargetStates(events, deriveEvidence(events).evidence, context);
      if (usable) {
        assert.equal(result.states.length, 1);
        assert.deepEqual(result.states[0].lastEvidenceAt, { value: at, precision: "date" });
        assert.deepEqual(result.diagnostics, []);
        assert.equal(result.states[0].lastVerifiedAt, null);
      } else {
        assert.deepEqual(result.states, []);
        assert.ok(result.diagnostics.every((item) => item.code === "evidence_after_as_of"));
        assert.equal(result.diagnostics.length, 2);
      }
      assert.deepEqual(result, deriveLearnerTargetStates([...events].reverse(), [...deriveEvidence(events).evidence].reverse(), context));
    });
  }
}

test("unknown-time canonical candidates remain non-temporal without synthesizing occurrence", () => {
  const events = review({ reviewedAt: "" });
  const evidence = deriveEvidence(events).evidence;
  const result = deriveLearnerTargetStates(events, evidence, { asOf: "2000-01-01T00:00:00Z" });
  assert.equal(result.states.length, 1);
  assert.equal(result.states[0].lastEvidenceAt, null);
  assert.equal(result.states[0].lastVerifiedAt, null);
  assert.ok(Object.values(result.states[0].promotionEligibility).every((item) => item.status === "blocked"));
  assert.deepEqual(result.states[0].promotionEligibility.understanding.candidateEvidenceIds,
    evidence.filter((item) => item.claim !== "completion").map((item) => item.id));
  assert.deepEqual(result.diagnostics, []);
});

test("repeated model-authored quizzes and self-report history never establish retention or transfer", () => {
  const events = [...tutoring(true, "2026-10-01T08:00:00Z"), ...tutoring(true, "2026-10-02T08:00:00Z"),
    ...tutoring(true, "2026-10-03T08:00:00Z"), ...review({ id: "first", reviewedAt: "2026-09-01" }),
    ...review({ id: "second", reviewedAt: "2026-10-01" })];
  const result = derive(events);
  assert.equal(result.states.length, 2);
  result.states.forEach(assertFloor);
  assert.deepEqual(result.diagnostics, []);
  const quiz = result.states.find((state) => state.target.category === "question")!;
  assert.equal(quiz.promotionEligibility.retention.candidateMeasurementGroupIds.length, 3);
  assert.ok(quiz.promotionEligibility.retention.blockers.includes("missing_delayed_verification"));
  assert.ok(quiz.promotionEligibility.transfer.blockers.includes("missing_transfer_context"));
});
