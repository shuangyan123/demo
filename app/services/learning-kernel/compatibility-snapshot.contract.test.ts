import assert from "node:assert/strict";
import test from "node:test";
import type { Attempt } from "../../types/domains/review.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import type { EvidenceRecordV1, LearningEventV1 } from "../../types/domains/learning-kernel.ts";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { projectLegacyLearningEvents } from "./legacy-event-adapter.ts";
import { isLegacySelfReportResultEvidence, isTutoringSuppliedKeyEvidence, projectCompletedTutoringCompatibility, projectLegacyResultCompatibility, projectLegacyTutoringCompatibility } from "./compatibility-snapshot.ts";

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
