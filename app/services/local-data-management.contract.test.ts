import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import { localDataManagementRepository } from "./local-data-management-repository.ts";

async function resetDatabase(): Promise<void> {
  reviewDb.close();
  extensionDb.close();
  await Promise.all([reviewDb.delete(), extensionDb.delete()]);
  await reviewDb.open();
  await extensionDb.open();
}

test("数据管理按导入、错题复盘和对话范围独立统计与清理", async () => {
  await resetDatabase();
  const now = "2026-07-14T00:00:00.000Z";
  await reviewDb.importJobs.put({ id: "import", type: "text", status: "parsed", createdAt: now } as never);
  await reviewDb.importBatches.put({ id: "batch", source: "text", status: "parsed", createdAt: now, updatedAt: now } as never);
  await reviewDb.mistakes.put({ id: "mistake", board: "政治理论", source: "test", stem: "题", answer: "答", explanation: "解", reasons: [], tags: [], mastery: 1, nextReviewAt: now, createdAt: now, updatedAt: now } as never);
  await reviewDb.attempts.put({ id: "attempt", mistakeId: "mistake", reviewedAt: now, result: "wrong", masteryAfter: 1 } as never);
  await reviewDb.aiConversationFolders.put({ id: "folder", projectId: "civil-service", label: "测试", createdAt: now, updatedAt: now } as never);
  await reviewDb.aiConversations.put({ id: "conversation", projectId: "civil-service", kind: "general", title: "测试", status: "active", createdAt: now, updatedAt: now } as never);
  await reviewDb.aiConversationMessages.put({ id: "message", conversationId: "conversation", role: "user", content: "测试", createdAt: now } as never);
  await extensionDb.extensions.put({ id: "extension", kind: "theme", enabled: false, installedAt: now, updatedAt: now } as never);

  const summary = await localDataManagementRepository.loadSummary();
  assert.equal(summary.importRecords, 2);
  assert.equal(summary.mistakeReviewRecords, 2);
  assert.equal(summary.conversationRecords, 3);
  assert.equal(summary.extensionRecords, 1);
  const exported = JSON.parse(await localDataManagementRepository.exportAll()) as { databases: { review_extensions: { extensions: unknown[] } } };
  assert.equal(exported.databases.review_extensions.extensions.length, 1);

  await localDataManagementRepository.clearImports();
  assert.equal(await reviewDb.importJobs.count(), 0);
  assert.equal(await reviewDb.mistakes.count(), 1);
  await localDataManagementRepository.clearMistakeReviews();
  assert.equal(await reviewDb.mistakes.count(), 0);
  assert.equal(await reviewDb.aiConversations.count(), 1);
  await localDataManagementRepository.clearConversations();
  assert.equal(await reviewDb.aiConversations.count(), 0);
  assert.equal(await reviewDb.aiConversationFolders.count(), 0);
});

test.after(async () => {
  reviewDb.close();
  extensionDb.close();
  await Promise.all([reviewDb.delete(), extensionDb.delete()]);
});
