import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewAiReply } from "../../services/interview-ai-service.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { InterviewQuestion, InterviewSession, InterviewTurn } from "../../types/domains/interview.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { InterviewApplicationError } from "./interview-application.ts";
import { startInterviewSession, type StartInterviewSessionDependencies, type StartInterviewSessionResult } from "./start-interview-session.ts";
import { submitInterviewTurn, type SubmitInterviewTurnDependencies, type SubmitInterviewTurnResult } from "./submit-interview-turn.ts";

const now = "2026-08-09T08:00:00.000Z";
const question: InterviewQuestion = {
  id: "question-1", type: "structured", title: "测试面试题", prompt: "请作答", material: "", source: "测试",
  tags: [], difficulty: "medium", favorite: false, practiceCount: 0, expectedDurationSec: 180, createdAt: now, updatedAt: now,
};
const connection: ApiConnectionProfile = {
  id: "connection-1", label: "测试连接", provider: "custom", apiFormat: "chat_completions",
  baseUrl: "http://127.0.0.1:9999/v1", capabilities: ["text"], encryptedKey: "cipher", iv: "iv",
  maskedKey: "***", providerOptions: {}, createdAt: now, updatedAt: now,
};
const personalizationSettings: PersonalizationSettings = {
  id: "default", personaDisplayMode: "default", customPersonaViewMode: "flashcard", defaultPersonaId: "default-interview",
  modulePersonaIds: {}, customPersonas: [], personaCustomizations: {}, updatedAt: now,
};

function session(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: "session-1", questionId: question.id, type: question.type, title: question.title,
    questionPrompt: question.prompt, questionMaterial: question.material, status: "active", stage: "briefing",
    startedAt: now, totalDurationSec: 0, timerStatus: "running", currentTurnElapsedSec: 0,
    currentTurnStartedAt: now, transcriptText: "", createdAt: now, updatedAt: now, ...overrides,
  };
}

function turn(id: string, input: Omit<InterviewTurn, "id" | "createdAt">): InterviewTurn {
  return { id, createdAt: now, ...input };
}

async function applicationError<TResult extends object>(operation: Promise<TResult>): Promise<InterviewApplicationError<TResult>> {
  try {
    await operation;
    assert.fail("预期 Application 用例失败");
  } catch (error) {
    assert.ok(error instanceof InterviewApplicationError);
    return error as InterviewApplicationError<TResult>;
  }
}

function startHarness(failAt?: "request-reply" | "save-ai-turn" | "update-session") {
  const calls: string[] = [];
  const sessions: InterviewSession[] = [];
  const turns: InterviewTurn[] = [];
  const dependencies: StartInterviewSessionDependencies = {
    async createSession() {
      calls.push("create-session");
      const created = session();
      sessions.push(created);
      return created;
    },
    async requestReply() {
      calls.push("request-reply");
      if (failAt === "request-reply") throw new Error("AI 请求失败");
      return { reply: "请开始作答", nextStage: "answering", shouldEvaluate: false };
    },
    async addTurn(input) {
      calls.push("save-ai-turn");
      if (failAt === "save-ai-turn") throw new Error("AI 轮次保存失败");
      const saved = turn("ai-turn-1", input);
      turns.push(saved);
      return saved;
    },
    async updateSession(id, patch) {
      calls.push("update-session");
      if (failAt === "update-session") throw new Error("会话更新失败");
      const index = sessions.findIndex((item) => item.id === id);
      sessions[index] = { ...sessions[index], ...patch };
    },
  };
  return { calls, dependencies, sessions, turns };
}

function startInput(dependencies: StartInterviewSessionDependencies) {
  return { question, planId: "plan-1", connection, personalizationSettings, dependencies };
}

test("startInterviewSession 按 create → AI → turn → session 顺序提交并返回更新后的会话", async () => {
  const harness = startHarness();
  const result = await startInterviewSession(startInput(harness.dependencies));
  assert.deepEqual(harness.calls, ["create-session", "request-reply", "save-ai-turn", "update-session"]);
  assert.equal(result.session.stage, "answering");
  assert.equal(result.session.transcriptText, "请开始作答");
  assert.equal(result.aiTurn.speaker, "ai_interviewer");
  assert.equal(harness.sessions.length, 1);
  assert.equal(harness.turns.length, 1);
});

test("startInterviewSession 在 AI 失败后保留已创建会话且不隐式重试", async () => {
  const harness = startHarness("request-reply");
  const error = await applicationError<StartInterviewSessionResult>(startInterviewSession(startInput(harness.dependencies)));
  assert.equal(error.step, "request-reply");
  assert.equal(error.partialResult.session?.id, "session-1");
  assert.deepEqual(harness.calls, ["create-session", "request-reply"]);
  assert.equal(harness.sessions.length, 1);
  assert.equal(harness.turns.length, 0);
});

test("startInterviewSession 在 AI 成功但 turn 保存失败时只保留会话", async () => {
  const harness = startHarness("save-ai-turn");
  const error = await applicationError<StartInterviewSessionResult>(startInterviewSession(startInput(harness.dependencies)));
  assert.equal(error.step, "save-ai-turn");
  assert.equal(error.partialResult.session?.id, "session-1");
  assert.deepEqual(harness.calls, ["create-session", "request-reply", "save-ai-turn"]);
  assert.equal(harness.turns.length, 0);
});

test("startInterviewSession 在 session 更新失败时保留 AI turn 并暴露部分结果", async () => {
  const harness = startHarness("update-session");
  const error = await applicationError<StartInterviewSessionResult>(startInterviewSession(startInput(harness.dependencies)));
  assert.equal(error.step, "update-session");
  assert.equal(error.partialResult.aiTurn?.id, "ai-turn-1");
  assert.equal(harness.sessions[0].stage, "briefing");
  assert.equal(harness.turns.length, 1);
});

type SubmitFailure = "save-candidate-turn" | "request-reply" | "save-ai-turn" | "update-session";

function submitHarness({ failAt, shouldEvaluate = false }: { failAt?: SubmitFailure; shouldEvaluate?: boolean } = {}) {
  const calls: string[] = [];
  const storedTurns: InterviewTurn[] = [turn("existing-ai", {
    content: "请作答", sessionId: "session-1", speaker: "ai_interviewer", stage: "answering",
  })];
  let persistedSession = session({ stage: "answering", transcriptText: "请作答" });
  let addCount = 0;
  const dependencies: SubmitInterviewTurnDependencies = {
    async listTurns() {
      calls.push("load-turns");
      return [...storedTurns];
    },
    async addTurn(input) {
      const step = input.speaker === "candidate" ? "save-candidate-turn" : "save-ai-turn";
      calls.push(step);
      if (failAt === step) throw new Error(`${step} 失败`);
      addCount += 1;
      const saved = turn(`turn-${addCount}`, input);
      storedTurns.push(saved);
      return saved;
    },
    async requestReply(): Promise<InterviewAiReply> {
      calls.push("request-reply");
      if (failAt === "request-reply") throw new Error("AI 请求失败");
      return { reply: "下一问", nextStage: "follow_up", shouldEvaluate };
    },
    async updateSession(_id, patch) {
      calls.push("update-session");
      if (failAt === "update-session") throw new Error("会话更新失败");
      persistedSession = { ...persistedSession, ...patch };
    },
    resetTurnTimer() {
      return { timerStatus: "running", currentTurnElapsedSec: 0, currentTurnStartedAt: now };
    },
  };
  return { calls, dependencies, getSession: () => persistedSession, storedTurns };
}

function submitInput(dependencies: SubmitInterviewTurnDependencies) {
  return {
    session: session({ stage: "answering", transcriptText: "请作答" }), answer: "我的回答", durationSec: 12,
    connection, personalizationSettings, dependencies,
  };
}

test("submitInterviewTurn 在 Candidate Turn 保存失败时不调用 AI", async () => {
  const harness = submitHarness({ failAt: "save-candidate-turn" });
  const error = await applicationError<SubmitInterviewTurnResult>(submitInterviewTurn(submitInput(harness.dependencies)));
  assert.equal(error.step, "save-candidate-turn");
  assert.deepEqual(harness.calls, ["load-turns", "save-candidate-turn"]);
  assert.equal(harness.storedTurns.length, 1);
});

test("submitInterviewTurn 在 AI 失败后保留唯一 Candidate Turn 且不隐式重试", async () => {
  const harness = submitHarness({ failAt: "request-reply" });
  const error = await applicationError<SubmitInterviewTurnResult>(submitInterviewTurn(submitInput(harness.dependencies)));
  assert.equal(error.step, "request-reply");
  assert.equal(error.partialResult.candidateTurn?.content, "我的回答");
  assert.deepEqual(harness.calls, ["load-turns", "save-candidate-turn", "request-reply"]);
  assert.equal(harness.storedTurns.filter((item) => item.speaker === "candidate").length, 1);
});

test("submitInterviewTurn 在 AI Turn 保存失败时不更新 Session", async () => {
  const harness = submitHarness({ failAt: "save-ai-turn" });
  const error = await applicationError<SubmitInterviewTurnResult>(submitInterviewTurn(submitInput(harness.dependencies)));
  assert.equal(error.step, "save-ai-turn");
  assert.equal(error.partialResult.candidateTurn?.content, "我的回答");
  assert.equal(harness.getSession().stage, "answering");
  assert.equal(harness.storedTurns.length, 2);
});

test("submitInterviewTurn 在 Session 更新失败时保留两条新 turn 并暴露 transcript 不一致", async () => {
  const harness = submitHarness({ failAt: "update-session" });
  const error = await applicationError<SubmitInterviewTurnResult>(submitInterviewTurn(submitInput(harness.dependencies)));
  assert.equal(error.step, "update-session");
  assert.equal(error.partialResult.aiTurn?.content, "下一问");
  assert.equal(harness.storedTurns.length, 3);
  assert.equal(harness.getSession().transcriptText, "请作答");
  assert.deepEqual(harness.calls, ["load-turns", "save-candidate-turn", "request-reply", "save-ai-turn", "update-session"]);
});

test("submitInterviewTurn 正常推进时返回 shouldEvaluate=false 并重建完整 transcript", async () => {
  const harness = submitHarness();
  const result = await submitInterviewTurn(submitInput(harness.dependencies));
  assert.equal(result.shouldEvaluate, false);
  assert.equal(result.session.totalDurationSec, 12);
  assert.equal(result.session.transcriptText, "请作答\n我的回答\n下一问");
  assert.equal(result.candidateTurn.speaker, "candidate");
  assert.equal(result.aiTurn.speaker, "ai_interviewer");
});

test("submitInterviewTurn 只返回 shouldEvaluate=true 而不反向执行评分流程", async () => {
  const harness = submitHarness({ shouldEvaluate: true });
  const result = await submitInterviewTurn(submitInput(harness.dependencies));
  assert.equal(result.shouldEvaluate, true);
  assert.deepEqual(harness.calls, ["load-turns", "save-candidate-turn", "request-reply", "save-ai-turn", "update-session"]);
});
