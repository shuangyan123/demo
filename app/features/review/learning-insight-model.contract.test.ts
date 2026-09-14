import assert from "node:assert/strict";
import test from "node:test";
import { studyDay } from "../../lib/study-day.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import { compareLearningInsightPriorityItems, deriveLearningInsightSnapshot, selectLearningInsightSignals } from "./learning-insight-model.ts";

const now = new Date("2026-07-23T12:00:00.000Z");

function mistake(id: string, board: Mistake["board"] = "常识判断", mastery = 2, nextReviewAt = "2026-07-22"): Mistake {
  return { id, board, source: "契约测试", stem: `${board} ${id}`, answer: "A", explanation: "依据", reasons: ["审题"], tags: [], mastery, nextReviewAt, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" };
}

function attempt(id: string, mistakeId: string, result: Attempt["result"], reviewedAt: string): Attempt {
  return { id, mistakeId, result, confidence: 3, reviewedAt };
}

function knowledge(id: string, mastery = 1): KnowledgeEntry {
  return { id, category: "常识判断", title: `知识点 ${id}`, summary: "摘要", content: "正文", tags: [], source: "契约测试", favorite: false, mastery, nextReviewAt: "2026-08-01", reviewCount: 0, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" };
}

function knowledgeAttempt(id: string, knowledgeId: string, result: KnowledgeAttempt["result"], reviewedAt: string): KnowledgeAttempt {
  return { id, knowledgeId, result, confidence: 3, reviewedAt };
}

function localOffsetTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

function localCalendarTimestamp(month: number, day: number, hour: number, minute = 0): string {
  return localOffsetTimestamp(new Date(2026, month - 1, day, hour, minute));
}

function localDayTimestamp(day: number, hour: number, minute = 0): string {
  return localCalendarTimestamp(9, day, hour, minute);
}

function derive(input: Partial<Parameters<typeof deriveLearningInsightSnapshot>[0]> = {}) {
  return deriveLearningInsightSnapshot({ attempts: [], knowledgeEntries: [], mistakes: [], now, range: 30, ...input });
}

test("真实结果计数、日期去重和跨日通过率只来自有效复盘", () => {
  const snapshot = derive({
    mistakes: [mistake("m1"), mistake("m2")],
    attempts: [
      attempt("a1", "m1", "wrong", "2026-07-20T08:00:00.000Z"),
      attempt("a2", "m1", "uncertain", "2026-07-20T12:00:00.000Z"),
      attempt("a3", "m1", "correct", "2026-07-21T08:00:00.000Z"),
      attempt("a4", "m1", "wrong", "2026-07-22T08:00:00.000Z"),
      attempt("a5", "m2", "correct", "2026-07-22T08:00:00.000Z"),
      attempt("orphan", "missing", "correct", "2026-07-22T08:00:00.000Z"),
    ],
  });

  assert.equal(snapshot.attemptsCount, 5);
  assert.equal(snapshot.correctCount, 2);
  assert.equal(snapshot.uncertainCount, 1);
  assert.equal(snapshot.wrongCount, 2);
  assert.equal(snapshot.correctRate, 40);
  assert.equal(snapshot.distinctStudyDays, 3);
  assert.equal(snapshot.spacedAttemptCount, 2);
  assert.equal(snapshot.spacedCorrectCount, 1);
  assert.equal(snapshot.spacedCorrectRate, 50);
  assert.equal(snapshot.mistakeMetrics.get("m1")?.attemptCount, 4);
});

test("没有证据时速率为 null，同日重试不构成跨日证据", () => {
  const empty = derive({ mistakes: [mistake("m1")] });
  assert.equal(empty.attemptsCount, 0);
  assert.equal(empty.correctRate, null);
  assert.equal(empty.spacedCorrectRate, null);
  assert.equal(empty.distinctStudyDays, 0);

  const sameDay = derive({
    mistakes: [mistake("m1")],
    attempts: [attempt("a1", "m1", "wrong", "2026-07-20T08:00:00.000Z"), attempt("a2", "m1", "correct", "2026-07-20T12:00:00.000Z")],
  });
  assert.equal(sameDay.spacedAttemptCount, 0);
  assert.equal(sameDay.distinctStudyDays, 1);
});

test("7/30/90 天范围按本地民用日计算，全部范围保留有效历史并排除未来日", () => {
  const localNow = new Date(2026, 8, 14, 12);
  const records = [
    attempt("before", "m1", "wrong", localDayTimestamp(7, 23, 59)),
    attempt("first-early", "m1", "correct", localDayTimestamp(8, 0, 1)),
    attempt("first-late", "m1", "wrong", localDayTimestamp(8, 23, 59)),
    attempt("before-30", "m1", "wrong", localCalendarTimestamp(8, 15, 23, 59)),
    attempt("first-30", "m1", "correct", localCalendarTimestamp(8, 16, 0, 1)),
    attempt("before-90", "m1", "wrong", localCalendarTimestamp(6, 16, 23, 59)),
    attempt("first-90", "m1", "correct", localCalendarTimestamp(6, 17, 0, 1)),
    attempt("future", "m1", "correct", localDayTimestamp(15, 0, 1)),
  ];
  const week = derive({ now: localNow, range: 7, mistakes: [mistake("m1")], attempts: records });
  assert.equal(studyDay(localNow), "2026-09-14");
  assert.equal(week.attemptsCount, 2);
  assert.equal(week.correctCount, 1);
  assert.equal(week.wrongCount, 1);

  const month = derive({ now: localNow, range: 30, mistakes: [mistake("m1")], attempts: records });
  assert.equal(month.attemptsCount, 4);
  const quarter = derive({ now: localNow, range: 90, mistakes: [mistake("m1")], attempts: records });
  assert.equal(quarter.attemptsCount, 6);
  const all = derive({ now: localNow, range: "all", mistakes: [mistake("m1")], attempts: records });
  assert.equal(all.attemptsCount, 7);
  assert.deepEqual(all.trend.map((point) => point.date), ["2026-06-16", "2026-06-17", "2026-08-15", "2026-08-16", "2026-09-07", "2026-09-08"]);
});

test("首个可见趋势点使用范围外但仍在 D-6..D 内的历史，并保持尝试加权", () => {
  const localNow = new Date(2026, 8, 14, 12);
  const snapshot = derive({
    now: localNow,
    range: 7,
    mistakes: [mistake("m1")],
    attempts: [
      attempt("history-before-range", "m1", "correct", localDayTimestamp(7, 12)),
      attempt("selected-wrong-1", "m1", "wrong", localDayTimestamp(8, 9)),
      attempt("selected-wrong-2", "m1", "wrong", localDayTimestamp(8, 10)),
    ],
  });
  assert.equal(snapshot.attemptsCount, 2);
  assert.deepEqual(snapshot.trend.map((point) => point.date), ["2026-09-08"]);
  assert.equal(snapshot.trend[0]?.correctRate, 0);
  assert.equal(snapshot.trend[0]?.movingAverage, 33);
});

test("范围外的更早历史仍可让范围内复盘成为跨日证据", () => {
  const snapshot = derive({
    range: 7,
    mistakes: [mistake("m1")],
    attempts: [attempt("old", "m1", "wrong", "2026-07-01T08:00:00.000Z"), attempt("current", "m1", "correct", "2026-07-22T08:00:00.000Z")],
  });
  assert.equal(snapshot.attemptsCount, 1);
  assert.equal(snapshot.spacedAttemptCount, 1);
  assert.equal(snapshot.spacedCorrectRate, 100);
});

test("恢复证据需要跨日失败、最新跨日答对、当前掌握度至少 3 且未到期", () => {
  const snapshot = derive({
    mistakes: [
      mistake("recovered", "常识判断", 3, "2026-08-01"),
      mistake("same-day", "常识判断", 3, "2026-08-01"),
      mistake("due", "常识判断", 3, "2026-07-23"),
      mistake("weak", "常识判断", 2, "2026-08-01"),
    ],
    attempts: [
      attempt("r1", "recovered", "wrong", "2026-07-18T08:00:00.000Z"),
      attempt("r2", "recovered", "correct", "2026-07-21T08:00:00.000Z"),
      attempt("s1", "same-day", "wrong", "2026-07-20T08:00:00.000Z"),
      attempt("s2", "same-day", "correct", "2026-07-20T12:00:00.000Z"),
      attempt("d1", "due", "wrong", "2026-07-18T08:00:00.000Z"),
      attempt("d2", "due", "correct", "2026-07-21T08:00:00.000Z"),
      attempt("w1", "weak", "wrong", "2026-07-18T08:00:00.000Z"),
      attempt("w2", "weak", "correct", "2026-07-21T08:00:00.000Z"),
    ],
  });
  assert.equal(snapshot.recoveredSubjectCount, 1);
});

test("板块掌握分按 canonical 1..5 映射聚合，趋势七日窗口按尝试加权", () => {
  const snapshot = derive({
    mistakes: [mistake("m1", "常识判断", 1), mistake("m2", "常识判断", 2)],
    attempts: [
      attempt("early", "m1", "correct", "2026-07-17T08:00:00.000Z"),
      ...Array.from({ length: 9 }, (_, index) => attempt(`late-${index}`, "m1", "wrong", `2026-07-23T${String(index).padStart(2, "0")}:00:00.000Z`)),
    ],
  });
  assert.equal(snapshot.boards[0]?.mastery, 1.5);
  assert.equal(snapshot.boards[0]?.masteryScore, 13);
  assert.equal(snapshot.trend.at(-1)?.correctRate, 0);
  assert.equal(snapshot.trend.at(-1)?.movingAverage, 10);
});

test("知识项使用真实 KnowledgeAttempt，零训练记录不制造样本", () => {
  const snapshot = derive({
    knowledgeEntries: [knowledge("k1"), knowledge("k2")],
    knowledgeAttempts: [
      knowledgeAttempt("k-a1", "k1", "correct", "2026-07-21T08:00:00.000Z"),
      knowledgeAttempt("k-a2", "k1", "wrong", "2026-07-22T08:00:00.000Z"),
      knowledgeAttempt("orphan", "missing", "correct", "2026-07-22T08:00:00.000Z"),
    ],
  });
  assert.equal(snapshot.knowledgeMetrics.get("k1")?.attemptCount, 2);
  assert.equal(snapshot.knowledgeMetrics.get("k1")?.correctRate, 50);
  assert.equal(snapshot.knowledgeMetrics.get("k1")?.latestResult, "wrong");
  assert.equal(snapshot.knowledgeMetrics.get("k2")?.attemptCount, 0);
  assert.equal(snapshot.knowledgeMetrics.get("k2")?.correctRate, null);
});

test("错题和知识项共享 canonical due-day 优先级排序，并对排列保持确定", () => {
  const localNow = new Date(2026, 8, 14, 12);
  const sameDayTimestamp = localDayTimestamp(14, 18);
  const mistakes = [
    mistake("z-same", "常识判断", 2, "2026-09-14"),
    mistake("a-same", "常识判断", 2, sameDayTimestamp),
    mistake("earlier", "常识判断", 2, "2026-09-13"),
    mistake("invalid", "常识判断", 2, "not-a-date"),
    mistake("mastery-first", "常识判断", 1, "2026-09-30"),
  ];
  const knowledgeEntries = [
    { ...knowledge("k-a-same", 2), nextReviewAt: sameDayTimestamp },
    { ...knowledge("k-earlier", 2), nextReviewAt: "2026-09-13" },
    { ...knowledge("k-invalid", 2), nextReviewAt: "not-a-date" },
    { ...knowledge("k-mastery-first", 1), nextReviewAt: "2026-09-30" },
  ];
  const snapshot = derive({ now: localNow, range: "all", mistakes, knowledgeEntries });
  const reversed = derive({ now: localNow, range: "all", mistakes: [...mistakes].reverse(), knowledgeEntries: [...knowledgeEntries].reverse() });
  assert.equal(studyDay(sameDayTimestamp), "2026-09-14");
  assert.deepEqual(snapshot.priorityMistakes.map((item) => item.id), ["mastery-first", "earlier", "a-same", "z-same", "invalid"]);
  assert.deepEqual(snapshot.priorityKnowledge.map((item) => item.id), ["k-mastery-first", "k-earlier", "k-a-same", "k-invalid"]);
  assert.deepEqual(reversed.priorityMistakes.map((item) => item.id), snapshot.priorityMistakes.map((item) => item.id));
  assert.deepEqual(reversed.priorityKnowledge.map((item) => item.id), snapshot.priorityKnowledge.map((item) => item.id));
  assert.equal(compareLearningInsightPriorityItems({ id: "valid", mastery: 2, nextReviewAt: "2026-09-14" }, { id: "missing", mastery: 2 }), -1);
});

test("模型对输入排列保持确定，并只选择已有的薄弱/错因信号", () => {
  const mistakes = [mistake("m1"), mistake("m2", "判断推理", 4, "2026-08-01")];
  const attempts = [attempt("a1", "m1", "wrong", "2026-07-20T08:00:00.000Z"), attempt("a2", "m1", "correct", "2026-07-22T08:00:00.000Z")];
  assert.deepEqual(derive({ mistakes, attempts }), derive({ mistakes: [...mistakes].reverse(), attempts: [...attempts].reverse() }));

  const signal = (id: string, kind: "goal" | "weakness" | "misconception" | "next_action", evidenceCount: number) => ({ id, kind, title: id, summary: id, score: 99, evidence: Array.from({ length: evidenceCount }, (_, index) => ({ type: "mistake" as const, id: `${id}-${index}`, label: id, observedAt: "2026-07-22" })) });
  const selected = selectLearningInsightSignals({ generatedAt: now.toISOString(), dueReviewCount: 0, evidenceCount: 0, insufficientEvidenceCount: 0, sourceRecordCount: 0, recommendations: [], signals: [signal("goal", "goal", 1), signal("weak", "weakness", 3), signal("action", "next_action", 1), signal("misconception", "misconception", 2)] });
  assert.deepEqual(selected.map((item) => item.id), ["weak", "misconception"]);
  assert.equal(selected[0]?.evidence.length, 3);
});
