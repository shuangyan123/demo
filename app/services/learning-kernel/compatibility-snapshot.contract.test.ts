import assert from "node:assert/strict";
import test from "node:test";
import type { Attempt } from "../../types/domains/review.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { projectLegacyLearningEvents } from "./legacy-event-adapter.ts";
import { isLegacySelfReportResultEvidence, projectLegacyResultCompatibility } from "./compatibility-snapshot.ts";

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
