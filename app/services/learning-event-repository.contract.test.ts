import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import Dexie from "dexie";
import { reviewDb } from "../db/review-db.ts";
import { learningEventFromKnowledgeAttempt, learningEventFromReviewAttempt, learningEventId, type LearningEvent } from "../types/domains/learning-event.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { Attempt, Mistake } from "../types/domains/review.ts";
import { learningEventRepository } from "./learning-event-repository.ts";
import { knowledgeRepository } from "./knowledge-repository.ts";
import { loadLearnerStateSnapshot } from "./learner-state-service.ts";
import { localDataManagementRepository, type LocalDataExportV2 } from "./local-data-management-repository.ts";
import { reviewRepository } from "./review-repository.ts";

const today = new Date("2026-08-09T08:00:00.000Z");
const date = "2026-08-09";

async function resetReviewDb(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

function mistake(id: string, mastery = 2): Mistake {
  return {
    id,
    board: "判断推理",
    source: "learning-event-contract",
    stem: `题干 ${id}`,
    answer: "A",
    explanation: "解析",
    reasons: ["条件关系"],
    tags: [],
    mastery,
    nextReviewAt: date,
    createdAt: date,
    updatedAt: date,
  };
}

function knowledge(id: string, mastery = 2): KnowledgeEntry {
  return {
    id,
    category: "常识判断",
    title: `知识 ${id}`,
    summary: "摘要",
    content: "正文",
    tags: [],
    source: "learning-event-contract",
    favorite: false,
    mastery,
    nextReviewAt: date,
    reviewCount: 0,
    createdAt: date,
    updatedAt: date,
  };
}

function eventForSource(sourceId: string, subjectId: string, observedAt: string): LearningEvent {
  return {
    id: learningEventId("review_attempt", sourceId),
    sourceType: "review_attempt",
    sourceId,
    subjectType: "mistake",
    subjectId,
    outcome: "correct",
    observedAt,
    masteryAfter: 3,
  };
}

test("reviewRepository.recordReview 保留旧签名并在同一事务写入 Attempt 与 LearningEvent", async () => {
  await resetReviewDb();
  const item = mistake("mistake-review");
  await reviewDb.mistakes.put(item);

  await reviewRepository.recordReview(item, "correct", today, 37);
  const [attempt] = await reviewDb.attempts.toArray();
  assert.ok(attempt);
  assert.equal((await reviewDb.mistakes.get(item.id))?.mastery, 3);
  assert.deepEqual(await learningEventRepository.getBySource("review_attempt", attempt.id), {
    id: `review_attempt:${attempt.id}`,
    sourceType: "review_attempt",
    sourceId: attempt.id,
    subjectType: "mistake",
    subjectId: item.id,
    outcome: "correct",
    observedAt: attempt.reviewedAt,
    masteryAfter: 3,
    durationSec: 37,
  });

  const noDuration = mistake("mistake-old-signature");
  await reviewDb.mistakes.put(noDuration);
  await reviewRepository.recordReview(noDuration, "uncertain", today);
  const oldSignatureAttempt = (await reviewDb.attempts.toArray()).find((candidate) => candidate.mistakeId === noDuration.id);
  assert.ok(oldSignatureAttempt);
  const oldSignatureEvent = await learningEventRepository.getBySource("review_attempt", oldSignatureAttempt.id);
  assert.ok(oldSignatureEvent);
  assert.equal("durationSec" in oldSignatureEvent, false);
  assert.deepEqual(Object.keys(oldSignatureEvent).toSorted(), [
    "id", "masteryAfter", "observedAt", "outcome", "sourceId", "sourceType", "subjectId", "subjectType",
  ]);
});

test("reviewRepository.recordReview 写入 LearningEvent 失败时回滚错题和 Attempt", async () => {
  await resetReviewDb();
  const item = mistake("mistake-atomic-review");
  await reviewDb.mistakes.put(item);
  const originalAdd = reviewDb.learningEvents.add.bind(reviewDb.learningEvents);
  Object.defineProperty(reviewDb.learningEvents, "add", {
    configurable: true,
    value: async () => { throw new Error("learning-event-write-failed"); },
  });
  try {
    await assert.rejects(() => reviewRepository.recordReview(item, "wrong", today, 12), /learning-event-write-failed/);
  } finally {
    Object.defineProperty(reviewDb.learningEvents, "add", { configurable: true, value: originalAdd });
  }
  assert.deepEqual(await reviewDb.mistakes.get(item.id), item);
  assert.equal(await reviewDb.attempts.count(), 0);
  assert.equal(await reviewDb.learningEvents.count(), 0);
});

test("knowledgeRepository.recordReview 保留旧签名并在同一事务写入 KnowledgeAttempt 与 LearningEvent", async () => {
  await resetReviewDb();
  const entry = knowledge("knowledge-review");
  await reviewDb.knowledgeEntries.put(entry);

  await knowledgeRepository.recordReview(entry, "wrong", today);
  const [attempt] = await reviewDb.knowledgeAttempts.toArray();
  assert.ok(attempt);
  assert.equal((await reviewDb.knowledgeEntries.get(entry.id))?.mastery, 1);
  assert.deepEqual(await learningEventRepository.getBySource("knowledge_attempt", attempt.id), {
    id: `knowledge_attempt:${attempt.id}`,
    sourceType: "knowledge_attempt",
    sourceId: attempt.id,
    subjectType: "knowledge",
    subjectId: entry.id,
    outcome: "wrong",
    observedAt: attempt.reviewedAt,
    masteryAfter: 1,
  });
  assert.equal("selfConfidence" in (await learningEventRepository.getBySource("knowledge_attempt", attempt.id))!, false);
});

test("knowledgeRepository.recordReview 写入 LearningEvent 失败时回滚知识资料和 KnowledgeAttempt", async () => {
  await resetReviewDb();
  const entry = knowledge("knowledge-atomic");
  await reviewDb.knowledgeEntries.put(entry);
  const originalAdd = reviewDb.learningEvents.add.bind(reviewDb.learningEvents);
  Object.defineProperty(reviewDb.learningEvents, "add", {
    configurable: true,
    value: async () => { throw new Error("learning-event-write-failed"); },
  });
  try {
    await assert.rejects(() => knowledgeRepository.recordReview(entry, "correct", today), /learning-event-write-failed/);
  } finally {
    Object.defineProperty(reviewDb.learningEvents, "add", { configurable: true, value: originalAdd });
  }
  assert.deepEqual(await reviewDb.knowledgeEntries.get(entry.id), entry);
  assert.equal(await reviewDb.knowledgeAttempts.count(), 0);
  assert.equal(await reviewDb.learningEvents.count(), 0);
});

test("LearningEvent subject/recent reads use subject filtering and deterministic newest ordering", async () => {
  await resetReviewDb();
  await reviewDb.learningEvents.bulkPut([
    eventForSource("attempt-b", "mistake-1", "2026-08-09T10:00:00.000Z"),
    eventForSource("attempt-a", "mistake-1", "2026-08-09T10:00:00.000Z"),
    eventForSource("attempt-c", "mistake-2", "2026-08-10T10:00:00.000Z"),
    {
      id: learningEventId("knowledge_attempt", "knowledge-attempt-a"),
      sourceType: "knowledge_attempt",
      sourceId: "knowledge-attempt-a",
      subjectType: "knowledge",
      subjectId: "knowledge-1",
      outcome: "uncertain",
      observedAt: "2026-08-11T10:00:00.000Z",
      masteryAfter: 2,
    },
  ]);

  assert.deepEqual((await learningEventRepository.listForSubject("mistake", "mistake-1")).map((event) => event.id), [
    "review_attempt:attempt-a",
    "review_attempt:attempt-b",
  ]);
  assert.deepEqual((await learningEventRepository.listRecent(3)).map((event) => event.id), [
    "knowledge_attempt:knowledge-attempt-a",
    "review_attempt:attempt-c",
    "review_attempt:attempt-a",
  ]);
});

test("删除错题或知识资料会在同一事务清理对应 LearningEvent", async () => {
  await resetReviewDb();
  const reviewItem = mistake("mistake-delete");
  const knowledgeItem = knowledge("knowledge-delete");
  await reviewDb.mistakes.put(reviewItem);
  await reviewDb.knowledgeEntries.put(knowledgeItem);
  await reviewRepository.recordReview(reviewItem, "wrong", today);
  await knowledgeRepository.recordReview(knowledgeItem, "correct", today);
  assert.equal(await reviewDb.learningEvents.count(), 2);

  await reviewRepository.removeMistake(reviewItem.id);
  assert.equal(await reviewDb.attempts.where("mistakeId").equals(reviewItem.id).count(), 0);
  assert.equal(await learningEventRepository.listForSubject("mistake", reviewItem.id).then((events) => events.length), 0);
  assert.ok(await learningEventRepository.listForSubject("knowledge", knowledgeItem.id).then((events) => events[0]));

  await knowledgeRepository.remove(knowledgeItem.id);
  assert.equal(await reviewDb.knowledgeAttempts.where("knowledgeId").equals(knowledgeItem.id).count(), 0);
  assert.equal(await learningEventRepository.listForSubject("knowledge", knowledgeItem.id).then((events) => events.length), 0);
});

test("clearAll 清理全部 LearningEvent 但保留现有知识资料删除语义", async () => {
  await resetReviewDb();
  const reviewItem = mistake("mistake-clear");
  const knowledgeItem = knowledge("knowledge-clear");
  await reviewDb.mistakes.put(reviewItem);
  await reviewDb.knowledgeEntries.put(knowledgeItem);
  await reviewRepository.recordReview(reviewItem, "correct", today);
  await knowledgeRepository.recordReview(knowledgeItem, "uncertain", today);

  await reviewRepository.clearAll();
  assert.equal(await reviewDb.learningEvents.count(), 0);
  assert.equal(await reviewDb.mistakes.count(), 0);
  assert.equal(await reviewDb.attempts.count(), 0);
  assert.equal(await reviewDb.knowledgeEntries.count(), 1);
  assert.equal(await reviewDb.knowledgeAttempts.count(), 1);
});

test("分域清理错题时只删除错题 LearningEvent，保留知识训练历史", async () => {
  await resetReviewDb();
  const reviewItem = mistake("mistake-scoped-clear");
  const knowledgeItem = knowledge("knowledge-scoped-clear");
  await reviewDb.mistakes.put(reviewItem);
  await reviewDb.knowledgeEntries.put(knowledgeItem);
  await reviewRepository.recordReview(reviewItem, "correct", today);
  await knowledgeRepository.recordReview(knowledgeItem, "correct", today);

  await localDataManagementRepository.clearMistakeReviews();
  assert.equal(await learningEventRepository.listForSubject("mistake", reviewItem.id).then((events) => events.length), 0);
  assert.equal(await learningEventRepository.listForSubject("knowledge", knowledgeItem.id).then((events) => events.length), 1);
  assert.equal(await reviewDb.knowledgeEntries.count(), 1);
});

test("learner-state 仍只依赖既有 Attempt/KnowledgeAttempt，LearningEvent 存在不改变输出", async () => {
  await resetReviewDb();
  const reviewItem = mistake("mistake-state");
  const knowledgeItem = knowledge("knowledge-state");
  const reviewAttempt: Attempt = { id: "attempt-state", mistakeId: reviewItem.id, result: "wrong", confidence: 2, reviewedAt: date };
  const knowledgeAttempt: KnowledgeAttempt = { id: "knowledge-attempt-state", knowledgeId: knowledgeItem.id, result: "uncertain", confidence: 2, reviewedAt: date };
  await reviewDb.mistakes.put(reviewItem);
  await reviewDb.attempts.put(reviewAttempt);
  await reviewDb.knowledgeEntries.put(knowledgeItem);
  await reviewDb.knowledgeAttempts.put(knowledgeAttempt);

  const before = await loadLearnerStateSnapshot(today);
  await reviewDb.learningEvents.bulkPut([
    learningEventFromReviewAttempt(reviewAttempt),
    learningEventFromKnowledgeAttempt(knowledgeAttempt),
  ]);
  const after = await loadLearnerStateSnapshot(today);
  assert.deepEqual(after, before);
});

test("完整本地备份包含 LearningEvent，恢复可读且拒绝悬空事件", async () => {
  await resetReviewDb();
  const reviewItem = mistake("mistake-backup");
  const attempt: Attempt = { id: "attempt-backup", mistakeId: reviewItem.id, result: "correct", confidence: 3, reviewedAt: date, durationSec: 29 };
  const learningEvent = learningEventFromReviewAttempt(attempt);
  await reviewDb.mistakes.put(reviewItem);
  await reviewDb.attempts.put(attempt);
  await reviewDb.learningEvents.put(learningEvent);

  const source = await localDataManagementRepository.exportAll();
  const exported = JSON.parse(source) as LocalDataExportV2;
  assert.equal(exported.manifest.schemaVersions.review_workspace, 17);
  assert.deepEqual(exported.databases.review_workspace.learningEvents, [learningEvent]);
  assert.ok(exported.manifest.includedStores.review_workspace.includes("learningEvents"));

  const orphan = JSON.parse(source) as LocalDataExportV2;
  orphan.databases.review_workspace.learningEvents.push({ ...learningEvent, id: "review_attempt:missing", sourceId: "missing" });
  delete (orphan as Partial<LocalDataExportV2>).manifest;
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(orphan)), /learningEvents.*悬空关联/);

  await reviewDb.mistakes.clear();
  await reviewDb.attempts.clear();
  await reviewDb.learningEvents.clear();
  const preview = await localDataManagementRepository.inspectRestore(source);
  await localDataManagementRepository.restore(preview);
  assert.deepEqual(await reviewDb.learningEvents.get(learningEvent.id), learningEvent);
});

test.after(async () => {
  reviewDb.close();
  await Promise.all([reviewDb.delete(), Dexie.delete("review_workspace_transfer")]);
});
