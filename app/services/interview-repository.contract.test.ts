import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import type { InterviewQuestion, InterviewSession } from "../types/domains/interview.ts";
import { interviewRepository } from "./interview-repository.ts";
import {
  finishInterviewTimer,
  interviewTurnElapsedSec,
  normalizeInterviewTimer,
  pauseInterviewTimer,
  resetInterviewTurnTimer,
  resumeInterviewTimer,
} from "./interview-timer.ts";
import { tutoringRepository } from "./tutoring-repository.ts";

const base = "2026-07-30T00:00:00.000Z";

function question(id: string, type: InterviewQuestion["type"]): InterviewQuestion {
  return {
    id, type, title: `示例题 ${id}`, prompt: "请作答", material: "", source: "面试训练示例",
    tags: [], difficulty: "medium", favorite: false, practiceCount: 0, expectedDurationSec: 180,
    createdAt: base, updatedAt: base,
  };
}

function session(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: "session-1", questionId: "question-1", type: "structured", title: "计时测试",
    questionPrompt: "请作答", questionMaterial: "", status: "active", stage: "answering",
    startedAt: base, totalDurationSec: 0, transcriptText: "", createdAt: base, updatedAt: base,
    ...overrides,
  };
}

test("面试计时支持旧记录自动开始、暂停、继续、换轮和完成冻结", () => {
  const start = Date.parse(base);
  const running = normalizeInterviewTimer(session(), start);
  assert.equal(running.timerStatus, "running");
  assert.equal(interviewTurnElapsedSec(running, start + 5_000), 5);
  const paused = { ...running, ...pauseInterviewTimer(running, start + 5_000) };
  assert.equal(interviewTurnElapsedSec(paused, start + 60_000), 5);
  const resumed = { ...paused, ...resumeInterviewTimer(paused, start + 60_000) };
  assert.equal(interviewTurnElapsedSec(resumed, start + 63_000), 8);
  const nextTurn = { ...resumed, ...resetInterviewTurnTimer(start + 70_000) };
  assert.equal(interviewTurnElapsedSec(nextTurn, start + 72_000), 2);
  const finished = { ...nextTurn, ...finishInterviewTimer(nextTurn, start + 75_000) };
  assert.equal(finished.timerStatus, "finished");
  assert.equal(interviewTurnElapsedSec(finished, start + 500_000), 5);
  assert.equal(normalizeInterviewTimer(session({ status: "evaluated" }), start).timerStatus, "finished");
});

test("v16 使用现有单字段索引删除三类示例题并清理题组、计划和关联", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  const questions = [question("structured", "structured"), question("structured-group", "structured_group"), question("leaderless", "leaderless_group")];
  await reviewDb.interviewQuestions.bulkPut(questions);
  await reviewDb.interviewQuestionSets.put({
    id: "set-1", type: "mixed", title: "示例题组", description: "", tags: [],
    questionIds: questions.map((item) => item.id), createdAt: base, updatedAt: base,
  });
  await reviewDb.interviewPracticePlans.put({
    id: "plan-1", type: "mixed", title: "示例计划", sourceSetId: "set-1",
    questionIds: questions.map((item) => item.id), targetSessionCount: 3, completedSessionCount: 0,
    nextPracticeAt: base, status: "active", reason: "", createdAt: base, updatedAt: base,
  });
  await reviewDb.interviewLinks.bulkPut(questions.map((item) => ({
    id: `link-${item.id}`, sourceType: "question" as const, sourceId: item.id,
    targetType: "knowledge" as const, targetId: "knowledge-1", reason: "测试", score: 1, evidence: [], createdAt: base, updatedAt: base,
  })));
  for (const item of questions) await interviewRepository.removeQuestion(item.id);
  assert.equal(await reviewDb.interviewQuestions.count(), 0);
  assert.deepEqual((await reviewDb.interviewQuestionSets.get("set-1"))?.questionIds, []);
  assert.deepEqual((await reviewDb.interviewPracticePlans.get("plan-1"))?.questionIds, []);
  assert.equal(await reviewDb.interviewLinks.count(), 0);
  await reviewDb.delete();
});

test("面试会话与辅导会话、计划删除不查询 v16 中不存在的复合索引", async () => {
  await reviewDb.delete();
  await reviewDb.open();
  await reviewDb.interviewSessions.put(session());
  await reviewDb.interviewLinks.put({
    id: "interview-link", sourceType: "session", sourceId: "session-1",
    targetType: "knowledge", targetId: "knowledge-1", reason: "测试", score: 1, evidence: [], createdAt: base, updatedAt: base,
  });
  await interviewRepository.removeSession("session-1");
  assert.equal(await reviewDb.interviewLinks.count(), 0);
  await reviewDb.tutoringSessions.put({
    id: "tutoring-session", mode: "upload", status: "active", topic: "辅导",
    goal: "", startedAt: base, transcriptText: "", frameCount: 0, turnCount: 0, estimatedCostNote: "",
    createdAt: base, updatedAt: base, summary: "", nextActions: [],
  });
  await reviewDb.tutoringPlans.put({
    id: "tutoring-plan", title: "计划", objective: "测试", status: "active", linkedKnowledgeIds: [],
    linkedMistakeIds: [], nextTask: "继续", nextPracticeAt: base, createdAt: base, updatedAt: base,
  });
  await reviewDb.tutoringLinks.bulkPut([
    { id: "tutoring-session-link", sourceType: "session", sourceId: "tutoring-session", targetType: "knowledge", targetId: "knowledge-1", reason: "测试", score: 1, evidence: [], createdAt: base, updatedAt: base },
    { id: "tutoring-plan-link", sourceType: "plan", sourceId: "tutoring-plan", targetType: "knowledge", targetId: "knowledge-1", reason: "测试", score: 1, evidence: [], createdAt: base, updatedAt: base },
  ]);
  await tutoringRepository.removeSession("tutoring-session");
  await tutoringRepository.removePlan("tutoring-plan");
  assert.equal(await reviewDb.tutoringLinks.count(), 0);
  await reviewDb.delete();
});
