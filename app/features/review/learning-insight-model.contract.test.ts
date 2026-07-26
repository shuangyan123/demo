import assert from "node:assert/strict";
import test from "node:test";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import { deriveLearningInsightSnapshot } from "./learning-insight-model.ts";

const now = new Date("2026-07-23T12:00:00.000Z");

function mistake(id: string, board: Mistake["board"], mastery = 2, nextReviewAt = "2026-07-22"): Mistake {
  return {
    id,
    board,
    source: "契约测试",
    stem: `${board} ${id}`,
    answer: "A",
    explanation: "依据",
    reasons: ["审题"],
    tags: [],
    mastery,
    nextReviewAt,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

function attempt(id: string, mistakeId: string, result: Attempt["result"], reviewedAt: string): Attempt {
  return { id, mistakeId, result, confidence: 3, reviewedAt };
}

const knowledge: KnowledgeEntry = {
  id: "knowledge-1",
  category: "常识判断",
  title: "行政法",
  summary: "行政法基础",
  content: "正文",
  tags: [],
  source: "契约测试",
  favorite: false,
  mastery: 1,
  nextReviewAt: "2026-07-22",
  reviewCount: 0,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

test("薄弱分析按日期范围聚合，并忽略失去错题关联的复盘", () => {
  const mistakes = [mistake("m1", "常识判断"), mistake("m2", "资料分析", 4, "2026-08-01")];
  const attempts = [
    attempt("a1", "m1", "correct", "2026-07-22T08:00:00.000Z"),
    attempt("a2", "m1", "wrong", "2026-07-21T08:00:00.000Z"),
    attempt("old", "m1", "correct", "2026-05-01T08:00:00.000Z"),
    attempt("orphan", "missing", "correct", "2026-07-22T08:00:00.000Z"),
  ];
  const snapshot = deriveLearningInsightSnapshot({ attempts, knowledgeEntries: [knowledge], mistakes, now, range: 30 });

  assert.equal(snapshot.attemptsCount, 2);
  assert.equal(snapshot.correctRate, 50);
  assert.equal(snapshot.dueCount, 2);
  assert.deepEqual(snapshot.trend.map((point) => point.date), ["2026-07-21", "2026-07-22"]);
});

test("板块少于五次有效复盘时保持数据不足，不计算趋势方向", () => {
  const mistakes = [mistake("m1", "常识判断")];
  const attempts = Array.from({ length: 4 }, (_, index) =>
    attempt(`a${index}`, "m1", index > 1 ? "correct" : "wrong", `2026-07-${18 + index}T08:00:00.000Z`),
  );
  const snapshot = deriveLearningInsightSnapshot({ attempts, knowledgeEntries: [], mistakes, now, range: 30 });

  assert.equal(snapshot.boards[0]?.sufficient, false);
  assert.equal(snapshot.boards[0]?.trend, null);
  assert.equal(snapshot.insufficientBoards, 1);
});

test("达到五次后只按前后复盘正确率判断可靠趋势", () => {
  const mistakes = [mistake("m1", "判断推理")];
  const attempts = [
    attempt("a1", "m1", "wrong", "2026-07-17T08:00:00.000Z"),
    attempt("a2", "m1", "wrong", "2026-07-18T08:00:00.000Z"),
    attempt("a3", "m1", "correct", "2026-07-19T08:00:00.000Z"),
    attempt("a4", "m1", "correct", "2026-07-20T08:00:00.000Z"),
    attempt("a5", "m1", "correct", "2026-07-21T08:00:00.000Z"),
  ];
  const snapshot = deriveLearningInsightSnapshot({ attempts, knowledgeEntries: [], mistakes, now, range: 30 });

  assert.equal(snapshot.boards[0]?.sufficient, true);
  assert.equal(snapshot.boards[0]?.trend, "up");
});
