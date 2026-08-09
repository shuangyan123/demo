import "fake-indexeddb/auto";
import "./learner-state-service.contract.test.ts";
import "./learning-loop-completion.contract.test.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import { learningMemoryEvalCases } from "../data/evals/learning-memory-evals.ts";
import { hasMeaningfulVisionChange } from "../features/tutoring/vision-source-adapter.ts";
import { buildLearningContext } from "./learning-context-assembler.ts";
import { loadLearnerStateSnapshot } from "./learner-state-service.ts";
import { tutoringRepository } from "./tutoring-repository.ts";

async function resetReviewDb(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

test("学习者状态只从本地可观察结果派生，并为每个结论保留证据 ID", async () => {
  await resetReviewDb();
  const now = "2026-07-16T00:00:00.000Z";
  const old = "2026-07-01T00:00:00.000Z";
  await reviewDb.mistakes.bulkPut([
    { id: "m1", board: "资料分析", source: "eval", stem: "完整题干不应进入学习上下文 SENTINEL-A", answer: "A", explanation: "", reasons: ["单位换算"], tags: [], mastery: 1, nextReviewAt: old, createdAt: old, updatedAt: now },
    { id: "m2", board: "资料分析", source: "eval", stem: "另一道完整题干 SENTINEL-B", answer: "B", explanation: "", reasons: ["单位换算"], tags: [], mastery: 2, nextReviewAt: old, createdAt: old, updatedAt: now },
  ] as never[]);
  await reviewDb.tutoringTurns.put({
    id: "turn-evidence",
    sessionId: "session-evidence",
    speaker: "ai_tutor",
    content: "已解释必要条件",
    detectedProblem: "必要条件与充分条件混淆",
    microAssessment: { questions: [{ id: "q1", prompt: "哪项是必要条件？", options: ["A", "B"], correctOptionIndex: 0, explanation: "" }] },
    createdAt: now,
  } as never);

  const snapshot = await loadLearnerStateSnapshot(new Date(now));
  assert.ok(snapshot.signals.length > 0);
  assert.ok(snapshot.signals.every((signal) => signal.evidence.length > 0 && signal.evidence.every((item) => item.id)));
  assert.ok(snapshot.signals.some((signal) => signal.kind === "misconception" && signal.evidence.length >= 1));
  const context = buildLearningContext(snapshot, { moduleId: "tutoring", query: "资料分析必要条件", characterLimit: 900 });
  assert.ok(context.length <= 900);
  assert.match(context, /证据 (?:mistake|tutoring):/);
  assert.doesNotMatch(context, /SENTINEL-[AB]/);
});

test("微测由用户选择确定掌握结果，并生成间隔复习计划", async () => {
  await resetReviewDb();
  const session = await tutoringRepository.createSession({ goal: "掌握判断关系", mode: "upload", topic: "逻辑判断" });
  const turn = await tutoringRepository.addTurn({
    sessionId: session.id,
    speaker: "ai_tutor",
    content: "请完成微测",
    microAssessment: {
      questions: [
        { id: "q1", prompt: "问题一", options: ["A", "B"], correctOptionIndex: 0, explanation: "" },
        { id: "q2", prompt: "问题二", options: ["A", "B"], correctOptionIndex: 1, explanation: "" },
      ],
    },
  });
  const today = new Date("2026-07-16T00:00:00.000Z");
  const result = await tutoringRepository.completeMicroAssessment(turn.id, [0, 0], today);
  assert.deepEqual({ correctCount: result.correctCount, total: result.total }, { correctCount: 1, total: 2 });
  assert.equal(result.nextPracticeAt.slice(0, 10), "2026-07-19");
  assert.equal((await reviewDb.tutoringPlans.get(`auto:${session.id}`))?.status, "active");
});

test("对话与辅导会话、轮次使用稳定 ID 幂等关联", async () => {
  await resetReviewDb();
  const firstSession = await tutoringRepository.ensureConversationSession({
    conversationId: "conversation-1",
    goal: "完成资料分析讲解",
    mode: "upload",
    topic: "资料分析",
  });
  const [retriedSession] = await Promise.all([
    tutoringRepository.ensureConversationSession({ conversationId: "conversation-1", goal: "重试不应覆盖原会话", mode: "upload", topic: "资料分析" }),
    tutoringRepository.ensureConversationSession({ conversationId: "conversation-1", goal: "并行重试也不能重复", mode: "upload", topic: "资料分析" }),
  ]);
  assert.equal(firstSession.id, "conversation:conversation-1");
  assert.equal(retriedSession.id, firstSession.id);
  assert.equal((await reviewDb.tutoringSessions.toArray()).filter((session) => session.conversationId === "conversation-1").length, 1);

  const input = {
    conversationMessageId: "message-1",
    sessionId: firstSession.id,
    speaker: "ai_tutor" as const,
    content: "先统一单位，再比较增长量。",
    detectedProblem: "单位换算遗漏",
  };
  const [firstTurn, retriedTurn] = await Promise.all([
    tutoringRepository.putConversationTurn(input),
    tutoringRepository.putConversationTurn(input),
  ]);
  const restored = await tutoringRepository.loadConversationSession("conversation-1");
  assert.equal(firstTurn.id, "conversation-message:message-1");
  assert.equal(retriedTurn.id, firstTurn.id);
  assert.equal(restored.turns.length, 1);
  assert.equal(restored.session?.turnCount, 1);
});

test("辅导仓储拒绝原始媒体，视觉指纹抑制重复帧", async () => {
  await resetReviewDb();
  const session = await tutoringRepository.createSession({ goal: "视觉练习", mode: "camera", topic: "题目讲解" });
  await assert.rejects(() => tutoringRepository.addTurn({ sessionId: session.id, speaker: "student", content: "data:image/png;base64,AAAA" }), /禁止持久化/);
  const flat = "00".repeat(64);
  const changed = `${"ff"}${"00".repeat(63)}`;
  assert.equal(hasMeaningfulVisionChange(flat, flat), false);
  assert.equal(hasMeaningfulVisionChange(flat, changed, 0.01), true);
});

test("中文记忆与辅导评测集覆盖七类长期行为", () => {
  assert.equal(new Set(learningMemoryEvalCases.map((item) => item.category)).size, 7);
  assert.ok(learningMemoryEvalCases.length >= 10);
  assert.ok(learningMemoryEvalCases.some((item) => item.category === "privacy" && item.expected.action === "discard"));
  assert.ok(learningMemoryEvalCases.some((item) => item.category === "cross-session-tutoring" && item.expected.evidenceRequired));
});

test("legacy facts 首次正式加载已归一化，第二次刷新 recommendation 不漂移", async () => {
  await resetReviewDb();
  const today = new Date("2026-08-09T08:00:00.000Z");
  const old = "2026-08-01T08:00:00.000Z";
  await reviewDb.mistakes.put({
    id: "legacy-mistake",
    subject: "判断推理",
    source: "legacy",
    stem: "legacy mistake",
    answer: "A",
    explanation: "",
    reasons: [],
    createdAt: old,
  } as never);
  await reviewDb.knowledgeEntries.put({
    id: "legacy-knowledge",
    category: "常识判断",
    title: "legacy knowledge",
    summary: "legacy",
    content: "legacy",
    tags: [],
    source: "legacy",
    favorite: false,
    createdAt: old,
  } as never);

  const first = await loadLearnerStateSnapshot(today);
  const normalizedMistake = await reviewDb.mistakes.get("legacy-mistake");
  const normalizedKnowledge = await reviewDb.knowledgeEntries.get("legacy-knowledge");
  assert.equal(normalizedMistake?.mastery, 2);
  assert.equal(normalizedMistake?.nextReviewAt, "2026-08-09");
  assert.equal(normalizedKnowledge?.mastery, 2);
  assert.equal(normalizedKnowledge?.nextReviewAt, old);
  assert.equal(normalizedKnowledge?.reviewCount, 0);
  assert.ok(first.recommendations.some((item) => item.kind === "review_mistakes" && item.destination.targetIds?.includes("legacy-mistake")));
  assert.ok(first.recommendations.some((item) => item.kind === "review_knowledge" && item.destination.targetIds?.includes("legacy-knowledge")));

  const second = await loadLearnerStateSnapshot(today);
  assert.deepEqual(first.recommendations.map((item) => item.id), second.recommendations.map((item) => item.id));
  assert.deepEqual(first.recommendations, second.recommendations);
});

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
});
