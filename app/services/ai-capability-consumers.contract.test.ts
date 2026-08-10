import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { LearnerStateSnapshot } from "../types/domains/learner-state.ts";
import type { InterviewSession, PersonalizationSettings, TutoringSession } from "../types/domains/legacy-review.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { requestInterviewReply } from "./interview-ai-service.ts";
import { createDefaultPersonalizationSettings } from "./personalization-settings-repository.ts";
import { requestTutorReply } from "./tutoring-ai-service.ts";

function connection(provider: ApiConnectionProfile["provider"], model: string, capabilities: ApiConnectionProfile["capabilities"]): ApiConnectionProfile {
  return { id: `fixture-${provider}`, label: provider, provider, apiFormat: provider === "minimax" ? "anthropic_messages" : "chat_completions", baseUrl: "https://provider.example/v1", model, capabilities, encryptedKey: "ciphertext", iv: "fixture-iv", maskedKey: "****-key", providerOptions: {}, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" };
}

const personalization: PersonalizationSettings = createDefaultPersonalizationSettings(new Date("2026-08-10T00:00:00.000Z"));

test("Conversation 只按 effective model/protocol fact 选择流式路径", async () => {
  const source = await readFile(path.resolve(process.cwd(), "app/features/conversation/conversation-workspace.tsx"), "utf8");
  assert.match(source, /resolveEffectiveModelCapability\(resolveModelCapabilityProfile\(submissionConnection\.provider, submissionModelId\), "streaming"\)/);
  assert.doesNotMatch(source, /submissionConnection\.capabilities\.includes\("streaming"\)/);
  assert.match(source, /generateWithConnectionStream/);
  assert.match(source, /generateWithConnection\(/);
});

test("Tutoring 已核验 vision 模型继续走现有多模态请求", async () => {
  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let requestBody: Record<string, unknown> | undefined;
  aiConnectionsRepository.resolveSecret = async () => "fixture-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ content: JSON.stringify({ teacherMessage: "继续观察", boardNotes: [], microQuiz: { questions: [] } }) });
  };
  try {
    const reply = await requestTutorReply({
      connection: connection("minimax", "MiniMax-M3", ["text", "vision", "structured_output", "streaming"]),
      modelId: "MiniMax-M3",
      frameDataUrl: "data:image/png;base64,AA==",
      learnerState: { generatedAt: "2026-08-10T00:00:00.000Z", dueReviewCount: 0, evidenceCount: 0, insufficientEvidenceCount: 0, sourceRecordCount: 0, signals: [], recommendations: [] } satisfies LearnerStateSnapshot,
      recentTurns: [],
      session: { topic: "几何", goal: "识别图形" } as TutoringSession,
      studentText: "请看图",
      personalizationSettings: personalization,
    });
    assert.equal(reply.teacherMessage, "继续观察");
    assert.equal(requestBody?.model, "MiniMax-M3");
    assert.equal(JSON.stringify(requestBody?.messages).includes("image_url"), true);
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});

test("Interview text-only flow 保持现有统一连接请求", async () => {
  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  const originalResolveRuntimeModel = aiConnectionsRepository.resolveRuntimeModel;
  let requestBody: Record<string, unknown> | undefined;
  aiConnectionsRepository.resolveSecret = async () => "fixture-secret";
  aiConnectionsRepository.resolveRuntimeModel = async () => "deepseek-v4-pro";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ content: JSON.stringify({ reply: "请继续作答", nextStage: "answering", shouldEvaluate: false }) });
  };
  try {
    const session = { title: "结构化面试", questionPrompt: "请自我介绍", questionMaterial: "", stage: "answering", type: "structured" } as InterviewSession;
    const reply = await requestInterviewReply({ question: session, session, connection: connection("deepseek", "deepseek-v4-pro", ["text", "structured_output", "streaming"]), turns: [], personalizationSettings: personalization });
    assert.equal(reply.reply, "请继续作答");
    assert.equal(requestBody?.model, "deepseek-v4-pro");
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
    aiConnectionsRepository.resolveRuntimeModel = originalResolveRuntimeModel;
  }
});
