import assert from "node:assert/strict";
import test from "node:test";
import type { ImportDraftConfirmation } from "../../services/import-draft-repository.ts";
import type { ImportJob, PersistedImportDraft } from "../../types/domains/import.ts";
import type { Mistake } from "../../types/domains/review.ts";
import { confirmImportDrafts, type ConfirmImportDraftsDependencies } from "./confirm-import-drafts.ts";
import { ImportApplicationError } from "./import-application.ts";

const today = new Date("2026-08-09T08:00:00.000Z");

function draft(id: string, stem: string): PersistedImportDraft {
  return {
    id,
    batchId: "batch-1",
    selected: true,
    needsReview: false,
    issues: [],
    board: "判断推理",
    source: "测试导入",
    stem,
    options: [],
    answer: "A",
    myAnswer: "B",
    explanation: "解析",
    reasons: ["误判"],
    tags: ["导入"],
    mastery: 2,
    rawText: "",
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
}

function mistakeFromDraft(item: PersistedImportDraft): Mistake {
  return {
    id: `mistake-${item.id}`,
    board: item.board,
    source: item.source,
    stem: item.stem,
    answer: item.answer,
    explanation: item.explanation,
    reasons: item.reasons,
    tags: item.tags,
    mastery: item.mastery,
    nextReviewAt: today.toISOString(),
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
}

function harness({ failAt }: { failAt?: "confirm" | "job" } = {}) {
  const calls: string[] = [];
  const drafts = new Map([
    ["valid-1", draft("valid-1", "有效题干一")],
    ["valid-2", draft("valid-2", "有效题干二")],
    ["empty", draft("empty", "   ")],
  ]);
  const dependencies: ConfirmImportDraftsDependencies = {
    async confirmDrafts(ids): Promise<ImportDraftConfirmation> {
      calls.push(`confirm:${ids.join(",")}`);
      if (failAt === "confirm") throw new Error("确认 transaction 失败");
      const confirmedDrafts = ids
        .map((id) => drafts.get(id))
        .filter((item): item is PersistedImportDraft => Boolean(item?.stem.trim()));
      return { confirmedDrafts, createdMistakes: confirmedDrafts.map(mistakeFromDraft) };
    },
    async createImportJob(input): Promise<ImportJob> {
      calls.push(`job:${input.parsedCount}`);
      if (failAt === "job") throw new Error("ImportJob 写入失败");
      return { ...input, id: "job-1", createdAt: today.toISOString() };
    },
  };
  return { calls, dependencies };
}

async function captureApplicationError(promise: Promise<unknown>): Promise<ImportApplicationError> {
  try {
    await promise;
    assert.fail("expected ImportApplicationError");
  } catch (error) {
    assert.ok(error instanceof ImportApplicationError);
    return error;
  }
}

test("多条有效草稿按真实确认数量写入 ImportJob 并返回稳定 receipt", async () => {
  const state = harness();
  const result = await confirmImportDrafts({
    draftIds: ["valid-1", "valid-2"],
    today,
    dependencies: state.dependencies,
  });

  assert.deepEqual(result.confirmedDraftIds, ["valid-1", "valid-2"]);
  assert.equal(result.createdMistakes.length, 2);
  assert.deepEqual(result.skippedDraftIds, []);
  assert.equal(result.importJob.parsedCount, 2);
  assert.deepEqual(state.calls, ["confirm:valid-1,valid-2", "job:2"]);
});

test("不存在和空题干 ID 被跳过且撤销数据只来自实际确认集合", async () => {
  const state = harness();
  const result = await confirmImportDrafts({
    draftIds: ["valid-1", "missing", "empty"],
    today,
    dependencies: state.dependencies,
  });

  assert.deepEqual(result.requestedDraftIds, ["valid-1", "missing", "empty"]);
  assert.deepEqual(result.confirmedDraftIds, ["valid-1"]);
  assert.deepEqual(result.skippedDraftIds, ["missing", "empty"]);
  assert.deepEqual(result.confirmedDrafts.map((item) => item.id), ["valid-1"]);
  assert.deepEqual(result.createdMistakes.map((item) => item.id), ["mistake-valid-1"]);
  assert.equal(result.importJob.parsedCount, 1);
});

test("确认 transaction 失败时不执行 bookkeeping 且允许安全重试", async () => {
  const state = harness({ failAt: "confirm" });
  const error = await captureApplicationError(confirmImportDrafts({
    draftIds: ["valid-1"],
    today,
    dependencies: state.dependencies,
  }));

  assert.equal(error.step, "confirm-drafts");
  assert.equal(error.retrySafety, "safe");
  assert.match((error.cause as Error).message, /确认 transaction 失败/);
  assert.deepEqual(error.partialResult, {});
  assert.deepEqual(state.calls, ["confirm:valid-1"]);
});

test("确认已提交但 ImportJob 失败时暴露真实 partial success 且不重复确认", async () => {
  const state = harness({ failAt: "job" });
  const error = await captureApplicationError(confirmImportDrafts({
    draftIds: ["valid-1", "missing", "empty"],
    today,
    dependencies: state.dependencies,
  }));

  assert.equal(error.step, "record-import-job");
  assert.equal(error.retrySafety, "manual-only");
  assert.match((error.cause as Error).message, /ImportJob 写入失败/);
  assert.deepEqual(error.partialResult.confirmation?.confirmedDraftIds, ["valid-1"]);
  assert.deepEqual(error.partialResult.confirmation?.skippedDraftIds, ["missing", "empty"]);
  assert.deepEqual(error.partialResult.confirmation?.confirmedDrafts.map((item) => item.id), ["valid-1"]);
  assert.deepEqual(error.partialResult.confirmation?.createdMistakes.map((item) => item.id), ["mistake-valid-1"]);
  assert.deepEqual(state.calls, ["confirm:valid-1,missing,empty", "job:1"]);
});

test("没有实际确认提交时 ImportJob 失败仍允许安全重试", async () => {
  const state = harness({ failAt: "job" });
  const error = await captureApplicationError(confirmImportDrafts({
    draftIds: ["missing", "empty"],
    today,
    dependencies: state.dependencies,
  }));

  assert.equal(error.step, "record-import-job");
  assert.equal(error.retrySafety, "safe");
  assert.deepEqual(error.partialResult.confirmation?.confirmedDraftIds, []);
  assert.deepEqual(error.partialResult.confirmation?.skippedDraftIds, ["missing", "empty"]);
  assert.deepEqual(state.calls, ["confirm:missing,empty", "job:0"]);
});
