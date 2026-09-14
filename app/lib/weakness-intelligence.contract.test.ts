import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveWeaknessIntelligence,
  masteryLevelToScore,
  type WeaknessSubjectInput,
} from "./weakness-intelligence.ts";
import type { LearningEvent } from "../types/domains/learning-event.ts";

const today = new Date("2026-08-09T08:00:00.000Z");
const future = "2026-08-20T08:00:00.000Z";
const past = "2026-08-08T08:00:00.000Z";

function subject(id: string, mastery = 3, nextReviewAt = future, patch: Partial<WeaknessSubjectInput> = {}): WeaknessSubjectInput {
  return {
    subjectType: "mistake",
    subjectId: id,
    mastery,
    nextReviewAt,
    updatedAt: past,
    reasons: ["条件关系混淆"],
    ...patch,
  };
}

function event(
  sourceId: string,
  subjectId: string,
  observedAt: string,
  outcome: LearningEvent["outcome"],
  patch: Partial<LearningEvent> = {},
): LearningEvent {
  return {
    id: `review_attempt:${sourceId}`,
    sourceType: "review_attempt",
    sourceId,
    subjectType: "mistake",
    subjectId,
    outcome,
    observedAt,
    ...patch,
  };
}

function intelligence(subjects: readonly WeaknessSubjectInput[], learningEvents: readonly LearningEvent[] = []) {
  return deriveWeaknessIntelligence({ subjects, learningEvents, today });
}

function assessment(result: ReturnType<typeof intelligence>, subjectId: string) {
  const item = result.subjects.find((candidate) => candidate.subjectId === subjectId);
  assert.ok(item, `missing assessment for ${subjectId}`);
  return item;
}

test("mastery 1..5 通过现有 masteryLevelToScore 映射到 0/25/50/75/100", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(masteryLevelToScore), [0, 25, 50, 75, 100]);
});

test("跨日 wrong 增加 risk，uncertain 弱于 wrong", () => {
  const wrong = assessment(intelligence([subject("wrong")], [event("wrong-1", "wrong", past, "wrong")]), "wrong");
  const uncertain = assessment(intelligence([subject("uncertain")], [event("uncertain-1", "uncertain", past, "uncertain")]), "uncertain");
  assert.equal(wrong.riskScore, 72);
  assert.equal(uncertain.riskScore, 61);
  assert.ok(wrong.riskScore > uncertain.riskScore);

  const recurring = assessment(intelligence([subject("recurring")], [
    event("recurring-1", "recurring", "2026-08-07T08:00:00.000Z", "wrong"),
    event("recurring-2", "recurring", past, "wrong"),
  ]), "recurring");
  assert.equal(recurring.riskScore, 78);
  assert.equal(recurring.wrongDays, 2);
});

test("同日重复失败只折叠为一个历史日，历史最多取最近 8 个 distinct dates", () => {
  const duplicateDay = assessment(intelligence([subject("duplicate")], [
    event("duplicate-older", "duplicate", past, "uncertain"),
    event("duplicate-newer", "duplicate", "2026-08-08T12:00:00.000Z", "wrong"),
  ]), "duplicate");
  assert.equal(duplicateDay.wrongDays, 1);
  assert.equal(duplicateDay.uncertainDays, 0);
  assert.equal(duplicateDay.riskScore, 72);

  const events = Array.from({ length: 10 }, (_, index) => event(
    `history-${index}`,
    "bounded",
    `2026-07-${String(31 - index).padStart(2, "0")}T08:00:00.000Z`,
    "wrong",
  ));
  const bounded = assessment(intelligence([subject("bounded")], events), "bounded");
  assert.equal(bounded.wrongDays, 8);
  assert.equal(bounded.studyDays.length, 8);
  assert.equal(bounded.riskScore, 84);
});

test("最近 correct streak 提供 recovery credit，两个跨日 correct 可解除已恢复 subject", () => {
  const recovered = assessment(intelligence([subject("recovered", 4)], [
    event("recovered-old", "recovered", "2026-08-06T08:00:00.000Z", "wrong"),
    event("recovered-correct-1", "recovered", "2026-08-08T08:00:00.000Z", "correct"),
    event("recovered-correct-2", "recovered", "2026-08-09T08:00:00.000Z", "correct"),
  ]), "recovered");
  assert.equal(recovered.correctStreak, 2);
  assert.equal(recovered.riskScore, 23);
  assert.equal(recovered.currentlyWeak, false);
});

test("due 状态可以保留边界 subject，risk 始终限制在 0..100", () => {
  const due = assessment(intelligence([subject("due", 4, past)]), "due");
  assert.equal(due.due, true);
  assert.equal(due.currentlyWeak, true);
  assert.equal(due.riskScore, 29);

  const high = assessment(intelligence([subject("high", 1, past)], [event("high-failure", "high", past, "wrong")]), "high");
  assert.equal(high.riskScore, 100);
  const low = assessment(intelligence([subject("low", 5)], [
    event("low-correct-1", "low", "2026-08-07T08:00:00.000Z", "correct"),
    event("low-correct-2", "low", past, "correct"),
  ]), "low");
  assert.equal(low.riskScore, 0);
});

test("backfilled-shaped event 只需 outcome、observedAt、masteryAfter 也会影响 risk", () => {
  const backfilled = event("backfilled", "legacy", past, "wrong", { masteryAfter: 2 });
  assert.equal("errorCause" in backfilled, false);
  const result = assessment(intelligence([subject("legacy")], [backfilled]), "legacy");
  assert.equal(result.latestOutcome, "wrong");
  assert.equal(result.riskScore, 72);
});

test("相同 facts、events、today 在输入数组重排后完全确定", () => {
  const subjects = [subject("b", 2), subject("a", 3)];
  const events = [
    event("b-wrong", "b", past, "wrong", { errorCause: "calculation" }),
    event("a-uncertain", "a", past, "uncertain", { errorCause: "calculation" }),
  ];
  const first = intelligence(subjects, events);
  const second = intelligence([...subjects].reverse(), [...events].reverse());
  assert.deepEqual(first, second);
});

test("相同精确错因在两个当前未解决错题中形成 cluster，同题重复与通用标签不增加独立题数", () => {
  const repeated = intelligence([
    subject("reason-a", 2, future, { reasons: [" 条件关系混淆。", "条件关系混淆"] }),
    subject("reason-b", 2, future, { reasons: ["条件关系混淆"] }),
    subject("reason-generic-a", 2, future, { reasons: ["其他"] }),
    subject("reason-generic-b", 2, future, { reasons: ["待归因"] }),
  ]);
  assert.deepEqual(repeated.repeatedReasonClusters.map((cluster) => ({ key: cluster.key, label: cluster.label, count: cluster.subjects.length, score: cluster.score })), [
    { key: "条件关系混淆", label: "条件关系混淆", count: 2, score: 70 },
  ]);

  const oneSubject = intelligence([subject("only", 2, future, { reasons: ["条件关系混淆", "条件关系 混淆"] })]);
  assert.deepEqual(oneSubject.repeatedReasonClusters, []);
  const synonym = intelligence([
    subject("synonym-a", 2, future, { reasons: ["计算错误"] }),
    subject("synonym-b", 2, future, { reasons: ["计算失误"] }),
  ]);
  assert.deepEqual(synonym.repeatedReasonClusters, []);
});

test("已恢复或已解决错题会从 repeated-reason cluster 消失", () => {
  const result = intelligence([
    subject("resolved-a", 4, future, { reasons: ["资料单位换算"] }),
    subject("resolved-b", 3, future, { reasons: ["资料单位换算"] }),
  ], [
    event("resolved-a-1", "resolved-a", "2026-08-08T08:00:00.000Z", "correct"),
    event("resolved-a-2", "resolved-a", "2026-08-09T08:00:00.000Z", "correct"),
    event("resolved-b-1", "resolved-b", "2026-08-08T08:00:00.000Z", "correct"),
    event("resolved-b-2", "resolved-b", "2026-08-09T08:00:00.000Z", "correct"),
  ]);
  assert.deepEqual(result.repeatedReasonClusters, []);
});

test("相同显式 errorCause 跨 mistake 与 knowledge subject 才形成 cluster，且 score 按 subject/date 去重", () => {
  const result = intelligence([
    subject("mistake-cause", 2, future),
    subject("knowledge-cause", 2, future, { subjectType: "knowledge", reasons: undefined }),
    subject("single-cause", 2, future),
  ], [
    event("cause-mistake-a", "mistake-cause", past, "wrong", { errorCause: "calculation" }),
    {
      ...event("cause-knowledge-a", "knowledge-cause", past, "uncertain", { errorCause: "calculation" }),
      id: "knowledge_attempt:cause-knowledge-a",
      sourceType: "knowledge_attempt",
      subjectType: "knowledge",
    },
    event("cause-single-a", "single-cause", past, "wrong", { errorCause: "calculation" }),
    event("cause-single-b", "single-cause", "2026-08-08T12:00:00.000Z", "wrong", { errorCause: "calculation" }),
  ]);
  const cluster = result.errorCauseClusters.find((candidate) => candidate.cause === "calculation");
  assert.ok(cluster);
  assert.equal(cluster.label, "计算错误");
  assert.equal(cluster.subjects.length, 3);
  assert.equal(cluster.recentFailureDays, 3);
  assert.equal(cluster.score, 88);
  assert.deepEqual(cluster.evidenceEvents.map((item) => item.sourceId).toSorted(), ["cause-knowledge-a", "cause-mistake-a", "cause-single-b"]);
});

test("errorCause 只消费 wrong/uncertain 的显式值，缺失、other、正确结果和模型文本都不形成 cluster", () => {
  const result = intelligence([
    subject("cause-a", 2),
    subject("cause-b", 2),
    subject("cause-c", 2),
  ], [
    event("cause-a-correct", "cause-a", past, "correct", { errorCause: "calculation" }),
    event("cause-b-other", "cause-b", past, "wrong", { errorCause: "other" }),
    event("cause-c-model-text", "cause-c", past, "wrong"),
  ]);
  assert.deepEqual(result.errorCauseClusters, []);
});

test("1,000 subjects 的事件分组一次完成且在输入重排后保持逐 subject 结果稳定", () => {
  const subjects = Array.from({ length: 1_000 }, (_, index) => {
    const subjectType: WeaknessSubjectInput["subjectType"] = index % 2 === 0 ? "mistake" : "knowledge";
    return {
      subjectType,
      subjectId: `${subjectType}-scale-${String(index).padStart(4, "0")}`,
      mastery: (index % 5) + 1,
      nextReviewAt: future,
      updatedAt: past,
      ...(subjectType === "mistake" ? { reasons: [`scale-reason-${index}`] } : {}),
    } satisfies WeaknessSubjectInput;
  });
  const events = subjects.flatMap((subject, subjectIndex) => {
    const eventCount = (subjectIndex % 8) + 1;
    return Array.from({ length: eventCount }, (_, eventIndex) => {
      const sourceType = subject.subjectType === "mistake" ? "review_attempt" : "knowledge_attempt";
      const sourceId = `scale-event-${subjectIndex}-${eventIndex}`;
      const outcome: LearningEvent["outcome"] = eventIndex === eventCount - 1
        ? "wrong"
        : eventIndex % 2 === 0 ? "correct" : "uncertain";
      return {
        id: `${sourceType}:${sourceId}`,
        sourceType,
        sourceId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        outcome,
        observedAt: new Date(Date.UTC(2026, 7, 1 + eventIndex, 8)).toISOString(),
        masteryAfter: subject.mastery,
      } satisfies LearningEvent;
    });
  });

  const first = intelligence(subjects, events);
  const shuffled = intelligence([...subjects].reverse(), [...events].reverse());
  assert.deepEqual(shuffled, first);
  assert.equal(first.subjects.length, subjects.length);
  assert.equal(new Set(first.subjects.map((item) => `${item.subjectType}:${item.subjectId}`)).size, subjects.length);

  const assessments = new Map(first.subjects.map((item) => [`${item.subjectType}:${item.subjectId}`, item]));
  for (const [subjectIndex, subject] of subjects.entries()) {
    const assessment = assessments.get(`${subject.subjectType}:${subject.subjectId}`);
    assert.ok(assessment, `missing assessment for ${subject.subjectId}`);
    const expectedEventCount = (subjectIndex % 8) + 1;
    const assignedEvents = assessment.studyDays.flatMap((day) => day.events);
    assert.equal(assignedEvents.length, expectedEventCount);
    assert.equal(new Set(assignedEvents.map((event) => event.id)).size, expectedEventCount);
    assert.ok(assignedEvents.every((event) => event.subjectType === subject.subjectType && event.subjectId === subject.subjectId));
  }

  const representative = assessments.get("mistake:mistake-scale-0000");
  assert.ok(representative);
  assert.equal(representative.latestOutcome, "wrong");
  assert.equal(representative.wrongDays, 1);
  assert.equal(representative.studyDays.length, 1);
  assert.equal(representative.riskScore, 100);
});
