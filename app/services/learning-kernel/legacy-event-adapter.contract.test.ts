import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import type { LearningEventV1 } from "../../types/domains/learning-kernel.ts";
import type { Attempt } from "../../types/domains/review.ts";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import {
  compareLearningEvents,
  legacyLearningEventId,
  legacyLearningEventTime,
  MAX_LEARNING_EVENT_ID_LENGTH,
} from "./learning-event.ts";
import {
  adaptInterviewEvaluation,
  adaptKnowledgeAttempt,
  adaptReviewAttempt,
  adaptTutoringMicroAssessment,
  projectLegacyLearningEvents,
  type LegacyLearningEventFacts,
} from "./legacy-event-adapter.ts";

const instant = "2026-10-02T08:00:00.000Z";
const later = "2026-10-03T08:00:00.000Z";
const privateText = "PRIVATE-CONTENT-MUST-NOT-LEAK";

function review(patch: Partial<Attempt> = {}): Attempt {
  return { id: "attempt-1", mistakeId: "mistake-1", result: "correct", confidence: 4, durationSec: 12, reviewedAt: "2026-10-02", ...patch };
}

function knowledge(patch: Partial<KnowledgeAttempt> = {}): KnowledgeAttempt {
  return { id: "knowledge-attempt-1", knowledgeId: "knowledge-1", result: "uncertain", confidence: 2, reviewedAt: "2026-10-02", ...patch };
}

function tutoring(patch: Partial<TutoringTurn> = {}): TutoringTurn {
  return {
    id: "turn-1", sessionId: "tutor-session-1", speaker: "ai_tutor", content: privateText,
    confidence: 0.99, detectedProblem: privateText, frameDescription: privateText,
    observation: { capturedAt: instant, source: "camera", summary: privateText, confidence: 0.99 },
    microAssessment: {
      questions: [
        { id: "micro-1", prompt: privateText, options: [privateText, privateText, privateText], correctOptionIndex: 1, explanation: privateText },
        { id: "micro-2", prompt: privateText, options: [privateText, privateText, privateText], correctOptionIndex: 0, explanation: privateText },
      ],
      selections: [1, 2], correctCount: 1, completedAt: instant,
    },
    createdAt: "2026-10-01T08:00:00.000Z", ...patch,
  };
}

function interviewSession(patch: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: "interview-session-1", questionId: "interview-question-1", type: "structured",
    title: privateText, questionPrompt: privateText, questionMaterial: privateText, transcriptText: privateText,
    status: "evaluated", stage: "evaluated", startedAt: "2026-10-01T08:00:00.000Z", completedAt: instant,
    totalDurationSec: 120, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: instant, ...patch,
  };
}

function evaluation(patch: Partial<InterviewEvaluation> = {}): InterviewEvaluation {
  return {
    id: "evaluation-1", sessionId: "interview-session-1", type: "structured", totalScore: 70,
    dimensions: [{ name: "表达能力", score: 15, maxScore: 20, comment: privateText }],
    strengths: [privateText], problems: [privateText], suggestions: [privateText], evidence: [privateText],
    createdAt: instant, updatedAt: instant, ...patch,
  };
}

function allFacts(): LegacyLearningEventFacts {
  return {
    reviewAttempts: [review(), review({ id: "attempt-2", reviewedAt: "2026-10-01" })],
    knowledgeAttempts: [knowledge(), knowledge({ id: "knowledge-attempt-2", result: "wrong" })],
    tutoringTurns: [tutoring(), tutoring({ id: "turn-2" }), tutoring({ id: "unsubmitted", microAssessment: undefined })],
    interviewSessions: [interviewSession(), interviewSession({ id: "interview-session-2" })],
    interviewEvaluations: [evaluation(), evaluation({ id: "evaluation-2", sessionId: "interview-session-2" })],
  };
}

function questionEvents(turn: TutoringTurn): LearningEventV1<"assessment.submitted">[] {
  return adaptTutoringMicroAssessment(turn).events.filter((event) => event.kind === "assessment.submitted");
}

for (const result of ["correct", "uncertain", "wrong"] as const) {
  test(`Review preserves ${result} as self-report and legacy mastery`, () => {
    const output = adaptReviewAttempt(review({ result }));
    assert.equal(output.events.length, 1);
    const event = output.events[0];
    assert.equal(event.kind, "review.completed");
    assert.deepEqual(event.payload, { reportedResult: result, legacyMasteryAfter: 4, durationSec: 12 });
    assert.deepEqual(event.target, { category: "mistake", namespace: "mistake", id: "mistake-1" });
    assert.equal(event.attemptId, "attempt-1");
    assert.equal(event.occurredAt, "2026-10-02");
    assert.equal(event.recordedAt, null);
    assert.equal(event.provenance.timePrecision, "date");
    assert.equal(event.provenance.modality, "self_report");
    assert.equal(event.provenance.scoringMethod, "self_report");
    assert.equal(event.provenance.modelAuthored, "unknown");
    assert.equal(event.provenance.history, "complete_record");
    assert.deepEqual(event.source.records, [{ recordType: "review_attempt", recordId: "attempt-1" }]);
    assert.deepEqual(output.diagnostics, []);
  });

  test(`Knowledge preserves ${result} without an objective knowledge claim`, () => {
    const output = adaptKnowledgeAttempt(knowledge({ result }));
    assert.equal(output.events.length, 1);
    const event = output.events[0];
    assert.equal(event.kind, "knowledge_review.completed");
    assert.deepEqual(event.payload, { reportedResult: result, legacyMasteryAfter: 2 });
    assert.deepEqual(event.target, { category: "knowledge", namespace: "knowledge", id: "knowledge-1" });
    assert.equal(event.occurredAt, "2026-10-02");
    assert.equal(event.recordedAt, null);
    assert.equal(event.provenance.timePrecision, "date");
    assert.equal(event.provenance.scoringMethod, "self_report");
    assert.equal(event.provenance.modelAuthored, "unknown");
  });
}

test("review duration remains optional, including a real zero", () => {
  assert.deepEqual(adaptReviewAttempt(review({ durationSec: undefined })).events[0].payload, { reportedResult: "correct", legacyMasteryAfter: 4 });
  assert.equal((adaptReviewAttempt(review({ durationSec: 0 })).events[0] as LearningEventV1<"review.completed">).payload.durationSec, 0);
});

test("missing targets and invalid source identity remain explicit", () => {
  for (const output of [adaptReviewAttempt(review({ mistakeId: "" })), adaptKnowledgeAttempt(knowledge({ knowledgeId: " " }))]) {
    assert.deepEqual(output.events, []);
    assert.equal(output.diagnostics[0].code, "missing_target");
  }
  const invalid = adaptReviewAttempt(review({ id: "x".repeat(257) }));
  assert.deepEqual(invalid.events, []);
  assert.deepEqual(invalid.diagnostics, [{ code: "unsupported_source", source: { recordType: "review_attempt", recordId: null } }]);
});

test("malformed self-report values do not silently normalize", () => {
  for (const patch of [{ confidence: NaN }, { confidence: 100 }, { durationSec: -1 }, { reviewedAt: "2026-02-30" }, { reviewedAt: instant }]) {
    const output = adaptReviewAttempt(review(patch));
    assert.deepEqual(output.events, []);
    assert.equal(output.diagnostics[0].code, "inconsistent_source");
  }
});

test("source time validation keeps unknowns and precision without a clock", () => {
  assert.deepEqual(legacyLearningEventTime("2024-02-29"), { occurredAt: "2024-02-29", timePrecision: "date" });
  assert.deepEqual(legacyLearningEventTime(instant), { occurredAt: instant, timePrecision: "instant" });
  for (const value of [undefined, "", "2025-02-29", "2026-02-30T08:00:00.000Z", "2026-10-02T08:00:00", "2026-10-02T24:00:00Z"]) {
    assert.deepEqual(legacyLearningEventTime(value), { occurredAt: null, timePrecision: "unknown" });
  }
  const event = adaptReviewAttempt(review({ reviewedAt: "" })).events[0];
  assert.equal(event.occurredAt, null);
  assert.equal(event.recordedAt, null);
  assert.equal(event.provenance.timePrecision, "unknown");
});

test("ordinary tutoring turns without micro-assessments produce no events or diagnostics", () => {
  for (const speaker of ["ai_tutor", "student", "system"] as const) {
    assert.deepEqual(adaptTutoringMicroAssessment(tutoring({ speaker, microAssessment: undefined })), { events: [], diagnostics: [] });
  }
});

test("aggregate projection ignores ordinary student and system turns without micro-assessments", () => {
  const ordinaryTurns = (["student", "system"] as const).map((speaker) => tutoring({ id: `${speaker}-turn`, speaker, microAssessment: undefined }));
  assert.deepEqual(projectLegacyLearningEvents({ tutoringTurns: ordinaryTurns }), { events: [], diagnostics: [] });
  assert.deepEqual(projectLegacyLearningEvents({ tutoringTurns: [tutoring(), ...ordinaryTurns] }), projectLegacyLearningEvents({ tutoringTurns: [tutoring()] }));
});

test("non-tutor turns containing a micro-assessment fail closed even when incomplete", () => {
  for (const speaker of ["student", "system"] as const) {
    for (const microAssessment of [tutoring().microAssessment!, { questions: [] }]) {
      assert.deepEqual(adaptTutoringMicroAssessment(tutoring({ speaker, microAssessment })), {
        events: [], diagnostics: [{ code: "unsupported_source", source: { recordType: "tutoring_turn", recordId: "turn-1" } }],
      });
    }
  }
});

test("existing but incomplete micro-assessments have no submitted events", () => {
  const assessment = tutoring().microAssessment!;
  for (const microAssessment of [{ questions: [] }, { questions: assessment.questions },
    { ...assessment, selections: undefined }, { ...assessment, correctCount: undefined }, { ...assessment, completedAt: undefined }]) {
    const output = adaptTutoringMicroAssessment(tutoring({ microAssessment }));
    assert.deepEqual(output.events, []);
    assert.equal(output.diagnostics[0].code, "incomplete_submission");
  }
});

test("submitted micro-assessment emits one event per real question", () => {
  const output = adaptTutoringMicroAssessment(tutoring());
  const events = questionEvents(tutoring());
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.target), [
    { category: "question", namespace: "tutoring_micro_question", id: "turn-1:micro-1" },
    { category: "question", namespace: "tutoring_micro_question", id: "turn-1:micro-2" },
  ]);
  assert.deepEqual(events.map((event) => event.payload), [
    { selectedOptionIndex: 1, suppliedCorrectOptionIndex: 1, matchesSuppliedKey: true, assessmentQuestionCount: 2, submittedCorrectCount: 1, questionOrdinal: 1 },
    { selectedOptionIndex: 2, suppliedCorrectOptionIndex: 0, matchesSuppliedKey: false, assessmentQuestionCount: 2, submittedCorrectCount: 1, questionOrdinal: 2 },
  ]);
  for (const event of events) {
    assert.equal(event.sessionId, "tutor-session-1");
    assert.equal(event.occurredAt, instant);
    assert.equal(event.recordedAt, null);
    assert.equal(event.provenance.timePrecision, "instant");
    assert.equal(event.provenance.modality, "selection");
    assert.equal(event.provenance.modelAuthored, true);
    assert.equal(event.provenance.keySource, "model_authored");
    assert.equal(event.provenance.scoringMethod, "option_key_comparison");
    assert.equal(event.provenance.history, "current_projection");
  }
  assert.equal(output.diagnostics[0].code, "history_not_recoverable");
});

test("micro question identity includes the turn and escapes ambiguous separators", () => {
  assert.notEqual(questionEvents(tutoring())[0].target.id, questionEvents(tutoring({ id: "turn-2" }))[0].target.id);
  const left = tutoring({ id: "turn:a" });
  const right = tutoring({ id: "turn" });
  right.microAssessment!.questions[0].id = "a:micro-1";
  assert.notEqual(questionEvents(left)[0].target.id, questionEvents(right)[0].target.id);
});

test("micro assessment rejects inconsistent choices, keys, scores and question IDs", () => {
  const mutations: Array<(turn: TutoringTurn) => void> = [
    (turn) => { turn.microAssessment!.selections = [1]; },
    (turn) => { turn.microAssessment!.selections = [1, 99]; },
    (turn) => { turn.microAssessment!.selections = [1, 0.5]; },
    (turn) => { turn.microAssessment!.correctCount = 2; },
    (turn) => { turn.microAssessment!.questions[0].correctOptionIndex = -1; },
    (turn) => { turn.microAssessment!.questions[0].options = []; },
    (turn) => { turn.microAssessment!.questions[1].id = "micro-1"; },
    (turn) => { turn.microAssessment!.completedAt = "2026-10-02"; },
  ];
  for (const mutate of mutations) {
    const turn = tutoring();
    mutate(turn);
    const output = adaptTutoringMicroAssessment(turn);
    assert.deepEqual(output.events, []);
    assert.equal(output.diagnostics[0].code, "inconsistent_source");
  }
  const missing = tutoring();
  missing.microAssessment!.questions[0].id = "";
  assert.equal(adaptTutoringMicroAssessment(missing).diagnostics[0].code, "missing_target");
});

test("model confidence and content do not affect micro event identity or facts", () => {
  const turn = tutoring({ confidence: 0.01, content: "different prose" });
  turn.microAssessment!.questions[0].prompt = "different prompt";
  turn.microAssessment!.questions[0].options[0] = "different option text";
  assert.deepEqual(adaptTutoringMicroAssessment(turn), adaptTutoringMicroAssessment(tutoring()));
  assert.equal(adaptTutoringMicroAssessment(tutoring({ speaker: "student" })).diagnostics[0].code, "unsupported_source");
});

test("malformed or sparse assessment rows return diagnostics without throwing", () => {
  for (const questions of [new Array<unknown>(2), [null, tutoring().microAssessment!.questions[1]]]) {
    const turn = tutoring();
    turn.microAssessment!.questions = questions as NonNullable<TutoringTurn["microAssessment"]>["questions"];
    const output = adaptTutoringMicroAssessment(turn);
    assert.deepEqual(output.events, []);
    assert.equal(output.diagnostics[0].code, "inconsistent_source");
  }
  const output = adaptInterviewEvaluation(evaluation({ dimensions: new Array<InterviewEvaluation["dimensions"][number]>(1) }), interviewSession());
  assert.deepEqual(output.events, []);
  assert.equal(output.diagnostics[0].code, "inconsistent_source");
});

test("current micro submission revision reflects timestamp, selections and supplied key", () => {
  const originalIds = questionEvents(tutoring()).map((event) => event.id);
  const changedTime = tutoring();
  changedTime.microAssessment!.completedAt = later;
  const changedSelection = tutoring();
  changedSelection.microAssessment!.selections = [2, 0]; // 同一总分仍是不同可观察提交。
  const changedKey = tutoring();
  changedKey.microAssessment!.questions[0].correctOptionIndex = 0;
  changedKey.microAssessment!.correctCount = 0;
  for (const turn of [changedTime, changedSelection, changedKey]) {
    const output = adaptTutoringMicroAssessment(turn);
    assert.equal(output.events.length, 2);
    assert.ok(output.events.every((event) => !originalIds.includes(event.id)));
    assert.equal(output.diagnostics[0].code, "history_not_recoverable");
  }
});

test("interview workflow completion and model judgment remain distinct", () => {
  const output = adaptInterviewEvaluation(evaluation(), interviewSession());
  assert.deepEqual(output.events.map((event) => event.kind), ["interview.completed", "interview.evaluated"]);
  assert.notEqual(output.events[0].id, output.events[1].id);
  for (const event of output.events) {
    assert.deepEqual(event.target, { category: "question", namespace: "interview_question", id: "interview-question-1" });
    assert.equal(event.occurredAt, instant);
    assert.equal(event.recordedAt, null);
    assert.equal(event.provenance.history, "current_projection");
    assert.deepEqual(event.source.records, [
      { recordType: "interview_evaluation", recordId: "evaluation-1" },
      { recordType: "interview_session", recordId: "interview-session-1" },
    ]);
  }
  assert.deepEqual(output.events[0].payload, { workflowStatus: "evaluated" });
  assert.equal(output.events[0].provenance.modality, "unknown");
  assert.equal(output.events[0].provenance.scoringMethod, "none");
  assert.equal(output.events[1].provenance.modality, "model_assessment");
  assert.equal(output.events[1].provenance.modelAuthored, true);
  assert.equal(output.events[1].provenance.scoringMethod, "model_rubric");
  assert.deepEqual(output.events[1].payload, { totalScore: 70, evaluationType: "structured", dimensions: [{ name: "表达能力", score: 15, maxScore: 20 }] });
  assert.equal(output.diagnostics[0].code, "history_not_recoverable");
});

test("interview dimensions retain persisted denominators while private evaluation prose stays excluded", () => {
  const record = evaluation({ dimensions: [
    { name: "表达能力", score: 15, maxScore: 20, comment: privateText },
    { name: "分析能力", score: 15, maxScore: 30, comment: privateText },
  ] });
  const session = interviewSession();
  for (const output of [adaptInterviewEvaluation(record, session), projectLegacyLearningEvents({ interviewEvaluations: [record], interviewSessions: [session] })]) {
    const event = output.events.find((event) => event.kind === "interview.evaluated");
    assert.ok(event);
    assert.deepEqual(event.payload, { totalScore: 70, evaluationType: "structured", dimensions: [
      { name: "表达能力", score: 15, maxScore: 20 },
      { name: "分析能力", score: 15, maxScore: 30 },
    ] });
    const serialized = JSON.stringify(output);
    assert.ok(!serialized.includes(privateText));
    assert.doesNotMatch(serialized, /"(?:comment|strengths|problems|suggestions|evidence)":/);
  }
});

test("interview mismatch, cancellation, missing target and malformed assessment fail closed", () => {
  for (const session of [interviewSession({ id: "different" }), interviewSession({ status: "active" }),
    interviewSession({ status: "cancelled" }), interviewSession({ type: "structured_group" }), interviewSession({ completedAt: later })]) {
    const output = adaptInterviewEvaluation(evaluation(), session);
    assert.deepEqual(output.events, []);
    assert.equal(output.diagnostics[0].code, "inconsistent_source");
  }
  for (const record of [evaluation({ totalScore: NaN }), evaluation({ totalScore: 101 }), evaluation({ createdAt: "2026-10-02" }),
    evaluation({ dimensions: [{ name: "表达能力", score: 99, maxScore: 20, comment: privateText }] })]) {
    assert.deepEqual(adaptInterviewEvaluation(record, interviewSession()).events, []);
  }
  assert.equal(adaptInterviewEvaluation(evaluation()).diagnostics[0].code, "unsupported_source");
  assert.equal(adaptInterviewEvaluation(evaluation(), interviewSession({ questionId: "" })).diagnostics[0].code, "missing_target");
  assert.deepEqual(projectLegacyLearningEvents({ interviewSessions: [interviewSession({ status: "cancelled" })] }).events, []);
});

test("missing interview completion time stays unknown and reevaluation projects only supplied record", () => {
  const output = adaptInterviewEvaluation(evaluation(), interviewSession({ completedAt: undefined }));
  assert.equal(output.events[0].occurredAt, null);
  assert.equal(output.events[0].provenance.timePrecision, "unknown");
  assert.equal(output.events[1].occurredAt, instant);
  const newer = projectLegacyLearningEvents({ interviewEvaluations: [evaluation({ id: "evaluation-2", createdAt: later, updatedAt: later })],
    interviewSessions: [interviewSession({ completedAt: later })] });
  assert.equal(newer.events.length, 2);
  assert.ok(newer.events.every((event) => event.source.records[0].recordId === "evaluation-2"));
});

test("escaped structured IDs are stable, collision resistant and bounded", () => {
  const ref = { recordType: "review_attempt" as const, recordId: "a/b:%中文", revision: "revision/1" };
  const id = legacyLearningEventId(ref, "review.completed")!;
  assert.equal(id, legacyLearningEventId(ref, "review.completed"));
  assert.ok(id.length <= MAX_LEARNING_EVENT_ID_LENGTH);
  assert.notEqual(id, legacyLearningEventId({ ...ref, recordId: "a/b", revision: ":%中文/revision/1" }, "review.completed"));
  assert.notEqual(id, legacyLearningEventId({ ...ref, recordType: "knowledge_attempt" }, "review.completed"));
  assert.equal(legacyLearningEventId({ ...ref, revision: "x".repeat(4097) }, "review.completed"), null);
  assert.equal(legacyLearningEventId({ ...ref, revision: "中".repeat(4096) }, "review.completed"), null);
  assert.equal(legacyLearningEventId({ ...ref, recordId: "\ud800" }, "review.completed"), null);
});

test("oversized observable assessment revision is unsupported without partial events", () => {
  const turn = tutoring();
  turn.microAssessment!.questions = Array.from({ length: 100 }, (_, index) => ({ ...turn.microAssessment!.questions[0], id: `q-${index}-${"x".repeat(100)}` }));
  turn.microAssessment!.selections = Array(100).fill(1);
  turn.microAssessment!.correctCount = 100;
  const output = adaptTutoringMicroAssessment(turn);
  assert.deepEqual(output.events, []);
  assert.equal(output.diagnostics[0].code, "unsupported_source");
});

test("same input twice is byte/deep equal and never uses random or current clock", (context) => {
  const fail = () => { throw new Error("runtime randomness/clock is forbidden"); };
  context.mock.method(Math, "random", fail);
  context.mock.method(Date, "now", fail);
  context.mock.method(globalThis.crypto, "randomUUID", fail);
  const input = allFacts();
  const first = projectLegacyLearningEvents(input);
  const second = projectLegacyLearningEvents(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("shuffled aggregate inputs normalize events and diagnostics identically", () => {
  const input = allFacts();
  const shuffled = Object.fromEntries(Object.entries(input).map(([key, values]) => [key, [...values].reverse()]));
  const original = projectLegacyLearningEvents(input);
  assert.equal(original.events.length, 12);
  assert.deepEqual(projectLegacyLearningEvents(shuffled), original);
  assert.deepEqual(original.events, original.events.toSorted(compareLearningEvents));
});

test("projection does not mutate source records", () => {
  const input = allFacts();
  const before = structuredClone(input);
  function freeze(value: unknown) {
    if (!value || typeof value !== "object") return;
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  freeze(input);
  projectLegacyLearningEvents(input);
  assert.deepEqual(input, before);
});

test("duplicate or conflicting event identities do not become extra measurements", () => {
  assert.equal(projectLegacyLearningEvents({ reviewAttempts: [review(), review()] }).events.length, 1);
  const first = projectLegacyLearningEvents({ reviewAttempts: [review(), review({ result: "wrong" })] });
  const second = projectLegacyLearningEvents({ reviewAttempts: [review({ result: "wrong" }), review()] });
  assert.deepEqual(first, second);
  assert.deepEqual(first.events, []);
  assert.equal(first.diagnostics[0].code, "inconsistent_source");
});

test("ambiguous interview session ownership does not pick an input-order winner", () => {
  const input = { interviewEvaluations: [evaluation()], interviewSessions: [interviewSession(), interviewSession({ questionId: "different-question" })] };
  const output = projectLegacyLearningEvents(input);
  assert.deepEqual(output.events, []);
  assert.equal(output.diagnostics[0].code, "inconsistent_source");
  assert.deepEqual(projectLegacyLearningEvents({ ...input, interviewSessions: [...input.interviewSessions].reverse() }), output);
});

test("two conflicting snapshots of the same tutoring turn cannot invent overwritten history", () => {
  const newer = tutoring();
  newer.microAssessment!.completedAt = later;
  const output = projectLegacyLearningEvents({ tutoringTurns: [tutoring(), newer] });
  assert.deepEqual(output.events, []);
  assert.ok(output.diagnostics.some((item) => item.code === "inconsistent_source"));
  assert.deepEqual(projectLegacyLearningEvents({ tutoringTurns: [newer, tutoring()] }), output);
});

test("aggregate refuses multiple current evaluation identities for one interview session", () => {
  const input = { interviewSessions: [interviewSession()], interviewEvaluations: [evaluation(), evaluation({ id: "evaluation-2" })] };
  const output = projectLegacyLearningEvents(input);
  assert.deepEqual(output.events, []);
  assert.ok(output.diagnostics.every((item) => item.code === "inconsistent_source"));
  assert.deepEqual(projectLegacyLearningEvents({ ...input, interviewEvaluations: [...input.interviewEvaluations].reverse() }), output);
});

test("serialized events and diagnostics minimize all private fixture content", () => {
  const input = allFacts();
  input.reviewAttempts = [Object.assign(review(), { stem: privateText, answer: privateText, explanation: privateText, mistake: { content: privateText } })];
  input.knowledgeAttempts = [Object.assign(knowledge(), { title: privateText, content: privateText, knowledgeBody: privateText })];
  input.tutoringTurns = [Object.assign(tutoring(), { frameDataUrl: privateText, providerResponse: privateText, reasoning: privateText })];
  const output = projectLegacyLearningEvents(input);
  const serialized = JSON.stringify(output);
  assert.ok(output.events.length > 0);
  assert.ok(!serialized.includes(privateText));
  assert.doesNotMatch(serialized, /objectiveCorrect|groundTruthCorrect|independentlyVerified|assistance|confidence|masteryClaim|traceRef|transcript|strengths|suggestions|explanation|prompt|options|reasoning|providerResponse/);
  const invalid = tutoring();
  invalid.microAssessment!.correctCount = 99;
  assert.ok(!JSON.stringify(adaptTutoringMicroAssessment(invalid)).includes(privateText));
});
