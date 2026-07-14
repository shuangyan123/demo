import type {
  ApiConnectionProfile,
  KnowledgeEntry,
  KnowledgeInternalizationDraft,
  Mistake,
  PersonalizationSettings,
} from "../types/review";
import { generateWithConnection } from "./ai-connection-client";
import { parseAiJsonValue } from "./ai-json.ts";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository";
import { buildPersonalMemoryContext } from "./personal-memory-context.ts";

type InternalizationPayload = {
  mode?: unknown;
  targetKnowledgeId?: unknown;
  category?: unknown;
  title?: unknown;
  summary?: unknown;
  principle?: unknown;
  conditions?: unknown;
  pitfalls?: unknown;
  steps?: unknown;
  transferPractice?: unknown;
  content?: unknown;
  tags?: unknown;
  reason?: unknown;
  confidence?: unknown;
};

// 截断发送给模型的长文本，控制内化任务的上下文和费用。
function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

// 清理模型可能返回的 Markdown 代码块并提取 JSON 主体。
function parseJson(content: string): InternalizationPayload {
  return parseAiJsonValue<InternalizationPayload>(content, "object");
}

// 把不可信的列表字段转换成短文本数组。
function toStringList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\n]/);
  return Array.from(new Set(source.map(String).map((item) => item.trim()).filter(Boolean))).slice(0, 12);
}

// 依据资料标题、标签和错题文本给候选资料排序，AI 只允许在这些本地 ID 中选择合并目标。
export function rankInternalizationCandidates(mistakes: Mistake[], entries: KnowledgeEntry[], limit = 8): KnowledgeEntry[] {
  const keywords = new Set(mistakes.flatMap((item) => [item.board, ...item.tags, ...item.reasons]).map((item) => item.trim()).filter(Boolean));
  return entries
    .map((entry) => {
      const haystack = [entry.category, entry.title, entry.summary, ...entry.tags].join(" ");
      const score = Array.from(keywords).reduce((total, keyword) => total + (keyword.length >= 2 && haystack.includes(keyword) ? 1 : 0), 0);
      return { entry, score };
    })
    .sort((left, right) => right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt))
    .slice(0, limit)
    .map((item) => item.entry);
}

// 调用 AI 把一组错题归纳成可编辑草稿；模型不得直接写入知识库。
export async function requestKnowledgeInternalization(input: {
  mistakes: Mistake[];
  candidates: KnowledgeEntry[];
  connection: ApiConnectionProfile;
  personalization: PersonalizationSettings;
}): Promise<KnowledgeInternalizationDraft> {
  if (!input.mistakes.length) throw new Error("请至少选择一道错题");
  const persona = resolvePersona(input.personalization, "knowledge_internalization");
  const allowedCandidateIds = new Set(input.candidates.map((entry) => entry.id));
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 2400,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "你负责把错题内化为可迁移的知识资料。不要照抄题干，不要编造事实。",
          "如果候选资料适合承载新知识，mode 使用 merge 且 targetKnowledgeId 只能取候选 ID；否则使用 create。",
          "只返回一个 JSON 对象，不要 Markdown。字段：mode、targetKnowledgeId、category、title、summary、principle、conditions、pitfalls、steps、transferPractice、content、tags、reason、confidence。",
          "category 只能是政治理论、常识判断、申论。confidence 为 0 到 1。content 必须是可直接阅读的完整知识正文。",
          buildPersonaPrompt(persona),
          buildPersonalMemoryContext(input.personalization, { moduleId: "knowledge_internalization" }),
        ].join("\n\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          mistakes: input.mistakes.map((mistake) => ({
            id: mistake.id,
            board: mistake.board,
            stem: compact(mistake.stem, 700),
            answer: compact(mistake.answer, 260),
            explanation: compact(mistake.explanation, 800),
            reasons: mistake.reasons,
            tags: mistake.tags,
          })),
          candidates: input.candidates.map((entry) => ({
            id: entry.id,
            category: entry.category,
            title: entry.title,
            summary: compact(entry.summary, 360),
            content: compact(entry.content, 900),
            tags: entry.tags,
          })),
        }),
      },
    ],
  });
  const parsed = parseJson(response.content);
  const targetId = String(parsed.targetKnowledgeId ?? "").trim();
  const mode = parsed.mode === "merge" && allowedCandidateIds.has(targetId) ? "merge" : "create";
  const category = ["政治理论", "常识判断", "申论"].includes(String(parsed.category))
    ? (String(parsed.category) as KnowledgeInternalizationDraft["category"])
    : "常识判断";
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    selected: true,
    mode,
    sourceMistakeIds: input.mistakes.map((item) => item.id),
    targetKnowledgeId: mode === "merge" ? targetId : undefined,
    category,
    title: String(parsed.title ?? "错题知识内化").trim(),
    summary: String(parsed.summary ?? "").trim(),
    principle: String(parsed.principle ?? "").trim(),
    conditions: toStringList(parsed.conditions),
    pitfalls: toStringList(parsed.pitfalls),
    steps: toStringList(parsed.steps),
    transferPractice: String(parsed.transferPractice ?? "").trim(),
    content: String(parsed.content ?? "").trim(),
    tags: toStringList(parsed.tags),
    reason: String(parsed.reason ?? "由错题中的共性知识整理").trim(),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.6)),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
