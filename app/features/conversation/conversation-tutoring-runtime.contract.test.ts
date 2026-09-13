import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../../db/review-db.ts";
import type { TutoringAiReply } from "../../services/tutoring-ai-service.ts";
import { parseTutoringProtocolResponse } from "../../services/tutoring-protocol.ts";
import { tutoringRepository } from "../../services/tutoring-repository.ts";
import { persistConversationTutorReply } from "./conversation-tutoring-runtime.ts";

async function resetReviewDb(): Promise<void> {
  reviewDb.close();
  await reviewDb.delete();
  await reviewDb.open();
}

function protocolReply(): TutoringAiReply {
  const result = parseTutoringProtocolResponse(JSON.stringify({
    version: "v1",
    kind: "micro_assessment",
    content: "请完成这道小测，提交后应用会计算确定性结果。",
    microAssessment: {
      questions: [{
        prompt: "哪一步先做？",
        options: ["统一单位", "跳过条件", "直接猜测"],
        correctOptionIndex: 0,
        explanation: "先统一单位才能比较。",
      }],
    },
  }));
  assert.equal(result.status, "valid");
  if (result.status !== "valid") throw new Error("expected a valid protocol reply");
  return {
    boardNotes: [],
    confidence: 0,
    detectedProblem: "",
    frameDescription: "",
    microAssessment: result.response.microAssessment ?? { questions: [] },
    nextQuestion: "",
    protocol: result.response,
    protocolStatus: "valid",
    studentAction: "",
    teacherMessage: result.response.content,
  };
}

test("conversation protocol persistence 复用 assistant message ID，重试不重复且不串 session", async () => {
  await resetReviewDb();
  const session = await tutoringRepository.ensureConversationSession({
    conversationId: "protocol-conversation",
    goal: "验证协议持久化",
    mode: "upload",
    topic: "协议边界",
  });
  const otherSession = await tutoringRepository.createSession({ goal: "另一个目标", mode: "upload", topic: "另一个主题" });
  const input = {
    assistantMessageId: "assistant-message-1",
    reply: protocolReply(),
    responseLatencyMs: 31,
    sessionId: session.id,
  };

  await Promise.all([
    persistConversationTutorReply(input),
    persistConversationTutorReply(input),
  ]);

  const restored = await tutoringRepository.loadConversationSession("protocol-conversation");
  assert.equal(restored.turns.length, 1);
  assert.equal(restored.turns[0]?.id, "conversation-message:assistant-message-1");
  assert.equal(restored.turns[0]?.sessionId, session.id);
  assert.equal(restored.turns[0]?.microAssessment?.correctCount, undefined);
  assert.equal((await tutoringRepository.loadSnapshot()).turns.filter((turn) => turn.sessionId === otherSession.id).length, 0);
  assert.equal(restored.session?.turnCount, 1);
});

test.after(async () => {
  reviewDb.close();
  await reviewDb.delete();
});
