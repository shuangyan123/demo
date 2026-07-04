import type { ChatMessageContent } from "./api-client";
import { generateWithConnection } from "./ai-connection-client";
import { parseAiJsonObject } from "./ai-json.ts";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository";
import type { ApiConnectionProfile, KnowledgeEntry, Mistake, PersonalizationSettings, TutoringSession, TutoringTurn } from "../types/review";

export type TutoringAiReply = {
  teacherMessage: string;
  boardNotes: string[];
  detectedProblem: string;
  studentAction: string;
  nextQuestion: string;
  confidence: number;
  frameDescription: string;
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

// 把未知值安全转成字符串数组，避免 AI 少字段时污染课堂笔记。
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

// 把 AI 置信度限制在 0-1，防止模型返回异常数字影响 UI。
function clampConfidence(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.6;
  return Math.max(0, Math.min(1, numberValue));
}

// 构造低成本辅导系统提示词，强调不要求模型假装看到未发送的画面。
function buildTutorSystemPrompt(personalizationSettings: PersonalizationSettings) {
  const persona = resolvePersona(personalizationSettings, "tutoring");
  return [
    "你是一名实时辅导老师，必须遵守下列任务与输出约束。",
    "你会根据学生文字、摄像头关键帧描述和本地资料，给出短而有操作性的讲解。",
    "不要编造没有出现在画面、文字或资料中的事实。",
    "只输出 JSON 对象，不要输出 Markdown。",
    '格式：{"teacherMessage":"老师回复","boardNotes":["板书要点"],"detectedProblem":"发现的问题","studentAction":"学生下一步动作","nextQuestion":"追问","confidence":0.7,"frameDescription":"你对当前画面的简短描述"}',
    buildPersonaPrompt(persona),
  ].join("\n");
}

// 把本地知识资料压缩成提示词上下文，避免把整库塞进模型造成成本浪费。
function buildKnowledgeContext(entries: KnowledgeEntry[]) {
  return entries
    .slice(0, 8)
    .map((entry) => `知识：${entry.title}\n分类：${entry.category}\n摘要：${entry.summary}\n标签：${entry.tags.join("、")}`)
    .join("\n\n");
}

// 把关联错题压缩成短上下文，用于提醒 AI 老师关注学生常见薄弱点。
function buildMistakeContext(mistakes: Mistake[]) {
  return mistakes
    .slice(0, 8)
    .map((mistake) => `错题：${mistake.stem}\n板块：${mistake.board}\n错因：${mistake.reasons.join("、")}\n答案：${mistake.answer}`)
    .join("\n\n");
}

// 根据一轮学生输入和可选关键帧请求 AI 老师回复；图片只随本次请求发送，不在服务层持久化。
export async function requestTutorReply(input: {
  frameDataUrl?: string;
  frameDescription?: string;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  recentTurns: TutoringTurn[];
  session: TutoringSession;
  connection: ApiConnectionProfile;
  studentText: string;
  personalizationSettings: PersonalizationSettings;
}): Promise<TutoringAiReply> {
  const recentTranscript = input.recentTurns
    .slice(-8)
    .map((turn) => `${turn.speaker}: ${turn.content}`)
    .join("\n");
  const promptText = [
    `辅导主题：${input.session.topic || "未命名主题"}`,
    `辅导目标：${input.session.goal || "帮助学生理解当前内容并完成下一步"}`,
    `学生本轮输入：${input.studentText || "学生暂未输入文字，请主要根据画面关键帧判断"}`,
    `上一帧描述：${input.frameDescription || "无"}`,
    `最近对话：\n${recentTranscript || "无"}`,
    `可参考知识：\n${buildKnowledgeContext(input.knowledgeEntries) || "无"}`,
    `可参考错题：\n${buildMistakeContext(input.mistakes) || "无"}`,
    "请像真实老师一样先判断学生卡在哪里，再给短讲解和一个下一步动作。",
  ].join("\n\n");
  const content: ChatMessageContent = input.frameDataUrl
    ? [
        { type: "text", text: promptText },
        { type: "image_url", image_url: { url: input.frameDataUrl } },
      ]
    : promptText;
  const response = await generateWithConnection(input.connection, input.frameDataUrl ? "vision" : "text", {
    maxOutputTokens: 1200,
    messages: [
      { role: "system", content: buildTutorSystemPrompt(input.personalizationSettings) },
      { role: "user", content },
    ],
    temperature: 0.28,
  });
  const parsed = parseJsonObject(response.content);
  return {
    boardNotes: toStringList(parsed.boardNotes),
    confidence: clampConfidence(parsed.confidence),
    detectedProblem: String(parsed.detectedProblem ?? "").trim(),
    frameDescription: String(parsed.frameDescription ?? input.frameDescription ?? "").trim(),
    nextQuestion: String(parsed.nextQuestion ?? "").trim(),
    studentAction: String(parsed.studentAction ?? "").trim(),
    teacherMessage: String(parsed.teacherMessage ?? "").trim() || "我先看一下你当前的内容，我们一步一步来。",
  };
}

// 结束会话时把完整文字稿压缩成摘要和下一步任务，仍不涉及原始音视频。
export async function requestTutorSummary(input: {
  session: TutoringSession;
  connection: ApiConnectionProfile;
  turns: TutoringTurn[];
  personalizationSettings: PersonalizationSettings;
}): Promise<TutoringSummaryDraft> {
  const transcript = input.turns.map((turn) => `${turn.speaker}: ${turn.content}`).join("\n");
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 900,
    messages: [
      {
        role: "system",
        content: [
          "你是课后复盘老师，只输出 JSON。",
          '格式：{"summary":"本次辅导摘要","nextActions":["下一步任务"]}',
          "摘要要具体，下一步任务要可执行。",
          buildPersonaPrompt(resolvePersona(input.personalizationSettings, "tutoring")),
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
    nextActions: toStringList(parsed.nextActions).slice(0, 6),
    summary: String(parsed.summary ?? "").trim() || "本次辅导已完成，建议根据课堂记录整理薄弱点。",
  };
}
