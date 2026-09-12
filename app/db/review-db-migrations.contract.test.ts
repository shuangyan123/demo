import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import Dexie from "dexie";
import { reviewDb } from "./review-db.ts";
import { REVIEW_DB_NAME } from "./review-db-migrations.ts";

const reviewedAt = "2026-08-09";

async function removeReviewDatabase(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
}

async function seedLegacyV16(records: { attempts?: unknown[]; knowledgeAttempts?: unknown[] }): Promise<void> {
  await removeReviewDatabase();
  const legacy = new Dexie(REVIEW_DB_NAME);
  legacy.version(16).stores({
    mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
    attempts: "&id, mistakeId, reviewedAt, result",
    knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
    knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
  });
  await legacy.open();
  if (records.attempts?.length) await legacy.table("attempts").bulkPut(records.attempts);
  if (records.knowledgeAttempts?.length) await legacy.table("knowledgeAttempts").bulkPut(records.knowledgeAttempts);
  legacy.close();
  await reviewDb.open();
}

test("v16 existing review Attempt backfills exactly one LearningEvent", async () => {
  await seedLegacyV16({
    attempts: [{ id: "attempt-review-1", mistakeId: "mistake-1", result: "wrong", confidence: 2, durationSec: 41, reviewedAt }],
  });

  assert.equal(reviewDb.verno, 17);
  const events = await reviewDb.learningEvents.toArray();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: "review_attempt:attempt-review-1",
    sourceType: "review_attempt",
    sourceId: "attempt-review-1",
    subjectType: "mistake",
    subjectId: "mistake-1",
    outcome: "wrong",
    observedAt: reviewedAt,
    masteryAfter: 2,
    durationSec: 41,
  });
  assert.equal("selfConfidence" in events[0]!, false);

  reviewDb.close();
  await reviewDb.open();
  assert.equal(await reviewDb.learningEvents.count(), 1);
});

test("v16 existing KnowledgeAttempt backfills exactly one LearningEvent", async () => {
  await seedLegacyV16({
    knowledgeAttempts: [{ id: "attempt-knowledge-1", knowledgeId: "knowledge-1", result: "correct", confidence: 4, reviewedAt }],
  });

  const events = await reviewDb.learningEvents.toArray();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    id: "knowledge_attempt:attempt-knowledge-1",
    sourceType: "knowledge_attempt",
    sourceId: "attempt-knowledge-1",
    subjectType: "knowledge",
    subjectId: "knowledge-1",
    outcome: "correct",
    observedAt: reviewedAt,
    masteryAfter: 4,
  });
  assert.equal("selfConfidence" in events[0]!, false);
});

test.after(async () => {
  await removeReviewDatabase();
});
