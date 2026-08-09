import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { ImportBatch, PersistedImportDraft } from "../types/domains/import.ts";
import { importDraftRepository } from "./import-draft-repository.ts";

const today = new Date("2026-08-09T08:00:00.000Z");
const createdAt = "2026-08-09T07:00:00.000Z";

function batch(id: string, savedCount: number): ImportBatch {
  return {
    id,
    source: "text",
    fileNames: [id],
    fileCount: 1,
    status: "parsed",
    parsedCount: 2,
    savedCount,
    message: "待确认",
    createdAt,
    updatedAt: createdAt,
  };
}

function draft(id: string, batchId: string, stem: string): PersistedImportDraft {
  return {
    id,
    batchId,
    selected: true,
    needsReview: false,
    issues: [],
    board: "判断推理",
    source: "Repository contract",
    stem,
    options: [],
    answer: "A",
    myAnswer: "B",
    explanation: "解析",
    reasons: ["误判"],
    tags: ["import"],
    mastery: 2,
    rawText: "",
    createdAt,
    updatedAt: createdAt,
  };
}

async function resetDatabase(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

test("混合批次只确认有效草稿并按真实集合精确撤销", async (context) => {
  await resetDatabase();
  context.after(async () => {
    reviewDb.close();
    await reviewDb.delete();
  });

  await reviewDb.importBatches.bulkAdd([batch("batch-a", 2), batch("batch-b", 1)]);
  await reviewDb.importDrafts.bulkAdd([
    draft("valid-a", "batch-a", "有效题干 A"),
    draft("invalid-a", "batch-a", "   "),
    draft("valid-b", "batch-b", "有效题干 B"),
  ]);

  const confirmation = await importDraftRepository.confirmDrafts(
    ["valid-a", "invalid-a", "missing", "valid-b"],
    today,
  );

  assert.deepEqual(confirmation.confirmedDrafts.map((item) => item.id).sort(), ["valid-a", "valid-b"]);
  assert.equal(confirmation.createdMistakes.length, 2);
  assert.deepEqual((await reviewDb.importDrafts.toArray()).map((item) => item.id), ["invalid-a"]);
  assert.equal((await reviewDb.importBatches.get("batch-a"))?.savedCount, 3);
  assert.equal((await reviewDb.importBatches.get("batch-a"))?.status, "parsed");
  assert.equal((await reviewDb.importBatches.get("batch-b"))?.savedCount, 2);
  assert.equal((await reviewDb.importBatches.get("batch-b"))?.status, "saved");

  await importDraftRepository.undoConfirmation(
    confirmation.createdMistakes.map((item) => item.id),
    confirmation.confirmedDrafts,
    today,
  );

  assert.equal(await reviewDb.mistakes.count(), 0);
  assert.deepEqual((await reviewDb.importDrafts.toArray()).map((item) => item.id).sort(), ["invalid-a", "valid-a", "valid-b"]);
  assert.equal((await reviewDb.importBatches.get("batch-a"))?.savedCount, 2);
  assert.equal((await reviewDb.importBatches.get("batch-b"))?.savedCount, 1);
  assert.equal((await reviewDb.importBatches.get("batch-a"))?.status, "parsed");
  assert.equal((await reviewDb.importBatches.get("batch-b"))?.status, "parsed");
});
