import assert from "node:assert/strict";
import test from "node:test";
import type { Attempt } from "../../types/domains/review.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import type { EvidenceRecordV1, LearningEventV1 } from "../../types/domains/learning-kernel.ts";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { projectLegacyLearningEvents } from "./legacy-event-adapter.ts";
import { isInterviewModelRubricEvidence, isLegacySelfReportResultEvidence, isTutoringSuppliedKeyEvidence,
  projectEvaluatedInterviewCompatibility, projectLegacyInterviewCompatibility, projectCompletedTutoringCompatibility,
  projectLegacyResultCompatibility, projectLegacyTutoringCompatibility } from "./compatibility-snapshot.ts";

function interviewFixture(score = 2) {
  const time = "2026-10-02T08:00:00.000Z";
  const evaluation: InterviewEvaluation = {
    id: "evaluation-1", sessionId: "session-1", type: "structured", totalScore: score * 10,
    dimensions: [{ name: "表达", score, maxScore: 10, comment: "legacy comment" },
      { name: "表达", score: 8, maxScore: 10, comment: "second comment" }],
    strengths: [], problems: [], suggestions: [], evidence: [], createdAt: time, updatedAt: time,
  };
  const session: InterviewSession = {
    id: evaluation.sessionId, questionId: "question-1", type: "structured", title: "interview",
    questionPrompt: "", questionMaterial: "", transcriptText: "", status: "evaluated", stage: "evaluated",
    startedAt: time, completedAt: time, totalDurationSec: 0, createdAt: time, updatedAt: time,
  };
  const { events } = projectLegacyLearningEvents({ interviewEvaluations: [evaluation], interviewSessions: [session] });
  return { evaluation, session, events, evidence: deriveEvidence(events).evidence };
}

function projectInterview(fixture: ReturnType<typeof interviewFixture>) {
  return projectEvaluatedInterviewCompatibility(fixture.events, fixture.evidence, [fixture.evaluation], [fixture.session]);
}

test("Interview compatibility preserves model-only inconclusive authority for both low and high scores", () => {
  for (const score of [0, 2, 7, 10]) {
    const fixture = interviewFixture(score);
    const result = projectInterview(fixture);
    assert.deepEqual(result, [{ evaluationId: "evaluation-1", sessionId: "session-1",
      evaluatedAt: fixture.evaluation.createdAt, compatibilityUpdatedAt: fixture.evaluation.updatedAt,
      dimensions: [{ dimensionIndex: 0, name: "表达", score, maxScore: 10, compatibilityComment: "legacy comment" },
        { dimensionIndex: 1, name: "表达", score: 8, maxScore: 10, compatibilityComment: "second comment" }],
      authority: { kind: "legacy_model_assessment_compatibility", evidenceClass: "model_assessment",
        direction: "inconclusive", limitations: ["model_assessment_only", "no_independent_grader"] },
      workflow: { kind: "evaluated", evidenceClass: "workflow_fact" } }]);
    assert.deepEqual(projectLegacyInterviewCompatibility({ interviewEvaluations: [fixture.evaluation], interviewSessions: [fixture.session] }), result);
    const completion = fixture.evidence.find((item) => item.claim === "completion")!;
    assert.equal(completion.evidenceClass, "workflow_fact");
    assert.equal(completion.strength, "strong");
    assert.equal(isInterviewModelRubricEvidence(completion), false);
    assert.ok(fixture.evidence.filter((item) => item.claim === "performance").every(isInterviewModelRubricEvidence));
    assert.ok(!JSON.stringify(result).includes("interview_skill"));
  }
});

const interviewRejections: Array<[string, (fixture: ReturnType<typeof interviewFixture>) => void]> = [
  ["completion alone", (f) => { f.evidence = f.evidence.filter((item) => item.claim === "completion"); }],
  ["performance without workflow Evidence", (f) => { f.evidence = f.evidence.filter((item) => item.claim === "performance"); }],
  ["performance without completion Event", (f) => { f.events = f.events.filter((event) => event.kind === "interview.evaluated"); }],
  ["missing overall", (f) => { f.evidence = f.evidence.filter((item) => item.outcome.kind !== "model_rubric_score" || item.outcome.scope !== "overall"); }],
  ["missing dimension", (f) => { f.evidence = f.evidence.filter((item) => item.outcome.kind !== "model_rubric_score" || item.outcome.scope !== "dimension" || item.outcome.dimensionIndex !== 1); }],
  ["extra rubric slice", (f) => { f.evidence.push({ ...f.evidence.find((item) => item.claim === "performance")!, id: "extra-rubric-slice" }); }],
  ["source evaluation ID", (f) => { f.evaluation.id = "detached"; }],
  ["source session ID", (f) => { f.evaluation.sessionId = "detached"; }],
  ["session question target", (f) => { f.session.questionId = "other-question"; }],
  ["session type", (f) => { f.session.type = "structured_group"; }],
  ["session status", (f) => { f.session.status = "active"; }],
  ["workflow time", (f) => { f.session.completedAt = "2026-10-03T08:00:00.000Z"; }],
  ["Event lineage", (f) => { f.events.find((event) => event.kind === "interview.evaluated")!.source.records[1].recordId = "other-session"; }],
  ["conflicting duplicate Event", (f) => {
    const event = structuredClone(f.events.find((event) => event.kind === "interview.evaluated")!);
    event.payload.totalScore += 1; f.events.push(event);
  }],
  ["conflicting duplicate completion Event", (f) => {
    const event = structuredClone(f.events.find((event) => event.kind === "interview.completed")!);
    event.target.id = "other-question"; f.events.push(event);
  }],
  ["conflicting duplicate Evidence", (f) => {
    const item = structuredClone(f.evidence.find((item) => item.claim === "performance")!);
    item.strength = "strong"; f.evidence.push(item);
  }],
  ["comment dimension name", (f) => { f.evaluation.dimensions[0].name = "other-label"; }],
  ["comment dimension score", (f) => { f.evaluation.dimensions[0].score = 3; }],
  ["comment dimension maxScore", (f) => { f.evaluation.dimensions[0].maxScore = 20; }],
  ["source dimension ordering", (f) => { f.evaluation.dimensions.reverse(); }],
];
for (const [label, patch] of interviewRejections) {
  test(`Interview fails closed: ${label}`, () => {
    const f = interviewFixture(); patch(f);
    assert.deepEqual(projectInterview(f), []);
    f.events.reverse(); f.evidence.reverse();
    assert.deepEqual(projectInterview(f), []);
  });
}

const rubricRejections: Array<[string, (item: EvidenceRecordV1) => void]> = [
  ["dimension index", (item) => { Object.assign(item.outcome, { dimensionIndex: 3 }); }],
  ["dimension name", (item) => { Object.assign(item.outcome, { dimension: "other-label" }); }],
  ["dimension score", (item) => { Object.assign(item.outcome, { score: 3 }); }],
  ["dimension maxScore", (item) => { Object.assign(item.outcome, { maxScore: 20 }); }],
  ["claim", (item) => { item.claim = "correctness"; }],
  ["evidence class", (item) => { item.evidenceClass = "scored_performance"; }],
  ["outcome kind", (item) => { item.outcome = { kind: "workflow_completed", direction: "supports" }; }],
  ["low score direction refutes", (item) => { Object.assign(item.outcome, { direction: "refutes" }); }],
  ["high score direction supports", (item) => { Object.assign(item.outcome, { score: 10, direction: "supports" }); }],
  ["modality", (item) => { item.provenance.modality = "selection"; }],
  ["model author", (item) => { item.provenance.modelAuthored = false; }],
  ["scoring method", (item) => { item.provenance.scoringMethod = "none"; }],
  ["key source", (item) => { item.provenance.keySource = "model_authored"; }],
  ["model-only limitation", (item) => { item.provenance.limitations = item.provenance.limitations.filter((v) => v !== "model_assessment_only"); }],
  ["independent-grader limitation", (item) => { item.provenance.limitations = item.provenance.limitations.filter((v) => v !== "no_independent_grader"); }],
  ["evaluation lineage", (item) => { item.sourceRecordRefs[0].recordId = "other-evaluation"; }],
  ["session lineage", (item) => { item.sourceRecordRefs[1].recordId = "other-session"; }],
  ["Event ID", (item) => { item.sourceEventIds = ["other-event"]; }],
  ["measurement group", (item) => { item.measurementGroupId = "other-event"; }],
  ["target", (item) => { item.target.id = "other-question"; }],
  ["policy version", (item) => { Object.assign(item, { policyVersion: "evidence-policy/v2" }); }],
];
for (const [label, patch] of rubricRejections) {
  test(`Interview rejects mismatched model Evidence: ${label}`, () => {
    const f = interviewFixture();
    const item = f.evidence.find((item) => item.outcome.kind === "model_rubric_score" && item.outcome.scope === "dimension")!;
    patch(item); assert.deepEqual(projectInterview(f), []);
  });
}

test("Interview overall score/maxScore and workflow lineage must match their Events", () => {
  for (const patch of [{ score: 99 }, { maxScore: 99 }]) {
    const f = interviewFixture();
    Object.assign(f.evidence.find((item) => item.outcome.kind === "model_rubric_score" && item.outcome.scope === "overall")!.outcome, patch);
    assert.deepEqual(projectInterview(f), []);
  }
  for (const patch of [{ evidenceClass: "model_assessment" }, { target: { category: "question", namespace: "interview_question", id: "other" } }]) {
    const f = interviewFixture();
    Object.assign(f.evidence.find((item) => item.claim === "completion")!, patch);
    assert.deepEqual(projectInterview(f), []);
  }
});

test("Interview identical duplicates collapse, reordered objects/inputs are byte-for-byte deterministic and immutable", (context) => {
  context.mock.method(Date, "now", () => { throw new Error("clock forbidden"); });
  context.mock.method(Math, "random", () => { throw new Error("random forbidden"); });
  const f = interviewFixture(); const before = structuredClone(f); const expected = projectInterview(f);
  const duplicate = structuredClone(f.evidence).map((item) => ({ ...item, provenance: { ...item.provenance,
    limitations: [...item.provenance.limitations].reverse() } }));
  assert.equal(JSON.stringify(projectEvaluatedInterviewCompatibility([...f.events].reverse().concat(f.events),
    duplicate.concat(f.evidence).reverse(), [f.evaluation, structuredClone(f.evaluation)], [f.session])), JSON.stringify(expected));
  const second = interviewFixture(9);
  second.evaluation.id = "evaluation-2"; second.evaluation.sessionId = "session-2"; second.session.id = "session-2";
  const input = { interviewEvaluations: [f.evaluation, second.evaluation], interviewSessions: [f.session, second.session] };
  assert.equal(JSON.stringify(projectLegacyInterviewCompatibility(input)), JSON.stringify(projectLegacyInterviewCompatibility({
    interviewEvaluations: [...input.interviewEvaluations].reverse(), interviewSessions: [...input.interviewSessions].reverse() })));
  assert.deepEqual(f, before);
});

test("Interview duplicate raw presentation metadata conflicts fail closed independently of input order", () => {
  for (const patch of [
    (e: InterviewEvaluation) => { e.updatedAt = "other-order-metadata"; },
    (e: InterviewEvaluation) => { e.sessionId = "other-session"; },
    (e: InterviewEvaluation) => { e.dimensions.reverse(); },
    (e: InterviewEvaluation) => { e.dimensions[0].name = "other-label"; },
    (e: InterviewEvaluation) => { e.dimensions[0].score = 3; },
    (e: InterviewEvaluation) => { e.dimensions[0].maxScore = 20; },
    (e: InterviewEvaluation) => { e.dimensions[0].comment = "conflicting comment"; },
  ]) {
    const f = interviewFixture(); const duplicate = structuredClone(f.evaluation); patch(duplicate);
    for (const sources of [[f.evaluation, duplicate], [duplicate, f.evaluation]]) {
      assert.deepEqual(projectEvaluatedInterviewCompatibility(f.events, f.evidence, sources, [f.session]), []);
      assert.deepEqual(projectLegacyInterviewCompatibility({ interviewEvaluations: sources, interviewSessions: [f.session] }), []);
    }
  }
});

test("Interview comments/updatedAt are presentation-only exceptions; other prose and private fields never cross", () => {
  const f = interviewFixture();
  f.evaluation.strengths = ["SENTINEL_STRENGTHS"]; f.evaluation.problems = ["SENTINEL_PROBLEMS"];
  f.evaluation.suggestions = ["SENTINEL_SUGGESTIONS"]; f.evaluation.evidence = ["SENTINEL_EVIDENCE_PROSE"];
  f.session.questionPrompt = "SENTINEL_PROMPT"; f.session.questionMaterial = "SENTINEL_MATERIAL";
  f.session.transcriptText = "SENTINEL_TRANSCRIPT"; f.session.title = "SENTINEL_SESSION_PROSE";
  for (const object of [f.evaluation, f.session, ...f.events, ...f.evidence, ...f.evaluation.dimensions]) {
    Object.assign(object, { turnContent: "SENTINEL_TURN", providerOutput: "SENTINEL_PROVIDER",
      reasoning: "SENTINEL_REASONING", credentials: "SENTINEL_CREDENTIALS", rawResponse: "SENTINEL_RAW" });
  }
  const projection = projectLegacyInterviewCompatibility({ interviewEvaluations: [f.evaluation], interviewSessions: [f.session] });
  assert.equal(projection.length, 1); assert.ok(!JSON.stringify(projection).includes("SENTINEL_"));
  assert.equal(projection[0].dimensions[0].compatibilityComment, "legacy comment");
  const changed = structuredClone(f.evaluation); changed.updatedAt = "display-order-only"; changed.dimensions[0].comment = "new legacy comment";
  const result = projectEvaluatedInterviewCompatibility(f.events, f.evidence, [changed], [f.session]);
  assert.deepEqual(result[0].authority, projection[0].authority);
  assert.equal(result[0].compatibilityUpdatedAt, "display-order-only");
  assert.equal(result[0].dimensions[0].compatibilityComment, "new legacy comment");
  assert.equal(result[0].dimensions[0].score, projection[0].dimensions[0].score);
});

function review(patch: Partial<Attempt> = {}): Attempt {
  return { id: "review-1", mistakeId: "mistake-1", result: "correct", confidence: 3, reviewedAt: "2026-10-02", ...patch };
}

function knowledge(patch: Partial<KnowledgeAttempt> = {}): KnowledgeAttempt {
  return { id: "knowledge-review-1", knowledgeId: "knowledge-1", result: "correct", confidence: 3, reviewedAt: "2026-10-02", ...patch };
}

for (const recordType of ["review_attempt", "knowledge_attempt"] as const) {
  for (const result of ["correct", "uncertain", "wrong"] as const) {
    test(`${recordType} ${result} preserves only legacy self-report compatibility`, () => {
      const input = recordType === "review_attempt" ? { reviewAttempts: [review({ result })] } : { knowledgeAttempts: [knowledge({ result })] };
      const source = { recordType, recordId: recordType === "review_attempt" ? "review-1" : "knowledge-review-1" };
      const category = recordType === "review_attempt" ? "mistake" : "knowledge";
      assert.deepEqual(projectLegacyResultCompatibility(input), [{
        source,
        target: { category, namespace: category, id: `${category}-1` },
        reportedResult: result,
        observedAt: "2026-10-02",
        authority: { kind: "legacy_self_report_compatibility", evidenceClass: "self_report", limitation: "self_report_only" },
      }]);
      const evidence = deriveEvidence(projectLegacyLearningEvents(input).events).evidence.filter(isLegacySelfReportResultEvidence);
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].claim, "correctness");
      assert.equal(evidence[0].evidenceClass, "self_report");
      assert.ok(evidence[0].provenance.limitations.includes("self_report_only"));
      assert.deepEqual(evidence[0].sourceRecordRefs, [source]);
    });
  }
}

test("completion Evidence alone never passes the bridge result gate", () => {
  const evidence = deriveEvidence(projectLegacyLearningEvents({ reviewAttempts: [review()], knowledgeAttempts: [knowledge()] }).events).evidence;
  const completionOnly = evidence.filter((item) => item.claim === "completion");
  assert.equal(completionOnly.length, 2);
  assert.ok(completionOnly.every((item) => item.strength === "strong"));
  assert.deepEqual(completionOnly.filter(isLegacySelfReportResultEvidence), []);
});

test("claim, class, outcome and self_report_only are all required at the result gate", () => {
  const valid = deriveEvidence(projectLegacyLearningEvents({ reviewAttempts: [review()] }).events).evidence.find(isLegacySelfReportResultEvidence)!;
  const unsupported = [
    { ...valid, claim: "understanding" as const },
    { ...valid, evidenceClass: "scored_performance" as const },
    { ...valid, evidenceClass: "model_assessment" as const },
    { ...valid, outcome: { kind: "workflow_completed" as const, direction: "supports" as const } },
    { ...valid, provenance: { ...valid.provenance, limitations: valid.provenance.limitations.filter((item) => item !== "self_report_only") } },
  ];
  assert.ok(unsupported.every((item) => !isLegacySelfReportResultEvidence(item)));
});

test("invalid and inconsistent sources are omitted without a raw result fallback", () => {
  for (const patch of [
    { id: "" }, { id: "bad\ud800" }, { id: "x".repeat(257) },
    { result: "unsupported" as Attempt["result"] },
    { confidence: 0 }, { confidence: 6 }, { confidence: Number.NaN },
    { reviewedAt: "2026-02-30" }, { reviewedAt: "not-a-date" }, { reviewedAt: "2026-10-02T08:00:00Z" },
  ]) {
    assert.deepEqual(projectLegacyResultCompatibility({ reviewAttempts: [review(patch)], knowledgeAttempts: [knowledge(patch)] }), []);
  }
  assert.deepEqual(projectLegacyResultCompatibility({ reviewAttempts: [review({ mistakeId: "" })], knowledgeAttempts: [knowledge({ knowledgeId: "" })] }), []);
  assert.deepEqual(projectLegacyResultCompatibility({ reviewAttempts: [review({ durationSec: -1 })] }), []);
  const mixed = projectLegacyResultCompatibility({ reviewAttempts: [review(), review({ id: "invalid", durationSec: -1, result: "wrong" })] });
  assert.deepEqual(mixed, projectLegacyResultCompatibility({ reviewAttempts: [review()] }));
});

test("identical duplicate facts collapse and input ordering cannot change the projection", (context) => {
  context.mock.method(Date, "now", () => { throw new Error("clock forbidden"); });
  context.mock.method(Math, "random", () => { throw new Error("random forbidden"); });
  const input = {
    reviewAttempts: [review(), review({ id: "review-2", mistakeId: "mistake-2", result: "wrong", reviewedAt: "2026-10-01" })],
    knowledgeAttempts: [knowledge(), knowledge({ id: "knowledge-review-2", knowledgeId: "knowledge-2", result: "uncertain" })],
  };
  const before = structuredClone(input);
  const expected = projectLegacyResultCompatibility(input);
  const reordered = { reviewAttempts: [...input.reviewAttempts].reverse(), knowledgeAttempts: [...input.knowledgeAttempts].reverse() };
  const duplicated = { reviewAttempts: [...input.reviewAttempts, ...reordered.reviewAttempts], knowledgeAttempts: [...input.knowledgeAttempts, ...reordered.knowledgeAttempts] };
  for (const facts of [input, reordered, duplicated]) {
    assert.deepEqual(projectLegacyResultCompatibility(facts), expected);
    assert.equal(JSON.stringify(projectLegacyResultCompatibility(facts)), JSON.stringify(expected));
  }
  assert.deepEqual(input, before);
});

test("conflicting duplicate source identities fail closed in either order", () => {
  for (const patch of [{ result: "wrong" as const }, { confidence: 5 }, { confidence: 0 }, { reviewedAt: "2026-10-01" }]) {
    for (const reverse of [false, true]) {
      const reviews = [review(), review(patch)];
      const knowledgeAttempts = [knowledge(), knowledge(patch)];
      assert.deepEqual(projectLegacyResultCompatibility({ reviewAttempts: reverse ? reviews.reverse() : reviews, knowledgeAttempts: reverse ? knowledgeAttempts.reverse() : knowledgeAttempts }), []);
    }
  }
  assert.deepEqual(projectLegacyResultCompatibility({ reviewAttempts: [review(), review({ mistakeId: "other" })], knowledgeAttempts: [knowledge(), knowledge({ knowledgeId: "other" })] }), []);
});

test("source types disambiguate shared IDs and preserve the expected target lineage", () => {
  const result = projectLegacyResultCompatibility({ reviewAttempts: [review({ id: "shared" })], knowledgeAttempts: [knowledge({ id: "shared" })] });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => [item.source.recordType, item.source.recordId, item.target.id]).toSorted(), [
    ["knowledge_attempt", "shared", "knowledge-1"], ["review_attempt", "shared", "mistake-1"],
  ]);
});

test("bridge output excludes all source prose and detached output cannot mutate facts", () => {
  const secret = "PRIVATE-PROSE-SENTINEL";
  const input = {
    reviewAttempts: [{ ...review(), stem: secret, answer: secret, explanation: secret, providerOutput: secret }],
    knowledgeAttempts: [{ ...knowledge(), title: secret, summary: secret, content: secret, hiddenReasoning: secret }],
  };
  const result = projectLegacyResultCompatibility(input);
  assert.equal(result.length, 2);
  assert.ok(!JSON.stringify(result).includes(secret));
  for (const item of result) assert.deepEqual(Object.keys(item), ["source", "target", "reportedResult", "observedAt", "authority"]);
  result[0].target.id = "changed";
  result[0].source.recordId = "changed";
  assert.equal(input.reviewAttempts[0].id, "review-1");
  assert.equal(input.knowledgeAttempts[0].knowledgeId, "knowledge-1");
});

test("legacy confidence/mastery never changes compatibility result or authority", () => {
  const expected = projectLegacyResultCompatibility({ reviewAttempts: [review()], knowledgeAttempts: [knowledge()] });
  for (const confidence of [1, 2, 4, 5]) {
    assert.deepEqual(projectLegacyResultCompatibility({ reviewAttempts: [review({ confidence })], knowledgeAttempts: [knowledge({ confidence })] }), expected);
  }
  assert.doesNotMatch(JSON.stringify(expected), /confidence|legacyMasteryAfter|strength|mastered|understanding/);
});

test("date-only and unavailable event times retain their normalized precision", () => {
  const result = projectLegacyResultCompatibility({ reviewAttempts: [review({ reviewedAt: "" })], knowledgeAttempts: [knowledge()] });
  assert.equal(result.find((item) => item.source.recordType === "review_attempt")?.observedAt, null);
  assert.equal(result.find((item) => item.source.recordType === "knowledge_attempt")?.observedAt, "2026-10-02");
  assert.deepEqual(projectLegacyResultCompatibility({}), []);
});

const completedAt = "2026-10-03T08:00:00.000Z";

function tutoring(selections = [0], patch: Partial<TutoringTurn> = {}): TutoringTurn {
  return {
    id: "turn-1", sessionId: "session-1", speaker: "ai_tutor", content: "private teacher prose",
    microAssessment: {
      questions: selections.map((_, index) => ({ id: `q${index + 1}`, prompt: "private prompt", options: ["private A", "private B"], correctOptionIndex: 0, explanation: "private explanation" })),
      selections, correctCount: selections.filter((choice) => choice === 0).length, completedAt,
    },
    createdAt: "2026-10-03T07:00:00.000Z", ...patch,
  };
}

function tutoringLineage(turn = tutoring([0, 1, 0])) {
  const events = projectLegacyLearningEvents({ tutoringTurns: [turn] }).events as LearningEventV1<"assessment.submitted">[];
  return { events, evidence: deriveEvidence(events).evidence, sources: [{ id: turn.id, sessionId: turn.sessionId, createdAt: turn.createdAt }] };
}

function projectLineage(lineage: ReturnType<typeof tutoringLineage>) {
  return projectCompletedTutoringCompatibility(lineage.events, lineage.evidence, lineage.sources);
}

for (const selections of [[0], [1], [0, 1, 0]]) {
  test(`completed Tutoring reconstructs ${selections.filter((choice) => choice === 0).length}/${selections.length} supplied-key matches`, () => {
    assert.deepEqual(projectLegacyTutoringCompatibility({ tutoringTurns: [tutoring(selections)] }), [{
      sourceTurnId: "turn-1", sessionId: "session-1", completedAt,
      questionCount: selections.length, correctCount: selections.filter((choice) => choice === 0).length,
      compatibilitySourceCreatedAt: "2026-10-03T07:00:00.000Z",
      authority: { kind: "legacy_model_key_compatibility", evidenceClass: "scored_performance", limitations: ["model_authored_key", "no_independent_grader"] },
    }]);
  });
}

test("Tutoring completion Evidence alone has no scored compatibility authority", () => {
  const lineage = tutoringLineage();
  lineage.evidence = lineage.evidence.filter((item) => item.claim === "completion");
  assert.equal(lineage.evidence.length, 3);
  assert.ok(lineage.evidence.every((item) => !isTutoringSuppliedKeyEvidence(item)));
  assert.deepEqual(projectLineage(lineage), []);
});

test("Tutoring correctness gate requires scored comparison, model key and both limitations", () => {
  const lineage = tutoringLineage();
  const valid = lineage.evidence.find(isTutoringSuppliedKeyEvidence)!;
  const invalid: EvidenceRecordV1[] = [
    { ...valid, claim: "understanding" }, { ...valid, evidenceClass: "model_assessment" },
    { ...valid, outcome: { kind: "workflow_completed", direction: "supports" } },
    { ...valid, provenance: { ...valid.provenance, keySource: "unknown" } },
    { ...valid, provenance: { ...valid.provenance, scoringMethod: "model_rubric" } },
    ...(["model_authored_key", "no_independent_grader"] as const).map((limitation) => ({
      ...valid, provenance: { ...valid.provenance, limitations: valid.provenance.limitations.filter((item) => item !== limitation) },
    })),
  ];
  for (const item of invalid) {
    assert.equal(isTutoringSuppliedKeyEvidence(item), false);
    assert.deepEqual(projectLineage({ ...lineage, evidence: lineage.evidence.map((original) => original.id === valid.id ? item : original) }), []);
  }
});

test("partial question Events or correctness Evidence cannot form a completed assessment", () => {
  const lineage = tutoringLineage();
  for (const ordinal of [1, 2, 3]) {
    const events = lineage.events.filter((event) => event.payload.questionOrdinal !== ordinal);
    assert.deepEqual(projectLineage({ ...lineage, events, evidence: deriveEvidence(events).evidence }), []);
    const missingId = lineage.events.find((event) => event.payload.questionOrdinal === ordinal)!.id;
    assert.deepEqual(projectLineage({ ...lineage, evidence: lineage.evidence.filter((item) => item.claim !== "correctness" || item.sourceEventIds[0] !== missingId) }), []);
  }
});

for (const [name, patch] of [
  ["missing ordinal", { questionOrdinal: 4 }],
  ["inconsistent assessmentQuestionCount", { assessmentQuestionCount: 2 }],
  ["inconsistent submittedCorrectCount", { submittedCorrectCount: 1 }],
] as const) {
  test(`Tutoring ${name} fails closed`, () => {
    const lineage = tutoringLineage();
    lineage.events[0] = { ...lineage.events[0], payload: { ...lineage.events[0].payload, ...patch } };
    assert.deepEqual(projectLineage(lineage), []);
  });
}

test("individually valid Events with conflicting counts, session, source, time or revision cannot be stitched", () => {
  const base = tutoringLineage();
  for (const turn of [
    tutoring([0, 1]), tutoring([0, 1, 1]), tutoring([0, 1, 0], { sessionId: "other" }),
    tutoring([0, 1, 0], { id: "other" }),
    { ...tutoring([0, 1, 0]), microAssessment: { ...tutoring([0, 1, 0]).microAssessment!, completedAt: "2026-10-03T09:00:00.000Z" } },
    tutoring([1, 0, 0]),
  ]) {
    const alternate = tutoringLineage(turn);
    assert.equal(deriveEvidence(alternate.events).diagnostics.length, 0);
    const events = [alternate.events[0], ...base.events.slice(1)];
    assert.deepEqual(projectLineage({ ...base, events, evidence: deriveEvidence(events).evidence }), []);
  }
});

test("Tutoring rejects detached target, source, revision, group and session Evidence lineage", () => {
  const lineage = tutoringLineage();
  const valid = lineage.evidence.find(isTutoringSuppliedKeyEvidence)!;
  const changes: EvidenceRecordV1[] = [
    { ...valid, target: { ...valid.target, id: "other" } },
    { ...valid, target: { ...valid.target, namespace: "other" } },
    { ...valid, sourceRecordRefs: [{ ...valid.sourceRecordRefs[0], recordId: "other" }] },
    { ...valid, sourceRecordRefs: [{ ...valid.sourceRecordRefs[0], recordType: "review_attempt" }] },
    { ...valid, sourceRecordRefs: [{ ...valid.sourceRecordRefs[0], revision: "other" }] },
    { ...valid, sourceEventIds: ["other"] },
    { ...valid, sourceEventIds: [...valid.sourceEventIds, "other"] },
    { ...valid, measurementGroupId: "other" },
    { ...valid, outcome: { kind: "supplied_key_comparison", matchesSuppliedKey: !valid.outcome.matchesSuppliedKey, direction: "refutes" } },
    { ...valid, provenance: { ...valid.provenance, modelAuthored: false } },
  ];
  for (const item of changes) assert.deepEqual(projectLineage({ ...lineage, evidence: lineage.evidence.map((original) => original.id === valid.id ? item : original) }), []);
  for (const sessionId of ["", "bad\ud800", "other"]) {
    assert.deepEqual(projectLineage({ ...lineage, sources: [{ ...lineage.sources[0], sessionId }] }), []);
  }
});

test("conflicting duplicate Tutoring source identities fail closed in both orders", () => {
  const base = tutoring();
  for (const other of [
    tutoring([1]), tutoring([0, 0]), tutoring([0], { sessionId: "other" }),
    tutoring([0], { createdAt: "2026-10-03T06:00:00.000Z" }),
    { ...base, microAssessment: { ...base.microAssessment!, correctCount: 0 } },
    { ...base, microAssessment: { questions: base.microAssessment!.questions } },
    { ...base, microAssessment: undefined },
    { ...base, speaker: "student" as const },
  ]) {
    for (const turns of [[base, other], [other, base]]) assert.deepEqual(projectLegacyTutoringCompatibility({ tutoringTurns: turns }), []);
  }
});

test("conflicting duplicate Event and Evidence identities cannot select a winner", () => {
  const lineage = tutoringLineage();
  const changed = { ...lineage.events[0], sessionId: "other" };
  for (const events of [[...lineage.events, changed], [changed, ...lineage.events]]) {
    assert.deepEqual(projectLineage({ ...lineage, events, evidence: deriveEvidence(events).evidence }), []);
  }
  const valid = lineage.evidence.find(isTutoringSuppliedKeyEvidence)!;
  for (const changed of [{ ...valid, strength: "strong" as const }, { ...valid, id: "different-measurement" }]) {
    for (const evidence of [[...lineage.evidence, changed], [changed, ...lineage.evidence]]) assert.deepEqual(projectLineage({ ...lineage, evidence }), []);
  }
});

test("identical duplicate tutoring facts, Events and Evidence collapse deterministically under reordering", (context) => {
  context.mock.method(Date, "now", () => { throw new Error("clock forbidden"); });
  context.mock.method(Math, "random", () => { throw new Error("random forbidden"); });
  const turns = [tutoring(), tutoring([1], { id: "turn-2", sessionId: "session-2" })];
  const before = structuredClone(turns);
  const expected = projectLegacyTutoringCompatibility({ tutoringTurns: turns });
  for (const tutoringTurns of [turns, [...turns].reverse(), [...turns, ...structuredClone(turns).reverse()]]) {
    assert.equal(JSON.stringify(projectLegacyTutoringCompatibility({ tutoringTurns })), JSON.stringify(expected));
  }
  const lineage = tutoringLineage();
  assert.deepEqual(projectLineage({
    events: [...lineage.events, ...structuredClone(lineage.events)].reverse(),
    evidence: [...lineage.evidence, ...structuredClone(lineage.evidence)].reverse(),
    sources: [...lineage.sources, ...structuredClone(lineage.sources)],
  }), projectLineage(lineage));
  assert.deepEqual(turns, before);
});

test("Tutoring output excludes private prose, never labels model key as independent truth", () => {
  const secret = "PRIVATE-TUTORING-SENTINEL";
  const turn = tutoring();
  turn.content = secret;
  turn.detectedProblem = secret;
  turn.confidence = 0.99;
  turn.microAssessment!.questions[0] = { ...turn.microAssessment!.questions[0], prompt: secret, options: [secret, secret], explanation: secret };
  const enriched = { ...turn, providerOutput: secret, reasoning: secret };
  const output = projectLegacyTutoringCompatibility({ tutoringTurns: [enriched] });
  assert.equal(output.length, 1);
  assert.ok(!JSON.stringify(output).includes(secret));
  assert.deepEqual(Object.keys(output[0]), ["sourceTurnId", "sessionId", "completedAt", "questionCount", "correctCount", "compatibilitySourceCreatedAt", "authority"]);
  assert.doesNotMatch(JSON.stringify(output), /independently_verified|ground_truth|understanding|mastery|retention|transfer|confidence|reasoning|providerOutput/);
  const baseline = projectLegacyTutoringCompatibility({ tutoringTurns: [tutoring()] });
  assert.deepEqual(output, baseline);
  output[0].authority.limitations.pop();
  assert.deepEqual(projectLegacyTutoringCompatibility({ tutoringTurns: [enriched] }), baseline);
});

test("source-created-at is compatibility ordering metadata and cannot grant Evidence authority", () => {
  const turn = tutoring();
  const changed = { ...turn, createdAt: "2026-10-03T06:00:00.000Z" };
  assert.deepEqual(projectLegacyLearningEvents({ tutoringTurns: [changed] }), projectLegacyLearningEvents({ tutoringTurns: [turn] }));
  const result = projectLegacyTutoringCompatibility({ tutoringTurns: [changed] });
  assert.deepEqual(result, projectLegacyTutoringCompatibility({ tutoringTurns: [turn] }).map((item) => ({ ...item, compatibilitySourceCreatedAt: changed.createdAt })));
  assert.deepEqual(projectLegacyTutoringCompatibility({}), []);
});
