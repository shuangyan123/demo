import { generateWithConnection } from "./ai-connection-client";
import { buildEmptyInterviewDimensions, interviewRubrics, interviewTypeLabels } from "./interview-rubric";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository";
import type {
  ApiConnectionProfile,
  InterviewDifficulty,
  InterviewEvaluation,
  InterviewPracticePlan,
  InterviewQuestion,
  InterviewQuestionDraft,
  InterviewSession,
  InterviewStage,
  InterviewTurn,
  InterviewType,
  PersonalizationSettings,
} from "../types/review";

export type InterviewAiReply = {
  reply: string;
  nextStage: InterviewStage;
  shouldEvaluate: boolean;
};

type EvaluationDraft = Omit<InterviewEvaluation, "id" | "createdAt" | "updatedAt">;
type PracticePlanDraft = Omit<InterviewPracticePlan, "id" | "createdAt" | "updatedAt">;

const allowedStages: InterviewStage[] = [
  "briefing",
  "preparation",
  "answering",
  "follow_up",
  "peer_review",
  "response",
  "discussion",
  "summary",
  "evaluated",
];
const allowedTypes: InterviewType[] = ["structured", "structured_group", "leaderless_group"];
const allowedDifficulties: InterviewDifficulty[] = ["easy", "medium", "hard"];

// 兼容题库题目和会话题目快照的字段差异。
function resolveQuestionPrompt(question: InterviewQuestion | InterviewSession): string {
  return "prompt" in question ? question.prompt : question.questionPrompt;
}

// 兼容题库题目和会话题目快照的材料字段差异。
function resolveQuestionMaterial(question: InterviewQuestion | InterviewSession): string {
  return "material" in question ? question.material : question.questionMaterial;
}

// 从模型返回中提取 JSON，兼容模型额外包裹 Markdown 代码块的情况。
function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const jsonText = fenced ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 返回不是有效 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

// 把未知值安全转成字符串数组，避免 AI 少字段时污染 IndexedDB。
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

// 把 AI 可能返回的数字安全压进业务区间，避免异常值污染草稿和计划。
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, numberValue));
}

// 面试类型只允许使用本地枚举，AI 返回未知类型时回退到用户选择的类型。
function normalizeType(value: unknown, fallback: InterviewType): InterviewType {
  const type = String(value ?? "");
  return allowedTypes.includes(type as InterviewType) ? (type as InterviewType) : fallback;
}

// 难度字段只用于筛选和训练节奏，非法值回退到中等难度。
function normalizeDifficulty(value: unknown): InterviewDifficulty {
  const difficulty = String(value ?? "");
  return allowedDifficulties.includes(difficulty as InterviewDifficulty) ? (difficulty as InterviewDifficulty) : "medium";
}

// 限制 AI 返回阶段必须属于本地枚举，避免模型编造流程状态。
function normalizeStage(value: unknown, fallback: InterviewStage): InterviewStage {
  const stage = String(value ?? "");
  return allowedStages.includes(stage as InterviewStage) ? (stage as InterviewStage) : fallback;
}

// 解析 AI 出题结果，所有条目先变成本地草稿，不在服务层直接写入 Dexie。
function parseQuestionDrafts(content: string, fallbackType: InterviewType): InterviewQuestionDraft[] {
  const parsed = parseJsonObject(content);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items
    .map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const title = String(row.title ?? "").trim();
      const prompt = String(row.prompt ?? "").trim();
      const issues: string[] = [];
      if (!title) issues.push("缺少标题");
      if (!prompt) issues.push("缺少题干");
      return {
        id: crypto.randomUUID(),
        selected: Boolean(title && prompt),
        type: normalizeType(row.type, fallbackType),
        title: title || "未命名面试题",
        prompt,
        material: String(row.material ?? "").trim(),
        tags: toStringList(row.tags),
        source: String(row.source ?? "AI 生成").trim() || "AI 生成",
        difficulty: normalizeDifficulty(row.difficulty),
        expectedDurationSec: clampNumber(row.expectedDurationSec, 30, 900, 180),
        confidence: clampNumber(row.confidence, 0, 1, issues.length ? 0.45 : 0.75),
        issues,
      };
    })
    .filter((draft) => draft.title || draft.prompt);
}

// 构造三类面试共用的系统提示词，评分标准来自同一份 rubric。
function buildInterviewSystemPrompt(type: InterviewType, personalizationSettings: PersonalizationSettings) {
  const rubric = interviewRubrics[type];
  const persona = resolvePersona(personalizationSettings, "interview");
  const dimensions = rubric.dimensions.map((item) => `${item.name}（${item.maxScore}分）：${item.focus}`).join("\n");
  return [
    `你是严格、克制、专业的${interviewTypeLabels[type]}线上模拟面试官。`,
    buildPersonaPrompt(persona),
    "你需要按真实面试流程推进，不要闲聊，不要生成不存在的本地数据 ID。",
    "每次回复必须是 JSON 对象，不能输出 Markdown。",
    "对话回复格式：{\"reply\":\"面试官发言\",\"nextStage\":\"briefing|preparation|answering|follow_up|peer_review|response|discussion|summary|evaluated\",\"shouldEvaluate\":false}",
    "评分回复格式：{\"totalScore\":0-100,\"dimensions\":[{\"name\":\"维度名\",\"score\":数字,\"maxScore\":数字,\"comment\":\"依据\"}],\"strengths\":[],\"problems\":[],\"suggestions\":[],\"evidence\":[]}",
    `评分标准：\n${dimensions}`,
  ].join("\n");
}

// 根据当前会话上下文请求 AI 面试官下一轮发言。
export async function requestInterviewReply(input: {
  question: InterviewQuestion | InterviewSession;
  session: InterviewSession;
  connection: ApiConnectionProfile;
  turns: InterviewTurn[];
  personalizationSettings: PersonalizationSettings;
}): Promise<InterviewAiReply> {
  const transcript = input.turns.map((turn) => `${turn.speaker}/${turn.stage}: ${turn.content}`).join("\n");
  const prompt = resolveQuestionPrompt(input.question);
  const material = resolveQuestionMaterial(input.question);
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 900,
    messages: [
      { role: "system", content: buildInterviewSystemPrompt(input.session.type, input.personalizationSettings) },
      {
        role: "user",
        content: [
          `题目：${input.question.title}`,
          `材料：${material || "无"}`,
          `题干：${prompt}`,
          `当前阶段：${input.session.stage}`,
          `历史对话：\n${transcript || "尚未开始"}`,
          "请继续推进下一轮线上面试。如果已经足够评分，把 shouldEvaluate 设为 true。",
        ].join("\n\n"),
      },
    ],
    temperature: 0.35,
  });
  const parsed = parseJsonObject(response.content);
  return {
    reply: String(parsed.reply ?? "").trim() || "请继续作答。",
    nextStage: normalizeStage(parsed.nextStage, input.session.stage),
    shouldEvaluate: Boolean(parsed.shouldEvaluate),
  };
}

// 根据用户指定的类型、主题和上下文生成面试题草稿；调用方必须让用户确认后再入库。
export async function requestInterviewQuestions(input: {
  connection: ApiConnectionProfile;
  type: InterviewType;
  topic: string;
  count: number;
  context: string;
  personalizationSettings: PersonalizationSettings;
}): Promise<InterviewQuestionDraft[]> {
  const count = clampNumber(input.count, 1, 12, 5);
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 2200,
    messages: [
      {
        role: "system",
        content: [
          "你是公务员录用面试训练题库编辑，只输出严格 JSON。",
          buildPersonaPrompt(resolvePersona(input.personalizationSettings, "interview")),
          "不要输出 Markdown，不要编造本地数据库 ID。",
          "题目必须适合线上模拟训练，材料题要把材料放进 material 字段。",
          '返回格式：{"items":[{"type":"structured|structured_group|leaderless_group","title":"标题","prompt":"题干","material":"材料","tags":["标签"],"difficulty":"easy|medium|hard","expectedDurationSec":180,"source":"来源","confidence":0.8}]}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `面试类型：${interviewTypeLabels[input.type]}`,
          `题量：${count}`,
          `主题来源：${input.topic || "综合训练"}`,
          `补充上下文：${input.context || "无"}`,
          "请生成可直接进入草稿预览的面试训练题。",
        ].join("\n\n"),
      },
    ],
    temperature: 0.32,
  });
  const drafts = parseQuestionDrafts(response.content, input.type);
  if (!drafts.length) {
    throw new Error("AI 没有返回可用的面试题草稿");
  }
  return drafts;
}

// 基于本地候选题生成训练计划草稿；AI 只能引用传入的题目 ID，不能凭空新增题目。
export async function requestInterviewPracticePlan(input: {
  connection: ApiConnectionProfile;
  type: InterviewType | "mixed";
  questions: InterviewQuestion[];
  targetSessionCount: number;
  title?: string;
  personalizationSettings: PersonalizationSettings;
}): Promise<PracticePlanDraft> {
  if (!input.questions.length) {
    throw new Error("请先准备可用于计划的面试题");
  }
  const targetSessionCount = clampNumber(input.targetSessionCount, 1, 30, Math.min(5, input.questions.length));
  const candidateIds = new Set(input.questions.map((question) => question.id));
  const candidates = input.questions
    .slice(0, 40)
    .map((question) => ({
      id: question.id,
      type: question.type,
      title: question.title,
      tags: question.tags,
      difficulty: question.difficulty ?? "medium",
      practiceCount: question.practiceCount ?? 0,
    }));
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          "你是面试训练计划教练，只输出严格 JSON。",
          buildPersonaPrompt(resolvePersona(input.personalizationSettings, "interview")),
          "计划只能引用用户提供的候选题目 ID，不能生成新的 ID。",
          '返回格式：{"title":"计划名","type":"structured|structured_group|leaderless_group|mixed","questionIds":["本地题目ID"],"targetSessionCount":5,"nextPracticeAt":"ISO日期","reason":"安排理由"}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `目标类型：${input.type === "mixed" ? "混合训练" : interviewTypeLabels[input.type]}`,
          `目标场次：${targetSessionCount}`,
          `计划名称偏好：${input.title || "无"}`,
          `候选题：${JSON.stringify(candidates)}`,
        ].join("\n\n"),
      },
    ],
    temperature: 0.2,
  });
  const parsed = parseJsonObject(response.content);
  const questionIds = toStringList(parsed.questionIds).filter((id) => candidateIds.has(id));
  if (!questionIds.length) {
    throw new Error("AI 计划没有引用任何本地候选题");
  }
  const nextDate = String(parsed.nextPracticeAt ?? "").trim();
  return {
    title: String(parsed.title ?? input.title ?? "面试训练计划").trim() || "面试训练计划",
    type: parsed.type === "mixed" ? "mixed" : normalizeType(parsed.type, input.questions[0]?.type ?? "structured"),
    questionIds,
    targetSessionCount,
    completedSessionCount: 0,
    nextPracticeAt: Number.isNaN(Date.parse(nextDate)) ? new Date().toISOString() : new Date(nextDate).toISOString(),
    status: "active",
    reason: String(parsed.reason ?? "根据候选题难度、标签和练习次数生成").trim(),
  };
}

// 根据完整文字稿生成 100 分制评分；解析失败时抛错，调用方不写库。
export async function requestInterviewEvaluation(input: {
  session: InterviewSession;
  connection: ApiConnectionProfile;
  turns: InterviewTurn[];
  personalizationSettings: PersonalizationSettings;
}): Promise<EvaluationDraft> {
  const rubric = interviewRubrics[input.session.type];
  const transcript = input.turns.map((turn) => `${turn.speaker}/${turn.stage}: ${turn.content}`).join("\n");
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 1400,
    messages: [
      { role: "system", content: buildInterviewSystemPrompt(input.session.type, input.personalizationSettings) },
      {
        role: "user",
        content: [
          "请对本场线上模拟面试进行最终评分，只返回评分 JSON。",
          `面试类型：${rubric.label}`,
          `题目：${input.session.title}`,
          `材料：${input.session.questionMaterial || "无"}`,
          `题干：${input.session.questionPrompt}`,
          `文字稿：\n${transcript}`,
        ].join("\n\n"),
      },
    ],
    temperature: 0.1,
  });
  const parsed = parseJsonObject(response.content);
  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.map((item, index) => {
        const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const fallback = rubric.dimensions[index] ?? rubric.dimensions[0];
        return {
          name: String(row.name ?? fallback.name),
          score: Math.max(0, Math.min(Number(row.maxScore ?? fallback.maxScore), Number(row.score ?? 0))),
          maxScore: Number(row.maxScore ?? fallback.maxScore),
          comment: String(row.comment ?? "AI 未提供该维度说明"),
        };
      })
    : buildEmptyInterviewDimensions(input.session.type);

  return {
    sessionId: input.session.id,
    type: input.session.type,
    totalScore: Math.max(0, Math.min(100, Number(parsed.totalScore ?? dimensions.reduce((sum, item) => sum + item.score, 0)))),
    dimensions,
    strengths: toStringList(parsed.strengths),
    problems: toStringList(parsed.problems),
    suggestions: toStringList(parsed.suggestions),
    evidence: toStringList(parsed.evidence),
  };
}
