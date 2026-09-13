import type { ChatMessageContent } from "./api-client.ts";
import type { AiSelectedRuntimeValues } from "../types/domains/ai-model.ts";
import { generateWithConnection } from "./ai-connection-client.ts";
import { parseAiJsonObject } from "./ai-json.ts";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository.ts";
import { buildPersonalMemoryContext } from "./personal-memory-context.ts";
import { buildLearningContext } from "./learning-context-assembler.ts";
import {
  buildTutoringProtocolInstructions,
  parseTutoringProtocolResponse,
  TUTORING_PROTOCOL_SCHEMA,
  TutoringProtocolError,
  type TutoringGeneratedMicroAssessment,
  type TutoringProtocolFailureCode,
  type TutoringProtocolResponse,
} from "./tutoring-protocol.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { LearnerStateSnapshot } from "../types/domains/learner-state.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";
import type { TutoringSession, TutoringTurn } from "../types/domains/tutoring.ts";

export type TutoringAiReply = {
  teacherMessage: string;
  boardNotes: string[];
  detectedProblem: string;
  studentAction: string;
  nextQuestion: string;
  confidence: number;
  frameDescription: string;
  microAssessment: TutoringGeneratedMicroAssessment;
  protocol: TutoringProtocolResponse;
  protocolStatus: "valid" | "fallback";
  protocolFallbackReason?: TutoringProtocolFailureCode;
};

export type TutoringSummaryDraft = {
  summary: string;
  nextActions: string[];
};

// 从模型返回中提取 JSON 对象，兼容模型额外包裹 Markdown 代码块的情况。
function parseJsonObject(content: string): Record<string, unknown> {
  const parsed = parseAiJsonObject(content, "AI 返回不是有效 JSON 对象");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 返回不是有效 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

// 构造低成本辅导系统提示词，强调不要求模型假装看到未发送的画面。
function buildTutorSystemPrompt(personalizationSettings: PersonalizationSettings) {
  const persona = resolvePersona(personalizationSettings, "tutoring");
  return [
    "你是一名实时辅导老师，必须遵守下列任务与输出约束。",
    "你会根据学生文字、摄像头关键帧描述和本地资料，给出短而有操作性的讲解。",
    "不要编造没有出现在画面、文字或资料中的事实。",
    buildTutoringProtocolInstructions(),
    buildPersonaPrompt(persona),
    buildPersonalMemoryContext(personalizationSettings, { moduleId: "tutoring" }),
  ].join("\n");
}

// 根据一轮学生输入和可选关键帧请求 AI 老师回复；图片只随本次请求发送，不在服务层持久化。
export async function requestTutorReply(input: {
  frameDataUrl?: string;
  frameDescription?: string;
  learnerState: LearnerStateSnapshot;
  recentTurns: TutoringTurn[];
  session: TutoringSession;
  connection: ApiConnectionProfile;
  modelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  studentText: string;
  personalizationSettings: PersonalizationSettings;
}): Promise<TutoringAiReply> {
  const recentTranscript = input.recentTurns
    .slice(-8)
    .map((turn) => `${turn.speaker}: ${turn.content.slice(0, 600)}`)
    .join("\n")
    .slice(0, 4_000);
  const promptText = [
    `辅导主题：${input.session.topic.slice(0, 240) || "未命名主题"}`,
    `辅导目标：${input.session.goal.slice(0, 500) || "帮助学生理解当前内容并完成下一步"}`,
    `学生本轮输入：${input.studentText.slice(0, 1_200) || "学生暂未输入文字，请主要根据画面关键帧判断"}`,
    `上一帧描述：${input.frameDescription?.slice(0, 600) || "无"}`,
    `最近对话：\n${recentTranscript || "无"}`,
    buildLearningContext(input.learnerState, { moduleId: "tutoring", query: `${input.session.topic} ${input.studentText}`, characterLimit: 1400 }) || "暂无可核验的长期学习状态。",
    "请根据当前对话选择最合适的协议 kind；不必每轮覆盖所有阶段。若生成题目，kind 必须为 micro_assessment；只有讲解或练习时不要附带 microAssessment。",
  ].join("\n\n");
  const content: ChatMessageContent = input.frameDataUrl
    ? [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: input.frameDataUrl } },
      ]
    : promptText;
  const response = await generateWithConnection(input.connection, input.frameDataUrl ? "vision" : "text", {
    modelId: input.modelId,
    selectedRuntimeValues: input.selectedRuntimeValues,
    maxOutputTokens: 1200,
    structuredOutput: { name: "tutoring_protocol_v1", schema: TUTORING_PROTOCOL_SCHEMA },
    messages: [
      { role: "system", content: buildTutorSystemPrompt(input.personalizationSettings) },
      { role: "user", content },
    ],
    temperature: 0.28,
  });
  const parsed = parseTutoringProtocolResponse(response.content);
  if (parsed.status === "failure") throw new TutoringProtocolError(parsed);
  const protocol = parsed.response;
  const diagnosis = protocol.diagnosis;
  return {
    boardNotes: diagnosis?.evidence ?? [],
    confidence: diagnosis?.confidence ?? 0,
    detectedProblem: diagnosis?.summary ?? "",
    frameDescription: input.frameDescription?.trim() ?? "",
    nextQuestion: protocol.nextStep?.question ?? "",
    protocol,
    protocolFallbackReason: parsed.status === "fallback" ? parsed.fallbackReason : undefined,
    protocolStatus: parsed.status,
    studentAction: protocol.nextStep?.action ?? "",
    teacherMessage: protocol.content,
    microAssessment: protocol.microAssessment ?? { questions: [] },
  };
}

// 结束会话时把完整文字稿压缩成摘要和下一步任务，仍不涉及原始音视频。
export async function requestTutorSummary(input: {
  session: TutoringSession;
  connection: ApiConnectionProfile;
  modelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  turns: TutoringTurn[];
  personalizationSettings: PersonalizationSettings;
}): Promise<TutoringSummaryDraft> {
  const transcript = input.turns.map((turn) => `${turn.speaker}: ${turn.content}`).join("\n");
  const response = await generateWithConnection(input.connection, "text", {
    modelId: input.modelId,
    selectedRuntimeValues: input.selectedRuntimeValues,
    maxOutputTokens: 900,
    messages: [
      {
        role: "system",
        content: [
          "你是课后复盘老师，只输出 JSON。",
          '格式：{"summary":"本次辅导摘要","nextActions":["下一步任务"]}',
          "摘要要具体，下一步任务要可执行。",
          buildPersonaPrompt(resolvePersona(input.personalizationSettings, "tutoring")),
          buildPersonalMemoryContext(input.personalizationSettings, { moduleId: "tutoring" }),
        ].join("\n"),
      },
      {
        role: "user",
        content: [`主题：${input.session.topic}`, `目标：${input.session.goal}`, `文字稿：\n${transcript || input.session.transcriptText || "无"}`].join("\n\n"),
      },
    ],
    temperature: 0.18,
  });
  const parsed = parseJsonObject(response.content);
  return {
    nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 6) : [],
    summary: String(parsed.summary ?? "").trim() || "本次辅导已完成，建议根据课堂记录整理薄弱点。",
  };
}
