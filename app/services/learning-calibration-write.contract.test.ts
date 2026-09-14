import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import {
  SELF_CONFIDENCE_PROTOCOL_V1,
  validateLearningAttemptEvidence,
} from "../types/domains/learning-event.ts";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { Mistake } from "../types/domains/review.ts";
import { knowledgeRepository } from "./knowledge-repository.ts";
import { learningEventRepository } from "./learning-event-repository.ts";
import { reviewRepository } from "./review-repository.ts";

const today = new Date("2026-08-09T08:00:00.000Z");
const tomorrow = new Date("2026-08-10T08:00:00.000Z");
const date = "2026-08-09";

async function resetReviewDb(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

function mistake(id: string, mastery = 2): Mistake {
  return { id, board: "判断推理", source: "L6 contract", stem: `题干 ${id}`, answer: "A", explanation: "解析", reasons: ["条件关系"], tags: [], mastery, nextReviewAt: date, createdAt: date, updatedAt: date };
}

function knowledge(id: string, mastery = 2): KnowledgeEntry {
  return { id, category: "常识判断", title: `知识 ${id}`, summary: "摘要", content: "正文", tags: [], source: "L6 contract", favorite: false, mastery, nextReviewAt: date, reviewCount: 0, createdAt: date, updatedAt: date };
}

test("首方 review/knowledge 写入窄化自评、固定协议和事务内 practiceKind", async () => {
  await resetReviewDb();
  const review = mistake("l6-review");
  const entry = knowledge("l6-knowledge");
  await reviewDb.mistakes.put(review);
  await reviewDb.knowledgeEntries.put(entry);

  await reviewRepository.recordReview(review, "wrong", today, 17, { selfConfidence: 5 });
  await knowledgeRepository.recordReview(entry, "correct", today, { selfConfidence: 2 });

  const reviewAttempt = await reviewDb.attempts.where("mistakeId").equals(review.id).first();
  const knowledgeAttempt = await reviewDb.knowledgeAttempts.where("knowledgeId").equals(entry.id).first();
  assert.ok(reviewAttempt);
  assert.ok(knowledgeAttempt);
  const reviewEvent = await learningEventRepository.getBySource("review_attempt", reviewAttempt.id);
  const knowledgeEvent = await learningEventRepository.getBySource("knowledge_attempt", knowledgeAttempt.id);
  assert.equal(reviewEvent?.selfConfidence, 5);
  assert.equal(reviewEvent?.selfConfidenceProtocol, SELF_CONFIDENCE_PROTOCOL_V1);
  assert.equal(reviewEvent?.practiceKind, "standard");
  assert.equal(reviewEvent?.durationSec, 17);
  assert.equal(knowledgeEvent?.selfConfidence, 2);
  assert.equal(knowledgeEvent?.selfConfidenceProtocol, SELF_CONFIDENCE_PROTOCOL_V1);
  assert.equal(knowledgeEvent?.practiceKind, "standard");
});

test("同一 subject 同一学习日为 retry，下一学习日回到 standard，结果不改变 practiceKind", async () => {
  await resetReviewDb();
  const item = mistake("l6-practice");
  await reviewDb.mistakes.put(item);

  await reviewRepository.recordReview(item, "wrong", today);
  const afterFirst = await reviewDb.mistakes.get(item.id);
  assert.ok(afterFirst);
  await reviewRepository.recordReview(afterFirst, "correct", today);
  const afterSecond = await reviewDb.mistakes.get(item.id);
  assert.ok(afterSecond);
  await reviewRepository.recordReview({ ...afterSecond, nextReviewAt: date }, "uncertain", tomorrow);

  const events = await learningEventRepository.listForSubject("mistake", item.id);
  assert.deepEqual(events.map((event) => event.practiceKind).sort(), ["retry", "standard", "standard"]);
  assert.deepEqual(events.map((event) => event.outcome).sort(), ["correct", "uncertain", "wrong"]);
  assert.equal(events.some((event) => "attemptOrdinal" in event), false);
});

test("L6 写入边界拒绝非法值、任意协议和额外 metadata，不截断、不静默省略", async () => {
  const invalidValues: unknown[] = [0, 6, 1.5, "3", null, Number.NaN, Number.POSITIVE_INFINITY];
  for (const value of invalidValues) {
    assert.throws(() => validateLearningAttemptEvidence({ selfConfidence: value } as never), /1 到 5|窄输入/);
  }
  assert.throws(() => validateLearningAttemptEvidence({ selfConfidence: 4, selfConfidenceProtocol: "other" } as never), /协议或其他扩展字段/);
  assert.equal(validateLearningAttemptEvidence(undefined), undefined);
  assert.equal(validateLearningAttemptEvidence({}), undefined);

  await resetReviewDb();
  const item = mistake("l6-invalid-write");
  await reviewDb.mistakes.put(item);
  await assert.rejects(() => reviewRepository.recordReview(item, "correct", today, undefined, { selfConfidence: 6 } as never), /1 到 5/);
  assert.equal(await reviewDb.attempts.count(), 0);
  assert.equal(await reviewDb.learningEvents.count(), 0);
  assert.deepEqual(await reviewDb.mistakes.get(item.id), item);
});

test("跳过自信度不写 selfConfidence/protocol，LearningEvent 写入失败时三表仍原子回滚", async () => {
  await resetReviewDb();
  const item = mistake("l6-atomic");
  await reviewDb.mistakes.put(item);
  const originalAdd = reviewDb.learningEvents.add.bind(reviewDb.learningEvents);
  Object.defineProperty(reviewDb.learningEvents, "add", {
    configurable: true,
    value: async () => { throw new Error("l6-event-write-failed"); },
  });
  try {
    await assert.rejects(() => reviewRepository.recordReview(item, "wrong", today, 13, { selfConfidence: 4 }), /l6-event-write-failed/);
  } finally {
    Object.defineProperty(reviewDb.learningEvents, "add", { configurable: true, value: originalAdd });
  }
  assert.deepEqual(await reviewDb.mistakes.get(item.id), item);
  assert.equal(await reviewDb.attempts.count(), 0);
  assert.equal(await reviewDb.learningEvents.count(), 0);

  await reviewRepository.recordReview(item, "uncertain", today);
  const attempt = await reviewDb.attempts.where("mistakeId").equals(item.id).first();
  assert.ok(attempt);
  const event = await learningEventRepository.getBySource("review_attempt", attempt.id);
  assert.equal("selfConfidence" in (event ?? {}), false);
  assert.equal("selfConfidenceProtocol" in (event ?? {}), false);
  assert.equal(event?.practiceKind, "standard");
});
