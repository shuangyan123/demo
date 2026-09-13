import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import { resolveAdaptiveReviewDecision } from "../lib/adaptive-review.ts";
import { deriveWeaknessIntelligence } from "../lib/weakness-intelligence.ts";
import { studyDay, addStudyDays } from "../lib/study-day.ts";
import { deriveLearningInsightSnapshot } from "../features/review/learning-insight-model.ts";
import { learningEventFromReviewAttempt, learningEventFromKnowledgeAttempt, type LearningEvent } from "../types/domains/learning-event.ts";
import type { Attempt, Mistake } from "../types/domains/review.ts";
import type { KnowledgeEntry, KnowledgeAttempt } from "../types/domains/knowledge.ts";
import { effectiveLearningEvents, loadLearnerStateSnapshotFromNormalizedFacts } from "./learner-state-service.ts";
import { inspectLocalDataIntegrity } from "./local-data-reliability.ts";
import { filterWorkspaceRecords, type WorkspaceDataScope } from "./workspace-data-scope.ts";
import { reviewRepository } from "./review-repository.ts";
import { knowledgeRepository } from "./knowledge-repository.ts";

const now = new Date(2026, 8, 13, 12);
const day = studyDay(now)!;
const m = (id: string): Mistake => ({ id, board: "判断推理", source: "contract", stem: id, answer: "A", explanation: "", reasons: ["审题"], tags: [], mastery: 3, nextReviewAt: day, createdAt: day, updatedAt: day });
const a = (id: string, mistakeId = "m1"): Attempt => ({ id, mistakeId, result: "correct", confidence: 3, reviewedAt: addStudyDays(day, -1), durationSec: 12 });
const k = (id: string): KnowledgeEntry => ({ id, category: "常识判断", title: id, summary: "", content: "", source: "contract", tags: [], favorite: false, mastery: 3, nextReviewAt: day, reviewCount: 0, createdAt: day, updatedAt: day });

for (const [label, patch] of Object.entries({
  outcome: { outcome: "wrong" }, subject: { subjectId: "m2" }, id: { id: "noncanonical" },
  sourceType: { sourceType: "knowledge_attempt" }, sourceId: { sourceId: "missing" },
  subjectType: { subjectType: "knowledge" }, observedAt: { observedAt: day },
  masteryAfter: { masteryAfter: 1 }, durationSec: { durationSec: 99 },
}) as Array<[string, Partial<LearningEvent>]>) {
  test(`B1 conflicting ${label} cannot replace source core or optional evidence`, () => {
    const attempt = a("a1");
    const canonical = learningEventFromReviewAttempt(attempt);
    const supplied = { ...canonical, ...patch, errorCause: "calculation" as const };
    assert.deepEqual(effectiveLearningEvents({ attempts: [attempt], knowledgeAttempts: [], learningEvents: [supplied] }), [canonical]);
    const issues = inspectLocalDataIntegrity({ mistakes: [m("m1"), m("m2")], attempts: [attempt], learningEvents: [supplied] });
    assert.ok(issues.some((issue) => issue.table === "learningEvents" && ["learning-event-core-conflict", "dangling-reference"].includes(issue.code)));
  });
}

test("B1 matching optional evidence survives; missing source and conflicting duplicates are deterministic", () => {
  const attempt = { ...a("a1"), result: "wrong" as const };
  const canonical = learningEventFromReviewAttempt(attempt);
  const valid = { ...canonical, errorCause: "calculation" as const, selfConfidence: 2, hintCount: 1, attemptOrdinal: 2, practiceKind: "retry" as const };
  const conflict = { ...canonical, outcome: "correct" as const };
  const facts = { attempts: [attempt], knowledgeAttempts: [], learningEvents: [conflict, valid, { ...valid, id: "other" }] };
  assert.deepEqual(effectiveLearningEvents(facts), [valid]);
  assert.deepEqual(effectiveLearningEvents({ ...facts, learningEvents: [...facts.learningEvents].reverse() }), [valid]);
  assert.deepEqual(effectiveLearningEvents({ ...facts, attempts: [] }), []);
  assert.ok(inspectLocalDataIntegrity({ learningEvents: [valid] }).some((issue) => issue.code === "dangling-reference"));
  assert.equal(inspectLocalDataIntegrity({ mistakes: [m("m1")], attempts: [attempt], learningEvents: [valid] }).length, 0);
  const intelligence = deriveWeaknessIntelligence({ subjects: [{ subjectType: "mistake", subjectId: "m1", mastery: 3, updatedAt: day }], learningEvents: effectiveLearningEvents(facts), today: now });
  assert.equal(intelligence.subjects[0].studyDays[0].events[0].errorCause, "calculation");
});

test("B1 both repositories schedule from authoritative attempts despite corrupt persisted events", async () => {
  await reviewDb.delete(); await reviewDb.open();
  const attempt = a("a1");
  const knowledgeAttempt: KnowledgeAttempt = { id: "ka1", knowledgeId: "k1", result: "correct", confidence: 3, reviewedAt: attempt.reviewedAt };
  await reviewDb.mistakes.put(m("m1")); await reviewDb.attempts.put(attempt);
  await reviewDb.knowledgeEntries.put(k("k1")); await reviewDb.knowledgeAttempts.put(knowledgeAttempt);
  await reviewDb.learningEvents.bulkPut([
    { ...learningEventFromReviewAttempt(attempt), outcome: "wrong" },
    { ...learningEventFromKnowledgeAttempt(knowledgeAttempt), outcome: "wrong" },
  ]);
  const expected = resolveAdaptiveReviewDecision({ currentMastery: 3, result: "correct", today: now, priorEvents: [learningEventFromReviewAttempt(attempt)] });
  await reviewRepository.recordReview(m("m1"), "correct", now);
  await knowledgeRepository.recordReview(k("k1"), "correct", now);
  assert.equal((await reviewDb.mistakes.get("m1"))?.nextReviewAt, expected.nextReviewAt);
  assert.equal((await reviewDb.knowledgeEntries.get("k1"))?.nextReviewAt, expected.nextReviewAt);
  assert.equal(expected.recentLapseDays, 0);
  assert.equal(expected.recentCorrectStreak, 2);
  assert.equal((await reviewDb.learningEvents.get("review_attempt:a1"))?.outcome, "wrong");
  await reviewDb.delete();
});

test("B1/B2/B3 one personal evidence chain agrees across L2/L4/L5 and isolates review scope", async () => {
  await reviewDb.delete(); await reviewDb.open();
  const attempts = [
    { ...a("a1"), reviewedAt: "2026-09-13T00:30:00+08:00" },
    { ...a("a2"), reviewedAt: "2026-09-12T16:30:00Z" },
    { ...a("ui-review:a", "ui-review:m"), result: "wrong" as const },
    { ...a("random-new-review-attempt", "ui-review:m"), result: "wrong" as const },
  ];
  const core = { mistakes: [m("m1"), m("ui-review:m")], attempts,
    knowledgeEntries: [k("k1"), k("ui-review:k")],
    knowledgeAttempts: [{ id: "ka1", knowledgeId: "k1", result: "correct" as const, confidence: 3, reviewedAt: day }, { id: "ui-review:ka", knowledgeId: "ui-review:k", result: "wrong" as const, confidence: 1, reviewedAt: day }] };
  const corrupt = { ...learningEventFromReviewAttempt(attempts[0]), outcome: "wrong" as const, errorCause: "calculation" as const };
  await reviewDb.learningEvents.put(corrupt);
  const personal = { kind: "personal" } as const;
  const events = effectiveLearningEvents({ attempts: filterWorkspaceRecords(attempts, personal), knowledgeAttempts: [], learningEvents: [corrupt] });
  const sameInstant = new Date(attempts[0].reviewedAt);
  const l2 = resolveAdaptiveReviewDecision({ currentMastery: 3, result: "correct", today: sameInstant, priorEvents: events });
  assert.equal(l2.sameDayRetry, true); assert.equal(l2.recentLapseDays, 0);
  const l4 = deriveWeaknessIntelligence({ subjects: [{ subjectType: "mistake", subjectId: "m1", mastery: 3, updatedAt: day }], learningEvents: events, today: now });
  assert.equal(l4.subjects[0].studyDays.length, 1); assert.equal(l4.subjects[0].wrongDays, 0);
  for (const scope of [personal, { kind: "ui-review" }] as WorkspaceDataScope[]) {
    const scoped = { mistakes: filterWorkspaceRecords(core.mistakes, scope), attempts: filterWorkspaceRecords(core.attempts, scope), knowledgeEntries: filterWorkspaceRecords(core.knowledgeEntries, scope), knowledgeAttempts: filterWorkspaceRecords(core.knowledgeAttempts, scope) };
    const learner = await loadLearnerStateSnapshotFromNormalizedFacts(core, now, scope);
    const l5 = deriveLearningInsightSnapshot({ ...scoped, now, range: "all" });
    assert.equal(learner.sourceRecordCount, 5);
    assert.equal(l5.attemptsCount, 2);
    assert.equal(l5.correctCount, scope.kind === "personal" ? 2 : 0);
    assert.equal(l5.spacedAttemptCount, 0);
    assert.equal(l5.distinctStudyDays, 1);
    assert.equal(l5.knowledgeMetrics.size, 1);
    assert.deepEqual(l5.priorityMistakes.map((item) => item.id), scoped.mistakes.map((item) => item.id));
    const excluded = scope.kind === "personal" ? "ui-review:" : "m1";
    assert.ok(learner.signals.every((signal) => signal.evidence.every((ref) => !ref.id.startsWith(excluded))));
    const isolated = await loadLearnerStateSnapshotFromNormalizedFacts(scoped, now, scope);
    assert.deepEqual(learner, isolated);
  }
  assert.deepEqual(filterWorkspaceRecords([{ id: "sample:s:m" }, { id: "ui-review:s:m" }, { id: "m" }]).map((item) => item.id), ["m"]);
  assert.equal(filterWorkspaceRecords([{ id: "sample:s:m" }, { id: "ui-review:s:m" }, { id: "ui-review:other:m" }], { kind: "sample", scenarioId: "s" }).length, 2);
  await reviewDb.delete();
});


test("KnowledgeAttempt core and optional metadata obey the same projection boundary", () => {
  const attempt: KnowledgeAttempt = { id: "ka", knowledgeId: "k1", result: "correct", confidence: 4, reviewedAt: day };
  const canonical = learningEventFromKnowledgeAttempt(attempt);
  for (const patch of [{ outcome: "wrong" }, { subjectId: "k2" }, { id: "alias" }, { observedAt: "2026-01-01" }, { masteryAfter: 1 }, { durationSec: 12 }, { subjectType: "mistake" }] as Partial<LearningEvent>[]) {
    const event = { ...canonical, ...patch };
    assert.deepEqual(effectiveLearningEvents({ attempts: [], knowledgeAttempts: [attempt], learningEvents: [event] }), [canonical]);
    assert.ok(inspectLocalDataIntegrity({ knowledgeEntries: [k("k1"), k("k2")], knowledgeAttempts: [attempt], learningEvents: [event] }).some((issue) => issue.code === "learning-event-core-conflict"));
  }
  const enriched = { ...canonical, selfConfidence: 80, hintCount: 0, attemptOrdinal: 1, practiceKind: "transfer" as const, errorCause: "memory_lapse" as const };
  assert.deepEqual(effectiveLearningEvents({ attempts: [], knowledgeAttempts: [attempt], learningEvents: [enriched] }), [enriched]);
});

test("matching errorCause reaches L4 clusters while conflicting cause evidence cannot", () => {
  const attempts = ["m1", "m2"].map((id) => ({ ...a(`a-${id}`, id), result: "wrong" as const }));
  const events = attempts.map((attempt) => ({ ...learningEventFromReviewAttempt(attempt), errorCause: "calculation" as const }));
  const subjects = attempts.map((attempt) => ({ subjectType: "mistake" as const, subjectId: attempt.mistakeId, mastery: 2, updatedAt: day }));
  const intelligence = (learningEvents: LearningEvent[]) => deriveWeaknessIntelligence({ subjects, today: now, learningEvents: effectiveLearningEvents({ attempts, knowledgeAttempts: [], learningEvents }) });
  assert.equal(intelligence(events).errorCauseClusters[0].cause, "calculation");
  assert.deepEqual(intelligence(events.map((event) => ({ ...event, outcome: "correct" }))).errorCauseClusters, []);
});

test("full timestamp due values agree with civil dates in learner-state L4 and L5", async () => {
  await reviewDb.delete(); await reviewDb.open();
  const instant = "2026-09-13T00:00:00Z";
  const current = new Date(instant);
  const core = (due: string) => ({ mistakes: [{ ...m("m1"), nextReviewAt: due }], attempts: [a("a1")], knowledgeEntries: [{ ...k("k1"), nextReviewAt: due }], knowledgeAttempts: [] });
  const full = core(instant); const civil = core(studyDay(instant)!);
  assert.deepEqual(await loadLearnerStateSnapshotFromNormalizedFacts(full, current), await loadLearnerStateSnapshotFromNormalizedFacts(civil, current));
  for (const facts of [full, civil]) {
    assert.equal(deriveLearningInsightSnapshot({ ...facts, now: current, range: "all", scope: "due" }).dueCount, 2);
    const l4 = deriveWeaknessIntelligence({ subjects: [{ subjectType: "mistake", subjectId: "m1", mastery: 3, nextReviewAt: facts.mistakes[0].nextReviewAt, updatedAt: day }], learningEvents: [], today: current });
    assert.equal(l4.subjects[0].due, true);
  }
  await reviewDb.delete();
});
