import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { InterviewPracticePlan, InterviewSession } from "../types/domains/interview.ts";
import type { KnowledgeEntry } from "../types/domains/knowledge.ts";
import type { Mistake } from "../types/domains/review.ts";
import { interviewRepository } from "./interview-repository.ts";
import { knowledgeRepository } from "./knowledge-repository.ts";
import { loadLearnerStateSnapshot } from "./learner-state-service.ts";
import { reviewRepository } from "./review-repository.ts";
import { tutoringRepository } from "./tutoring-repository.ts";

const today = new Date("2026-08-09T08:00:00.000Z");
const past = "2026-08-01T08:00:00.000Z";

async function resetReviewDb(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

function dueMistake(id: string): Mistake {
  return {
    id, board: "判断推理", source: "completion-contract", stem: `错题 ${id}`, answer: "A", explanation: "",
    reasons: ["条件关系"], tags: [], mastery: 2, nextReviewAt: "2026-08-01", createdAt: past, updatedAt: past,
  };
}

function dueKnowledge(id: string): KnowledgeEntry {
  return {
    id, category: "常识判断", title: `知识 ${id}`, summary: "", content: "", tags: [], source: "completion-contract",
    favorite: false, mastery: 2, nextReviewAt: "2026-08-01", reviewCount: 0, createdAt: past, updatedAt: past,
  };
}

function interviewPlan(id: string, targetSessionCount: number): InterviewPracticePlan {
  return {
    id, title: `面试计划 ${id}`, type: "structured", questionIds: ["question-1"], targetSessionCount,
    completedSessionCount: 0, nextPracticeAt: past, status: "active", reason: "验证完成语义", createdAt: past, updatedAt: past,
  };
}

function interviewSession(id: string, planId: string): InterviewSession {
  return {
    id, planId, questionId: "question-1", type: "structured", title: "面试场次", questionPrompt: "请作答",
    questionMaterial: "", status: "active", stage: "answering", startedAt: past, totalDurationSec: 0,
    transcriptText: "", createdAt: past, updatedAt: past,
  };
}

test("真实错题与知识 repository commit 会缩小并清空 grouped recommendations", async () => {
  await resetReviewDb();
  const mistakes = [dueMistake("m1"), dueMistake("m2")];
  const knowledge = [dueKnowledge("k1"), dueKnowledge("k2")];
  await reviewDb.mistakes.bulkPut(mistakes);
  await reviewDb.knowledgeEntries.bulkPut(knowledge);

  const before = await loadLearnerStateSnapshot(today);
  assert.deepEqual(before.recommendations.find((item) => item.semanticKey === "review:due")?.destination.targetIds, ["m1", "m2"]);
  assert.deepEqual(before.recommendations.find((item) => item.semanticKey === "knowledge:due")?.destination.targetIds, ["k1", "k2"]);

  await reviewRepository.recordReview(mistakes[0]!, "correct", today);
  await knowledgeRepository.recordReview(knowledge[0]!, "correct", today);
  const partial = await loadLearnerStateSnapshot(today);
  assert.deepEqual(partial.recommendations.find((item) => item.semanticKey === "review:due")?.destination.targetIds, ["m2"]);
  assert.deepEqual(partial.recommendations.find((item) => item.semanticKey === "knowledge:due")?.destination.targetIds, ["k2"]);

  await reviewRepository.recordReview(mistakes[1]!, "correct", today);
  await knowledgeRepository.recordReview(knowledge[1]!, "correct", today);
  const complete = await loadLearnerStateSnapshot(today);
  assert.equal(complete.recommendations.some((item) => item.semanticKey === "review:due"), false);
  assert.equal(complete.recommendations.some((item) => item.semanticKey === "knowledge:due"), false);
  assert.equal(await reviewDb.attempts.count(), 2);
  assert.equal(await reviewDb.knowledgeAttempts.count(), 2);
});

test("completeMicroAssessment 的真实事务把 P1/P2 转换为最新 P2/P4", async () => {
  await resetReviewDb();
  const session = await tutoringRepository.createSession({ goal: "掌握条件关系", mode: "upload", topic: "条件关系" });
  const turn = await tutoringRepository.addTurn({
    sessionId: session.id,
    speaker: "ai_tutor",
    content: "完成微测",
    microAssessment: {
      questions: [
        { id: "q1", prompt: "必要条件", options: ["A", "B"], correctOptionIndex: 0, explanation: "" },
        { id: "q2", prompt: "充分条件", options: ["A", "B"], correctOptionIndex: 1, explanation: "" },
      ],
    },
  });

  await tutoringRepository.completeMicroAssessment(turn.id, [1, 0], today);
  const failed = await loadLearnerStateSnapshot(today);
  const p2 = failed.recommendations.find((item) => item.semanticKey === `tutoring:auto:${session.id}`);
  assert.equal(p2?.priority, 200);

  await tutoringRepository.completeMicroAssessment(turn.id, [0, 1], new Date("2026-08-09T09:00:00.000Z"));
  const passed = await loadLearnerStateSnapshot(today);
  const p4 = passed.recommendations.find((item) => item.semanticKey === `tutoring:auto:${session.id}`);
  assert.equal(p4?.priority, 400);
  assert.match(p4?.title ?? "", /继续辅导计划/);
  assert.equal((await reviewDb.tutoringTurns.get(turn.id))?.microAssessment?.correctCount, 2);
});

test("Interview cancel 不推进计划，saveEvaluation 的真实事务推进或完成计划", async () => {
  await resetReviewDb();
  const continuingPlan = interviewPlan("continue-plan", 2);
  const completingPlan = interviewPlan("complete-plan", 1);
  const cancelled = interviewSession("cancelled-session", continuingPlan.id);
  const evaluated = interviewSession("evaluated-session", continuingPlan.id);
  const completing = interviewSession("completing-session", completingPlan.id);
  await reviewDb.interviewPracticePlans.bulkPut([continuingPlan, completingPlan]);
  await reviewDb.interviewSessions.bulkPut([cancelled, evaluated, completing]);

  await interviewRepository.cancelSession(cancelled.id);
  const afterCancel = await loadLearnerStateSnapshot(today);
  assert.equal(afterCancel.recommendations.find((item) => item.semanticKey === `interview-plan:${continuingPlan.id}`)?.priority, 130);
  assert.equal((await reviewDb.interviewPracticePlans.get(continuingPlan.id))?.completedSessionCount, 0);

  await interviewRepository.saveEvaluation({
    sessionId: evaluated.id, type: "structured", totalScore: 80,
    dimensions: [{ name: "内容", score: 80, maxScore: 100, comment: "结构完整" }],
    strengths: ["结构完整"], problems: [], suggestions: [], evidence: ["本地文字稿"],
  });
  const afterEvaluation = await loadLearnerStateSnapshot(today);
  const continuing = afterEvaluation.recommendations.find((item) => item.semanticKey === `interview-plan:${continuingPlan.id}`);
  assert.equal(continuing?.priority, 410);
  assert.match(continuing?.summary ?? "", /已完成 1\/2/);

  await interviewRepository.saveEvaluation({
    sessionId: completing.id, type: "structured", totalScore: 82,
    dimensions: [{ name: "表达", score: 82, maxScore: 100, comment: "清晰" }],
    strengths: ["清晰"], problems: [], suggestions: [], evidence: ["本地文字稿"],
  });
  const completed = await loadLearnerStateSnapshot(today);
  assert.equal(completed.recommendations.some((item) => item.semanticKey === `interview-plan:${completingPlan.id}`), false);
  assert.equal((await reviewDb.interviewPracticePlans.get(completingPlan.id))?.status, "completed");
});

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
});
