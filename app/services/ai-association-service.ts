import type { ApiConnectionProfile, AssociationSuggestion, KnowledgeEntry, Mistake } from "../types/review";
import { generateWithConnection } from "./ai-connection-client";

type AiAssociationItem = {
  targetId?: unknown;
  relatedId?: unknown;
  score?: unknown;
  reason?: unknown;
  evidence?: unknown;
};

// 截断发送给 AI 的文本，避免一次关联分析把完整本地资料全部塞进请求体。
function compactText(value: string, maxLength = 700): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

// 兼容 AI 返回 markdown 代码块的情况，只解析 JSON 主体。
function parseAiAssociationJson(content: string): AiAssociationItem[] {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { items?: AiAssociationItem[] } | AiAssociationItem[];
  return Array.isArray(parsed) ? parsed : parsed.items ?? [];
}

// 将模型分数规范到 0-100，方便 UI 统一展示可信度。
function normalizeScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score)) return 60;
  if (score > 0 && score <= 1) return Math.round(score * 100);
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 把任意 evidence 字段整理成短文本数组，避免 UI 渲染空值或对象。
function normalizeEvidence(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,，;；\n]/);
  return list.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 3);
}

// 通过默认文本连接调用统一生成路由，关联分析不再读取旧版单连接设置。
async function requestAssociationAnalysis(connection: ApiConnectionProfile, prompt: string): Promise<AiAssociationItem[]> {
  const result = await generateWithConnection(connection, "text", {
    messages: [
      {
        role: "system",
        content:
          "你是错题和知识库关联分析助手。只能从用户给出的候选 ID 里选择关联项，不要编造 ID。只返回 JSON，不要解释。格式：{\"items\":[{\"targetId\":\"\",\"relatedId\":\"\",\"score\":88,\"reason\":\"\",\"evidence\":[\"\"]}]}",
      },
      { role: "user", content: prompt },
    ],
  });
  return parseAiAssociationJson(result.content);
}

// 用 AI 分析“当前错题 -> 候选知识资料”的关联，返回尚未落库的可确认建议。
export async function analyzeMistakeKnowledgeAssociations(input: {
  mistake: Mistake;
  candidates: KnowledgeEntry[];
  connection: ApiConnectionProfile;
}): Promise<AssociationSuggestion[]> {
  const allowedIds = new Set(input.candidates.map((entry) => entry.id));
  const prompt = [
    "目标类型：错题",
    `目标 ID：${input.mistake.id}`,
    `目标内容：${compactText([input.mistake.board, input.mistake.stem, input.mistake.answer, input.mistake.explanation, input.mistake.reasons.join("、"), input.mistake.tags.join("、")].join("\n"))}`,
    "候选知识资料：",
    JSON.stringify(
      input.candidates.map((entry) => ({
        id: entry.id,
        category: entry.category,
        title: entry.title,
        summary: compactText(entry.summary || entry.content, 360),
        tags: entry.tags,
      })),
    ),
    "请找出最值得确认关联的知识资料。targetId 必须等于目标 ID，relatedId 必须来自候选知识资料 id。",
  ].join("\n");

  const items = await requestAssociationAnalysis(input.connection, prompt);
  return items
    .filter((item) => String(item.targetId) === input.mistake.id && allowedIds.has(String(item.relatedId)))
    .map((item) => ({
      id: crypto.randomUUID(),
      selected: true,
      targetId: input.mistake.id,
      relatedId: String(item.relatedId),
      mistakeId: input.mistake.id,
      knowledgeId: String(item.relatedId),
      score: normalizeScore(item.score),
      reason: String(item.reason ?? "AI 判断该资料可解释这道错题").trim(),
      evidence: normalizeEvidence(item.evidence),
      source: "ai",
    }));
}

// 用 AI 分析“当前知识资料 -> 候选错题”的关联，返回尚未落库的可确认建议。
export async function analyzeKnowledgeMistakeAssociations(input: {
  entry: KnowledgeEntry;
  candidates: Mistake[];
  connection: ApiConnectionProfile;
}): Promise<AssociationSuggestion[]> {
  const allowedIds = new Set(input.candidates.map((mistake) => mistake.id));
  const prompt = [
    "目标类型：知识资料",
    `目标 ID：${input.entry.id}`,
    `目标内容：${compactText([input.entry.category, input.entry.title, input.entry.summary, input.entry.content, input.entry.tags.join("、")].join("\n"))}`,
    "候选错题：",
    JSON.stringify(
      input.candidates.map((mistake) => ({
        id: mistake.id,
        board: mistake.board,
        stem: compactText(mistake.stem, 360),
        answer: compactText(mistake.answer, 160),
        reasons: mistake.reasons,
        tags: mistake.tags,
      })),
    ),
    "请找出最值得确认关联的错题。targetId 必须等于目标 ID，relatedId 必须来自候选错题 id。",
  ].join("\n");

  const items = await requestAssociationAnalysis(input.connection, prompt);
  return items
    .filter((item) => String(item.targetId) === input.entry.id && allowedIds.has(String(item.relatedId)))
    .map((item) => ({
      id: crypto.randomUUID(),
      selected: true,
      targetId: input.entry.id,
      relatedId: String(item.relatedId),
      mistakeId: String(item.relatedId),
      knowledgeId: input.entry.id,
      score: normalizeScore(item.score),
      reason: String(item.reason ?? "AI 判断这道错题可由该资料解释").trim(),
      evidence: normalizeEvidence(item.evidence),
      source: "ai",
    }));
}
