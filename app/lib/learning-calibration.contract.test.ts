import assert from "node:assert/strict";
import test from "node:test";
import { deriveLearningEvidence } from "./learning-calibration.ts";
import {
  SELF_CONFIDENCE_PROTOCOL_V1,
  enrichCanonicalLearningEvent,
  learningEventFromKnowledgeAttempt,
  learningEventFromReviewAttempt,
  type LearningEvent,
} from "../types/domains/learning-event.ts";
import type { KnowledgeAttempt } from "../types/domains/knowledge.ts";
import type { Attempt } from "../types/domains/review.ts";

const now = new Date("2026-09-14T12:00:00.000Z");

function attempt(id: string, mistakeId: string, result: Attempt["result"], reviewedAt: string): Attempt {
  return { id, mistakeId, result, confidence: 3, reviewedAt };
}

function knowledgeAttempt(id: string, knowledgeId: string, result: KnowledgeAttempt["result"], reviewedAt: string): KnowledgeAttempt {
  return { id, knowledgeId, result, confidence: 3, reviewedAt };
}

function confidenceEvent(source: Attempt, selfConfidence: number, patch: Partial<LearningEvent> = {}): LearningEvent {
  return {
    ...learningEventFromReviewAttempt(source),
    selfConfidence,
    selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1,
    ...patch,
  };
}

test("L6 只把 canonical source 与固定协议的无争议自评计入 C/N", () => {
  const sources = [
    attempt("a-unrecorded", "m1", "correct", "2026-09-10"),
    attempt("a-valid-high", "m1", "wrong", "2026-09-11"),
    attempt("a-valid-low", "m1", "correct", "2026-09-12"),
    attempt("a-legacy", "m1", "wrong", "2026-09-12T09:00:00.000Z"),
    attempt("a-no-protocol", "m1", "correct", "2026-09-13"),
    attempt("a-disputed", "m1", "correct", "2026-09-13T09:00:00.000Z"),
    attempt("a-invalid", "m1", "uncertain", "2026-09-14"),
  ];
  const events = [
    confidenceEvent(sources[1], 5),
    confidenceEvent(sources[1], 5, { outcome: "wrong" }),
    confidenceEvent(sources[1], 5, { outcome: "correct" }),
    confidenceEvent(sources[2], 2),
    confidenceEvent(sources[3], 80, { selfConfidenceProtocol: undefined }),
    { ...learningEventFromReviewAttempt(sources[4]), selfConfidence: 4 },
    confidenceEvent(sources[5], 5),
    confidenceEvent(sources[5], 4),
    { ...learningEventFromReviewAttempt(sources[6]), selfConfidence: 6, selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1 },
  ];
  const evidence = deriveLearningEvidence({ attempts: sources, learningEvents: events, now, range: "all" });

  assert.equal(evidence.calibration.eligibleAttemptCount, sources.length);
  assert.equal(evidence.calibration.confidenceCount, 2);
  assert.equal(evidence.calibration.highConfidenceCount, 1);
  assert.equal(evidence.calibration.highConfidenceWrongCount, 1);
  assert.equal(evidence.calibration.lowConfidenceCount, 1);
  assert.equal(evidence.calibration.lowConfidenceCorrectCount, 1);
  assert.deepEqual(evidence.calibration.confidenceRecords.map((record) => record.sourceId).sort(), ["a-valid-high", "a-valid-low"]);
  assert.deepEqual(evidence.calibration.mismatches.map((record) => record.kind).sort(), ["high_confidence_wrong", "low_confidence_correct"]);
  assert.equal(evidence.calibration.confidenceRecords.some((record) => (record.selfConfidence as number) === 80), false);
});

test("L6 不在重复事件中选择 winner，core conflict 不能替换来源事实", () => {
  const source = attempt("duplicate", "m1", "wrong", "2026-09-13");
  const canonical = learningEventFromReviewAttempt(source);
  const evidence = deriveLearningEvidence({
    attempts: [source],
    learningEvents: [
      { ...canonical, outcome: "correct" },
      { ...canonical, selfConfidence: 5, selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1 },
      { ...canonical, selfConfidence: 4, selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1 },
    ],
    now,
    range: 7,
  });
  assert.equal(evidence.calibration.eligibleAttemptCount, 1);
  assert.equal(evidence.calibration.confidenceCount, 0);
  assert.equal(evidence.calibration.mismatches.length, 0);
});

test("L6 按主体历史重新派生现存 ordinal，不信任持久化 attemptOrdinal", () => {
  const sources = [
    attempt("z-date-only", "m1", "wrong", "2026-09-10"),
    attempt("a-date-only", "m1", "correct", "2026-09-10"),
    attempt("later-day", "m1", "correct", "2026-09-11"),
  ];
  const evidence = deriveLearningEvidence({
    attempts: sources,
    learningEvents: sources.map((source) => confidenceEvent(source, 3, { attemptOrdinal: 99 })),
    now,
    range: "all",
  });
  const byId = new Map(evidence.calibration.confidenceRecords.map((record) => [record.sourceId, record.attemptOrdinal]));
  assert.equal(byId.get("a-date-only"), 1);
  assert.equal(byId.get("z-date-only"), 2);
  assert.equal(byId.get("later-day"), 3);
  const reversed = deriveLearningEvidence({
    attempts: [...sources].reverse(),
    learningEvents: [...sources].reverse().map((source) => confidenceEvent(source, 3)),
    now,
    range: "all",
  });
  assert.deepEqual([...reversed.calibration.confidenceRecords].sort((left, right) => left.sourceId.localeCompare(right.sourceId)), [...evidence.calibration.confidenceRecords].sort((left, right) => left.sourceId.localeCompare(right.sourceId)));
});

test("L6 跨日单位按主体×不同学习日保守折叠，当前日可配对范围外前一日", () => {
  const sources = [
    attempt("m-day-09-wrong", "m1", "wrong", "2026-09-09"),
    attempt("m-day-09-correct", "m1", "correct", "2026-09-09T12:00:00.000Z"),
    attempt("m-day-10-uncertain", "m1", "uncertain", "2026-09-10"),
    attempt("m-day-10-correct", "m1", "correct", "2026-09-10T12:00:00.000Z"),
    attempt("m-day-11-correct", "m1", "correct", "2026-09-11"),
    attempt("m2-old", "m2", "wrong", "2026-08-01"),
    attempt("m2-current", "m2", "correct", "2026-09-14"),
    attempt("future", "m1", "correct", "2026-09-15"),
  ];
  const evidence = deriveLearningEvidence({ attempts: sources, now, range: 7 });
  assert.equal(evidence.delayedRecall.denominator, 3);
  assert.equal(evidence.delayedRecall.correctCount, 2);
  assert.deepEqual(evidence.delayedRecall.pairs.map((pair) => [pair.previousStudyDay, pair.currentStudyDay, pair.currentOutcome]), [
    ["2026-08-01", "2026-09-14", "correct"],
    ["2026-09-10", "2026-09-11", "correct"],
    ["2026-09-09", "2026-09-10", "uncertain"],
  ]);
  assert.equal(evidence.delayedRecall.pairs.some((pair) => pair.currentStudyDay === "2026-09-15"), false);
});

test("L6 排除未来 timestamp，即使民用日仍为今天", () => {
  const futureToday = attempt("future-time", "m1", "correct", "2026-09-14T13:00:00.000Z");
  const evidence = deriveLearningEvidence({ attempts: [futureToday], now, range: "all" });
  assert.equal(evidence.calibration.eligibleAttemptCount, 0);
  assert.equal(evidence.delayedRecall.denominator, 0);
});

test("L6 同时接受 review_attempt 与 knowledge_attempt，且不生成平均分或概率字段", () => {
  const review = attempt("review", "m1", "wrong", "2026-09-13");
  const knowledge = knowledgeAttempt("knowledge", "k1", "correct", "2026-09-14");
  const evidence = deriveLearningEvidence({
    attempts: [review],
    knowledgeAttempts: [knowledge],
    learningEvents: [confidenceEvent(review, 5), {
      ...learningEventFromKnowledgeAttempt(knowledge),
      selfConfidence: 2,
      selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1,
    }],
    now,
    range: "all",
  });
  assert.equal(evidence.calibration.eligibleAttemptCount, 2);
  assert.equal(evidence.calibration.confidenceCount, 2);
  assert.equal("averageConfidence" in evidence.calibration, false);
  assert.equal("calibrationScore" in evidence.calibration, false);
  assert.equal("probability" in evidence.delayedRecall, false);
});

test("固定协议自评不进入通用 L4 投影，旧无协议 selfConfidence 仍可恢复", () => {
  const source = attempt("projection", "m1", "wrong", "2026-09-13");
  const canonical = learningEventFromReviewAttempt(source);
  const l6 = { ...canonical, selfConfidence: 5, selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1 };
  const legacy = { ...canonical, selfConfidence: 80 };
  assert.equal(enrichCanonicalLearningEvent(canonical, l6).selfConfidence, undefined);
  assert.equal(enrichCanonicalLearningEvent(canonical, legacy).selfConfidence, 80);
});
