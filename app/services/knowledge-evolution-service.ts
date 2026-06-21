import type { ApiConnectionProfile, KnowledgeCategory, KnowledgeEntry, KnowledgeEvolutionProposal, PersonalizationSettings } from "../types/review";
import { generateWithConnection } from "./ai-connection-client.ts";
import type { KnowledgeEvolutionSource } from "./obsidian-knowledge-repository";
import { buildPersonaPrompt, resolvePersona } from "./personalization-settings-repository.ts";

type ProposalPayload = {
  mode?: unknown;
  sourceIds?: unknown;
  targetKnowledgeId?: unknown;
  category?: unknown;
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  tags?: unknown;
  proposedLinks?: unknown;
  reason?: unknown;
  confidence?: unknown;
};

function textList(value: unknown, limit = 12): string[] {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\n]/);
  return Array.from(new Set(source.map(String).map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function parsePayload(content: string): ProposalPayload[] {
  const clean = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(clean) as unknown;
  return Array.isArray(parsed) ? parsed as ProposalPayload[] : [];
}

/** AI 只产生可审查提案；调用方确认前不会更新知识库或 Obsidian。 */
export async function requestKnowledgeEvolutionProposals(input: {
  connection: ApiConnectionProfile;
  personalization: PersonalizationSettings;
  sources: KnowledgeEvolutionSource[];
  entries: KnowledgeEntry[];
}): Promise<KnowledgeEvolutionProposal[]> {
  if (!input.sources.length) throw new Error("暂无新的错题、面试、辅导或知识资料可用于演进");
  const allowedSourceIds = new Set(input.sources.map((item) => item.id));
  const allowedTargets = new Set(input.entries.map((item) => item.id));
  const persona = resolvePersona(input.personalization, "knowledge_internalization");
  const response = await generateWithConnection(input.connection, "text", {
    maxOutputTokens: 3000,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "你负责把长期学习记录整理成知识图谱演进提案。不得编造事实，不得直接写入任何文件。",
          "只返回 JSON 数组，最多 5 项。字段：mode、sourceIds、targetKnowledgeId、category、title、summary、content、tags、proposedLinks、reason、confidence。",
          "mode 只能是 create、merge、link。merge/link 的 targetKnowledgeId 只能选择候选知识 ID；sourceIds 只能选择输入来源 ID。",
          "category 只能是政治理论、常识判断、申论。proposedLinks 使用候选知识标题，供 Obsidian Wikilink 使用。",
          "优先合并重复概念、建立有证据的关系；content 只写准备加入 AI 演进区块的内容，不复述整篇资料。",
          buildPersonaPrompt(persona),
        ].join("\n\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          sources: input.sources.map((item) => ({ ...item, content: item.content.slice(0, 1600) })),
          candidates: input.entries.slice(0, 30).map((entry) => ({ id: entry.id, category: entry.category, title: entry.title, summary: entry.summary, tags: entry.tags })),
        }),
      },
    ],
  });
  const timestamp = new Date().toISOString();
  return parsePayload(response.content).slice(0, 5).map((item): KnowledgeEvolutionProposal => {
    const sourceIds = textList(item.sourceIds).filter((id) => allowedSourceIds.has(id));
    const requestedTarget = String(item.targetKnowledgeId ?? "").trim();
    const targetKnowledgeId = allowedTargets.has(requestedTarget) ? requestedTarget : undefined;
    const requestedMode = item.mode === "merge" || item.mode === "link" ? item.mode : "create";
    const mode = requestedMode !== "create" && !targetKnowledgeId ? "create" : requestedMode;
    const source = input.sources.find((candidate) => sourceIds.includes(candidate.id)) ?? input.sources[0];
    const rawCategory = String(item.category ?? "");
    const category: KnowledgeCategory = rawCategory === "政治理论" || rawCategory === "申论" ? rawCategory : "常识判断";
    return {
      id: crypto.randomUUID(),
      mode,
      status: "pending",
      category,
      sourceType: source.type,
      sourceIds: sourceIds.length ? sourceIds : [source.id],
      targetKnowledgeId: mode === "create" ? undefined : targetKnowledgeId,
      title: String(item.title ?? "知识演进提案").trim(),
      summary: String(item.summary ?? "").trim(),
      content: String(item.content ?? "").trim(),
      tags: textList(item.tags),
      proposedLinks: textList(item.proposedLinks),
      reason: String(item.reason ?? "由长期学习记录归纳").trim(),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.6)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }).filter((item) => item.content || item.proposedLinks.length);
}
