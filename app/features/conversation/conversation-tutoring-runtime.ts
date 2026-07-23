import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { ApiConnectionProfile, PersonalizationSettings, TutoringSession } from "../../types/review";
import { loadLearnerStateSnapshot } from "../../services/learner-state-service";
import { requestTutorReply, type TutoringAiReply } from "../../services/tutoring-ai-service";
import { tutoringRepository } from "../../services/tutoring-repository";
import { readBlobAsDataUrl } from "./conversation-message-utils";

type TutorTurnInput = {
  connection: ApiConnectionProfile;
  conversationId: string;
  frameDataUrl?: string;
  frameDescription?: string;
  goal: string;
  modelId: string;
  personalizationSettings: PersonalizationSettings;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  studentText: string;
  topic: string;
  userMessageId: string;
};

/**
 * 对话内辅导运行边界：可见消息仍由 conversation repository 保存，
 * 本模块只持久化辅导结构化字段和可确定评分的微测。
 */
export async function prepareConversationTutorReply(input: TutorTurnInput): Promise<{
  reply: TutoringAiReply;
  session: TutoringSession;
}> {
  const session = await tutoringRepository.ensureConversationSession({
    conversationId: input.conversationId,
    goal: input.goal,
    mode: "upload",
    topic: input.topic,
  });
  await tutoringRepository.putConversationTurn({
    content: input.studentText || "请分析当前附件并给出下一步练习。",
    conversationMessageId: input.userMessageId,
    frameDescription: input.frameDescription,
    observation: input.frameDataUrl
      ? {
          capturedAt: new Date().toISOString(),
          source: "upload",
          summary: input.frameDescription?.slice(0, 240),
        }
      : undefined,
    sessionId: session.id,
    speaker: "student",
  });
  const { turns } = await tutoringRepository.loadConversationSession(input.conversationId);
  const learnerState = await loadLearnerStateSnapshot();
  const reply = await requestTutorReply({
    connection: input.connection,
    frameDataUrl: input.frameDataUrl,
    frameDescription: input.frameDescription,
    learnerState,
    modelId: input.modelId,
    personalizationSettings: input.personalizationSettings,
    recentTurns: turns,
    selectedRuntimeValues: input.selectedRuntimeValues,
    session,
    studentText: input.studentText,
  });
  return { reply, session };
}

/** 在助手可见消息落库后补充结构化辅导轮次，以消息 ID 保证失败重试不重复。 */
export async function persistConversationTutorReply(input: {
  assistantMessageId: string;
  reply: TutoringAiReply;
  sessionId: string;
  responseLatencyMs: number;
}): Promise<void> {
  await tutoringRepository.putConversationTurn({
    boardNotes: input.reply.boardNotes,
    confidence: input.reply.confidence,
    content: input.reply.teacherMessage,
    conversationMessageId: input.assistantMessageId,
    detectedProblem: input.reply.detectedProblem,
    frameDescription: input.reply.frameDescription,
    microAssessment: input.reply.microAssessment,
    nextQuestion: input.reply.nextQuestion,
    responseLatencyMs: input.responseLatencyMs,
    sessionId: input.sessionId,
    speaker: "ai_tutor",
    studentAction: input.reply.studentAction,
  });
}

/** 将对话提交分支压缩为一个按需加载的运行步骤，避免普通对话静态引入辅导服务。 */
export async function runConversationTutorTurn(input: Omit<TutorTurnInput, "frameDataUrl" | "frameDescription"> & {
  imageAttachment?: { file: Blob; summary?: string };
}) {
  const startedAt = performance.now();
  const prepared = await prepareConversationTutorReply({
    ...input,
    frameDataUrl: input.imageAttachment ? await readBlobAsDataUrl(input.imageAttachment.file) : undefined,
    frameDescription: input.imageAttachment?.summary,
  });
  return {
    content: prepared.reply.teacherMessage,
    persist: (assistantMessageId: string) => persistConversationTutorReply({
      assistantMessageId,
      reply: prepared.reply,
      responseLatencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      sessionId: prepared.session.id,
    }),
  };
}

/** 使用当前对话选中的模型生成课后摘要，完成后只更新辅导会话文本字段。 */
export async function finishConversationTutorSession(input: {
  connection: ApiConnectionProfile;
  conversationId: string;
  modelId: string;
  personalizationSettings: PersonalizationSettings;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
}) {
  const { requestTutorSummary } = await import("../../services/tutoring-ai-service");
  const { session, turns } = await tutoringRepository.loadConversationSession(input.conversationId);
  if (!session) return false;
  const summary = await requestTutorSummary({
    connection: input.connection,
    modelId: input.modelId,
    personalizationSettings: input.personalizationSettings,
    selectedRuntimeValues: input.selectedRuntimeValues,
    session,
    turns,
  });
  await tutoringRepository.completeSession(session.id, summary);
  return true;
}
