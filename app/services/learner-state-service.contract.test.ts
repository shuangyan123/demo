import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewPracticePlan, InterviewSession } from "../types/domains/interview.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { Attempt, Mistake, ReviewResult } from "../types/domains/review.ts";
import type { TutoringPlan, TutoringTurn } from "../types/domains/tutoring.ts";
import { deriveLearnerStateSnapshot, masteryLevelToScore, type LearnerStateFacts } from "./learner-state-service.ts";

const today = new Date("2026-08-09T08:00:00.000Z");
const past = "2026-08-08T08:00:00.000Z";
const future = "2026-08-12T08:00:00.000Z";
const tutoringQuestion = { id: "q1", prompt: "问题", options: ["A", "B"], correctOptionIndex: 0, explanation: "" };

function facts(patch: Partial<LearnerStateFacts> = {}): LearnerStateFacts {
  return { mistakes: [], attempts: [], knowledgeEntries: [], knowledgeAttempts: [], interviewEvaluations: [], interviewPracticePlans: [], interviewSessions: [], tutoringSessions: [], tutoringTurns: [], tutoringPlans: [], ...patch };
}

function mistake(id: string, mastery: number, nextReviewAt = past, reasons = ["条件关系混淆"]): Mistake {
  return { id, board: "判断推理", source: "test", stem: `完整题干-${id}-不应进入推荐证据`, answer: "A", explanation: "", reasons, tags: [], mastery, nextReviewAt, createdAt: past, updatedAt: past };
}

function attempt(id: string, mistakeId: string, result: ReviewResult, reviewedAt = past): Attempt {
  return { id, mistakeId, result, confidence: 3, reviewedAt };
}

function knowledge(id: string, mastery: number, nextReviewAt = past): KnowledgeEntry {
  return { id, category: "常识判断", title: `知识标题 ${id}`, summary: "知识摘要", content: `完整知识正文-${id}-不应进入推荐证据`, tags: [], source: "test", favorite: false, mastery, nextReviewAt, reviewCount: 1, createdAt: past, updatedAt: past };
}

function knowledgeAttempt(id: string, knowledgeId: string, result: ReviewResult, reviewedAt = past): KnowledgeAttempt {
  return { id, knowledgeId, result, confidence: 3, reviewedAt };
}

function tutoringPlan(id: string, status: TutoringPlan["status"], nextPracticeAt = past): TutoringPlan {
  return { id, title: `辅导计划 ${id}`, objective: "巩固判断关系", linkedKnowledgeIds: [], linkedMistakeIds: [], nextTask: "完成一次变式微测", nextPracticeAt, status, createdAt: past, updatedAt: past };
}

function completedTutoringTurn(id: string, sessionId: string, correctCount: number, completedAt: string, createdAt = completedAt): TutoringTurn {
  return {
    id,
    sessionId,
    speaker: "ai_tutor",
    content: "",
    microAssessment: { questions: [tutoringQuestion], selections: [correctCount ? 0 : 1], correctCount, completedAt },
    createdAt,
  };
}

function tutoringRecommendations(snapshot: ReturnType<typeof deriveLearnerStateSnapshot>, planId: string) {
  return snapshot.recommendations.filter((item) => item.kind === "retry_tutoring" && item.destination.targetIds?.includes(planId));
}

test("future auto plan 与最新失败微测只保留 P2", () => {
  const planId = "auto:session-a";
  const snapshot = deriveLearnerStateSnapshot(facts({
    tutoringPlans: [tutoringPlan(planId, "active", future)],
    tutoringTurns: [completedTutoringTurn("failed-a", "session-a", 0, past)],
  }), today);
  const actions = tutoringRecommendations(snapshot, planId);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.priority, 200);
  assert.equal(actions[0]?.evidence[0]?.id, "failed-a");
});

test("due auto plan 优先于同一 session 的失败微测，只保留 P1", () => {
  const planId = "auto:session-b";
  const snapshot = deriveLearnerStateSnapshot(facts({
    tutoringPlans: [tutoringPlan(planId, "active", past)],
    tutoringTurns: [completedTutoringTurn("failed-b", "session-b", 0, past)],
  }), today);
  const actions = tutoringRecommendations(snapshot, planId);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.priority, 120);
  assert.equal(actions[0]?.evidence[0]?.id, planId);
});

test("future auto plan 与最新通过微测只保留 P4", () => {
  const planId = "auto:session-c";
  const snapshot = deriveLearnerStateSnapshot(facts({
    tutoringPlans: [tutoringPlan(planId, "active", future)],
    tutoringTurns: [completedTutoringTurn("passed-c", "session-c", 1, past)],
  }), today);
  const actions = tutoringRecommendations(snapshot, planId);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.priority, 400);
  assert.equal(actions[0]?.evidence[0]?.id, planId);
});

test("同一 session 只以最新 completed assessment 决定 P2 或 P4", () => {
  const older = "2026-08-06T08:00:00.000Z";
  const newer = "2026-08-08T09:00:00.000Z";
  const passedLatest = deriveLearnerStateSnapshot(facts({
    tutoringPlans: [tutoringPlan("auto:session-d", "active", future)],
    tutoringTurns: [completedTutoringTurn("older-failed", "session-d", 0, older), completedTutoringTurn("newer-passed", "session-d", 1, newer)],
  }), today);
  assert.deepEqual(tutoringRecommendations(passedLatest, "auto:session-d").map((item) => item.priority), [400]);

  const failedLatest = deriveLearnerStateSnapshot(facts({
    tutoringPlans: [tutoringPlan("auto:session-e", "active", future)],
    tutoringTurns: [completedTutoringTurn("older-passed", "session-e", 1, older), completedTutoringTurn("newer-failed", "session-e", 0, newer)],
  }), today);
  const actions = tutoringRecommendations(failedLatest, "auto:session-e");
  assert.deepEqual(actions.map((item) => item.priority), [200]);
  assert.equal(actions[0]?.evidence[0]?.id, "newer-failed");
});

test("tutoring precedence 在输入数组重排后保持 recommendation IDs 与顺序", () => {
  const input = facts({
    tutoringPlans: [tutoringPlan("auto:stable-a", "active", future), tutoringPlan("auto:stable-b", "active", past)],
    tutoringTurns: [
      completedTutoringTurn("stable-a-new", "stable-a", 0, "2026-08-08T09:00:00.000Z"),
      completedTutoringTurn("stable-a-old", "stable-a", 1, "2026-08-07T09:00:00.000Z"),
      completedTutoringTurn("stable-b", "stable-b", 0, "2026-08-08T07:00:00.000Z"),
    ],
  });
  const first = deriveLearnerStateSnapshot(input, today).recommendations;
  const second = deriveLearnerStateSnapshot({ ...input, tutoringPlans: [...input.tutoringPlans].reverse(), tutoringTurns: [...input.tutoringTurns].reverse() }, today).recommendations;
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.deepEqual(first, second);
});

test("malformed optional legacy dates fail safe without fabricating due actions", () => {
  const invalidMistake = { ...mistake("invalid-mistake", 2), nextReviewAt: undefined } as unknown as Mistake;
  const invalidKnowledge = { ...knowledge("invalid-knowledge", 2), nextReviewAt: "not-a-date" } as KnowledgeEntry;
  const invalidTutoringPlan = { ...tutoringPlan("invalid-tutoring", "active"), nextPracticeAt: undefined } as unknown as TutoringPlan;
  const invalidInterviewPlan = { ...interviewPlan("invalid-interview", "active"), nextPracticeAt: "not-a-date" } as InterviewPracticePlan;
  const snapshot = deriveLearnerStateSnapshot(facts({
    mistakes: [invalidMistake],
    knowledgeEntries: [invalidKnowledge],
    tutoringPlans: [invalidTutoringPlan],
    interviewPracticePlans: [invalidInterviewPlan],
  }), today);
  assert.equal(snapshot.dueReviewCount, 0);
  assert.deepEqual(snapshot.recommendations, []);
});

function interviewPlan(id: string, status: InterviewPracticePlan["status"], nextPracticeAt = past): InterviewPracticePlan {
  return { id, title: `面试计划 ${id}`, type: "structured", questionIds: ["question-1"], targetSessionCount: 3, completedSessionCount: 1, nextPracticeAt, status, reason: "提升结构化表达", createdAt: past, updatedAt: past };
}

test("持久化 mastery 1..5 与只读派生分保持独立契约", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(masteryLevelToScore), [0, 25, 50, 75, 100]);
  const snapshot = deriveLearnerStateSnapshot(facts({ mistakes: [mistake("m1", 1), mistake("m2", 2), mistake("m4", 4, future), mistake("m5", 5, future)], attempts: [attempt("a4", "m4", "correct"), attempt("a5", "m5", "correct")], knowledgeEntries: [knowledge("k1", 1), knowledge("k2", 2), knowledge("k4", 4, future), knowledge("k5", 5, future)], knowledgeAttempts: [knowledgeAttempt("ka4", "k4", "correct"), knowledgeAttempt("ka5", "k5", "correct")] }), today);
  const weaknessText = snapshot.signals.filter((signal) => signal.kind === "weakness").map((signal) => signal.title).join("\n");
  assert.match(weaknessText, /判断推理仍需巩固/);
  assert.match(weaknessText, /知识点待巩固：知识标题 k1/);
  assert.match(weaknessText, /知识点待巩固：知识标题 k2/);
  assert.doesNotMatch(weaknessText, /知识标题 k4|知识标题 k5/);
});

test("latest wrong、uncertain、correct 以固定顺序影响同级到期推荐", () => {
  const snapshot = deriveLearnerStateSnapshot(facts({ mistakes: [mistake("correct", 2), mistake("uncertain", 2), mistake("wrong", 2)], attempts: [attempt("attempt-correct", "correct", "correct"), attempt("attempt-uncertain", "uncertain", "uncertain"), attempt("attempt-wrong", "wrong", "wrong")] }), today);
  const action = snapshot.recommendations.find((item) => item.kind === "review_mistakes");
  assert.deepEqual(action?.destination.targetIds, ["wrong", "uncertain", "correct"]);
  assert.match(action?.summary ?? "", /最近答错/);
});

test("到期错题与知识进入队列，未来稳定记录不会制造到期任务", () => {
  const snapshot = deriveLearnerStateSnapshot(facts({ mistakes: [mistake("due-mistake", 2, past, ["到期错因"]), mistake("future-mistake", 5, future, ["稳定错因"])], attempts: [attempt("future-correct", "future-mistake", "correct")], knowledgeEntries: [knowledge("due-knowledge", 2), knowledge("future-knowledge", 5, future)], knowledgeAttempts: [knowledgeAttempt("future-knowledge-correct", "future-knowledge", "correct")] }), today);
  assert.deepEqual(snapshot.recommendations.filter((item) => item.priority < 200).map((item) => item.kind), ["review_mistakes", "review_knowledge"]);
  assert.ok(snapshot.recommendations.every((item) => !item.destination.targetIds?.includes("future-mistake") && !item.destination.targetIds?.includes("future-knowledge")));
});

test("到期辅导与面试计划进入队列，paused/completed 计划不会被推荐", () => {
  const snapshot = deriveLearnerStateSnapshot(facts({ tutoringPlans: [tutoringPlan("t-active", "active"), tutoringPlan("t-paused", "paused"), tutoringPlan("t-complete", "completed")], interviewPracticePlans: [interviewPlan("i-active", "active"), interviewPlan("i-paused", "paused"), interviewPlan("i-complete", "completed")] }), today);
  assert.deepEqual(snapshot.recommendations.map((item) => item.destination.targetIds?.[0]), ["t-active", "i-active"]);
  assert.equal(snapshot.dueReviewCount, 2);
});

test("未提交微测不代表掌握，失败微测生成重试，满分只保留间隔证据", () => {
  const question = { id: "q1", prompt: "问题", options: ["A", "B"], correctOptionIndex: 0, explanation: "" };
  const turns: TutoringTurn[] = [
    { id: "unsubmitted", sessionId: "s1", speaker: "ai_tutor", content: "", detectedProblem: "模型推测", confidence: 0.99, microAssessment: { questions: [question] }, createdAt: past },
    { id: "failed", sessionId: "s2", speaker: "ai_tutor", content: "", confidence: 0.1, microAssessment: { questions: [question], selections: [1], correctCount: 0, completedAt: past }, createdAt: past },
    { id: "passed", sessionId: "s3", speaker: "ai_tutor", content: "", microAssessment: { questions: [question], selections: [0], correctCount: 1, completedAt: past }, createdAt: past },
  ];
  const snapshot = deriveLearnerStateSnapshot(facts({ tutoringTurns: turns }), today);
  assert.equal(snapshot.recommendations.some((item) => item.destination.targetIds?.includes("auto:s1")), false);
  assert.equal(snapshot.insufficientEvidenceCount, 1);
  assert.equal(snapshot.recommendations.some((item) => item.evidence.some((evidence) => evidence.id === "failed")), true);
  assert.equal(snapshot.recommendations.some((item) => item.evidence.some((evidence) => evidence.id === "passed")), false);
  assert.equal(snapshot.signals.some((signal) => signal.evidence.some((evidence) => evidence.id === "unsubmitted")), false);
  assert.equal(snapshot.signals.some((signal) => signal.kind === "strength"), false);
});

test("取消或未评分面试不会被当作完成训练证据", () => {
  const sessions: InterviewSession[] = [
    { id: "cancelled", questionId: "q1", type: "structured", title: "取消场次", questionPrompt: "", questionMaterial: "", status: "cancelled", stage: "answering", startedAt: past, completedAt: past, totalDurationSec: 30, transcriptText: "", createdAt: past, updatedAt: past },
    { id: "active", questionId: "q2", type: "structured", title: "未评分场次", questionPrompt: "", questionMaterial: "", status: "active", stage: "answering", startedAt: past, totalDurationSec: 30, transcriptText: "", createdAt: past, updatedAt: past },
  ];
  const snapshot = deriveLearnerStateSnapshot(facts({ interviewSessions: sessions }), today);
  assert.equal(snapshot.recommendations.length, 0);
  assert.equal(snapshot.insufficientEvidenceCount, 1);
  assert.equal(snapshot.signals.some((signal) => signal.evidence.some((evidence) => ["cancelled", "active"].includes(evidence.id))), false);
});

test("重复错因只接受独立、非通用证据并去重", () => {
  const snapshot = deriveLearnerStateSnapshot(facts({ mistakes: [mistake("m1", 2, future, ["待归因", "条件关系混淆", "条件关系混淆"]), mistake("m2", 2, future, ["条件关系混淆"]), mistake("m3", 2, future, ["其他"]), mistake("m4", 2, future, ["其他"])] }), today);
  const misconception = snapshot.recommendations.find((item) => item.priority === 300);
  assert.equal(misconception?.title, "反复错因：条件关系混淆");
  assert.deepEqual(misconception?.evidence.map((item) => item.id).toSorted(), ["m1", "m2"]);
  assert.equal(new Set(misconception?.evidence.map((item) => `${item.type}:${item.id}`)).size, misconception?.evidence.length);
});

test("空事实不制造推荐；相同事实与 today 产生稳定 ID、证据和顺序", () => {
  const empty = deriveLearnerStateSnapshot(facts(), today);
  assert.equal(empty.sourceRecordCount, 0);
  assert.deepEqual(empty.recommendations, []);
  const input = facts({ mistakes: [mistake("m2", 2), mistake("m1", 1)], attempts: [attempt("a2", "m2", "uncertain"), attempt("a1", "m1", "wrong")], knowledgeEntries: [knowledge("k1", 2)] });
  const first = deriveLearnerStateSnapshot(input, today);
  const second = deriveLearnerStateSnapshot({ ...input, mistakes: [...input.mistakes].reverse(), attempts: [...input.attempts].reverse() }, today);
  assert.deepEqual(first.recommendations, second.recommendations);
  const factIds = new Set(["m1", "m2", "a1", "a2", "k1"]);
  for (const action of first.recommendations) {
    assert.ok(action.evidence.length > 0);
    assert.ok(action.evidence.every((item) => factIds.has(item.id)));
    assert.equal(new Set(action.evidence.map((item) => `${item.type}:${item.id}`)).size, action.evidence.length);
    assert.ok(action.evidence.every((item) => !item.label.includes("完整题干") && !item.label.includes("完整知识正文")));
  }
});
