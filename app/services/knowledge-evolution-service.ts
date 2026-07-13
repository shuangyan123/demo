import type {
  ApiConnectionProfile,
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeEvolutionGenerationDiagnostic,
  KnowledgeEvolutionGenerationResult,
  KnowledgeEvolutionProposal,
  ObsidianGraphSnapshot,
  PersonalizationSettings,
} from "../types/review";
import type { AiSelectedRuntimeValues } from "../types/domains/ai-model";
import { generateWithConnection } from "./ai-connection-client.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { extractAiJsonText, parseAiJsonArray, parseAiJsonObject } from "./ai-json.ts";
import { emitAiActivity } from "./ai-activity-events.ts";
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

const proposalResponseSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "sourceIds", "category", "title", "summary", "content", "tags", "proposedLinks", "reason", "confidence"],
        properties: {
          mode: { type: "string", enum: ["create", "merge", "link"] }, sourceIds: { type: "array", items: { type: "string" } },
          targetKnowledgeId: { type: ["string", "null"] }, category: { type: "string", enum: ["政治理论", "常识判断", "申论"] },
          title: { type: "string" }, summary: { type: "string" }, content: { type: "string" }, tags: { type: "array", items: { type: "string" } },
          proposedLinks: { type: "array", items: { type: "string" } }, reason: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

function textList(value: unknown, limit = 12): string[] {
  const source = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\n]/);
  return Array.from(new Set(source.map(String).map((item) => item.trim()).filter(Boolean))).slice(0, limit);
}

function parsePayload(content: string): { items: ProposalPayload[]; diagnostic?: KnowledgeEvolutionGenerationDiagnostic } {
  if (!content.trim()) return { items: [], diagnostic: { id: "empty-response", tone: "error", message: "厂商返回了空内容。" } };
  try {
    const candidate = extractAiJsonText(content);
    if (candidate.indexOf("{") >= 0 && (candidate.indexOf("[") < 0 || candidate.indexOf("{") < candidate.indexOf("["))) {
      const envelope = parseAiJsonObject(content, "AI 返回不是有效提案对象");
      return { items: Array.isArray(envelope.proposals) ? envelope.proposals as ProposalPayload[] : [] };
    }
    return { items: parseAiJsonArray<ProposalPayload>(content) };
  } catch (error) {
    return {
      items: [],
      diagnostic: {
        id: "parse-error",
        tone: "error",
        message: error instanceof Error ? error.message : "AI 返回内容无法解析为提案 JSON 数组。",
      },
    };
  }
}

export function normalizeKnowledgeEvolutionPayload(input: {
  content: string;
  sources: KnowledgeEvolutionSource[];
  entries: KnowledgeEntry[];
  timestamp?: string;
  requestId?: string;
}): KnowledgeEvolutionGenerationResult {
  const allowedSourceIds = new Set(input.sources.map((item) => item.id));
  const allowedTargets = new Set(input.entries.map((item) => item.id));
  const timestamp = input.timestamp ?? new Date().toISOString();
  const parsed = parsePayload(input.content);
  const diagnostics: KnowledgeEvolutionGenerationDiagnostic[] = parsed.diagnostic ? [parsed.diagnostic] : [];
  const filteredDiagnostics: KnowledgeEvolutionGenerationDiagnostic[] = [];
  const proposals = parsed.items.slice(0, 5).map((item): KnowledgeEvolutionProposal => {
    const sourceIds = textList(item.sourceIds).filter((id) => allowedSourceIds.has(id));
    const requestedTarget = String(item.targetKnowledgeId ?? "").trim();
    const targetKnowledgeId = allowedTargets.has(requestedTarget) ? requestedTarget : undefined;
    const requestedMode = item.mode === "merge" || item.mode === "link" ? item.mode : "create";
    const mode = requestedMode !== "create" && !targetKnowledgeId ? "create" : requestedMode;
    const source = input.sources.find((candidate) => sourceIds.includes(candidate.id)) ?? input.sources[0];
    const target = targetKnowledgeId ? input.entries.find((entry) => entry.id === targetKnowledgeId) : undefined;
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
      proposedLinks: textList(item.proposedLinks).filter((link) => link !== target?.title && link !== String(item.title ?? "知识演进提案").trim()),
      reason: String(item.reason ?? "由长期学习记录归纳").trim(),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.6)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }).filter((item) => {
    if (!item.content && !item.proposedLinks.length) {
      filteredDiagnostics.push({ id: `empty-${item.id}`, tone: "warning", message: `提案“${item.title}”缺少演进内容和 Wikilink，已过滤。` });
      return false;
    }
    if (item.targetKnowledgeId && item.sourceIds.includes(`knowledge:${item.targetKnowledgeId}`)) {
      filteredDiagnostics.push({ id: `self-${item.id}`, tone: "warning", message: `提案“${item.title}”指向自身来源，已过滤。` });
      return false;
    }
    return true;
  });
  return {
    proposals,
    diagnostics: [...diagnostics, ...filteredDiagnostics],
    parsedCount: parsed.items.length,
    filteredCount: filteredDiagnostics.length,
    sourceCount: input.sources.length,
    requestId: input.requestId,
    emptyKind: proposals.length ? undefined : !input.content.trim() ? "empty_response" : diagnostics.length ? "parse_error" : parsed.items.length ? "filtered" : "empty_response",
    emptyReason: proposals.length
      ? undefined
      : diagnostics.length
        ? "AI 返回内容未能解析为可保存提案。"
        : parsed.items.length
          ? "AI 返回的提案均因缺少内容或自引用被过滤。"
          : "AI 返回了 0 条提案。",
  };
}

/** AI 只产生可审查提案；调用方确认前不会更新知识库或 Obsidian。 */
export async function requestKnowledgeEvolutionProposals(input: {
  connection: ApiConnectionProfile;
  personalization: PersonalizationSettings;
  sources: KnowledgeEvolutionSource[];
  entries: KnowledgeEntry[];
  graph?: ObsidianGraphSnapshot;
  activityRunId?: string;
  modelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
}): Promise<KnowledgeEvolutionGenerationResult> {
  if (!input.sources.length) throw new Error("暂无新的错题、面试、辅导或知识资料可用于演进");
  const modelId = await aiConnectionsRepository.resolveRuntimeModel(input.connection, "text", input.modelId);
  const activityBase = {
    runId: input.activityRunId ?? crypto.randomUUID(),
    module: "Obsidian 插件",
    purpose: "知识演进提案",
    projectId: "civil-service",
    studyDomainId: "civil-service",
    conversationId: input.activityRunId ?? "knowledge-evolution",
    threadTitle: "公考知识演进",
    attachments: [
      { id: "sources", label: `${input.sources.length} 条来源摘要`, kind: "context" as const },
      { id: "candidates", label: `${input.entries.length} 条候选知识`, kind: "context" as const },
      ...(input.graph ? [{ id: "obsidian-graph", label: "Obsidian 图谱摘要", kind: "vault" as const }] : []),
    ],
    toolDisplayMode: "drawer" as const,
    connectionLabel: input.connection.label,
    model: modelId,
    label: `${input.connection.provider} · ${modelId}`,
  };
  emitAiActivity({ ...activityBase, phase: "started", stepId: "context", text: `准备 ${input.sources.length} 条来源、${input.entries.length} 条候选知识` });
  emitAiActivity({ ...activityBase, phase: "waiting", stepId: "connection", text: `使用 ${input.connection.label} / ${modelId}` });
  const persona = resolvePersona(input.personalization, "knowledge_internalization");
  const requestMessages = [
      {
        role: "system" as const,
        content: [
          "你负责把长期学习记录整理成知识图谱演进提案。不得编造事实，不得直接写入任何文件。",
          "只返回 JSON 对象，格式为 {\"proposals\": [...]}，最多 5 项。字段：mode、sourceIds、targetKnowledgeId、category、title、summary、content、tags、proposedLinks、reason、confidence。",
          "mode 只能是 create、merge、link。merge/link 的 targetKnowledgeId 只能选择候选知识 ID；sourceIds 只能选择输入来源 ID。",
          "category 只能是政治理论、常识判断、申论。proposedLinks 使用候选知识标题，供 Obsidian Wikilink 使用。",
          "优先合并重复概念、建立有证据的关系；content 只写准备加入 AI 演进区块的内容，不复述整篇资料。",
          "如果提供 Obsidian 图谱上下文，优先利用已有 Wikilink 关系补全 link 或 merge 提案。",
          buildPersonaPrompt(persona),
        ].join("\n\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          sources: input.sources.map((item) => ({ ...item, content: item.content.slice(0, 1600) })),
          candidates: input.entries.slice(0, 30).map((entry) => ({ id: entry.id, category: entry.category, title: entry.title, summary: entry.summary, tags: entry.tags })),
          obsidianGraph: input.graph ? {
            nodes: input.graph.nodes.slice(0, 40).map((node) => ({ id: node.knowledgeId ?? node.id, title: node.title, status: node.status })),
            edges: input.graph.edges.slice(0, 80).map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId, label: edge.label })),
          } : undefined,
        }),
      },
    ];
  const generate = (messages: typeof requestMessages) => generateWithConnection(input.connection, "text", { modelId, selectedRuntimeValues: input.selectedRuntimeValues,
    maxOutputTokens: 3000,
    temperature: 0.1,
    messages,
    structuredOutput: { name: "knowledge_evolution_proposals", schema: proposalResponseSchema, strict: true },
    activity: {
      runId: activityBase.runId,
      module: activityBase.module,
      purpose: activityBase.purpose,
      connectionLabel: input.connection.label,
    },
  });
  let response = await generate(requestMessages);
  emitAiActivity({ ...activityBase, phase: "waiting", stepId: "parse", text: "正在解析知识演进 JSON" });
  let result = normalizeKnowledgeEvolutionPayload({ content: response.content, sources: input.sources, entries: input.entries, requestId: response.requestId });
  if (!result.proposals.length) {
    emitAiActivity({ ...activityBase, phase: "waiting", stepId: "repair", text: "首次未得到可用提案，正在执行一次结构化修复" });
    response = await generate([...requestMessages, { role: "user", content: `上一次结果不可用：${result.emptyReason}。请严格按 JSON Schema 返回至少一条有 content 或 proposedLinks 的提案。` }]);
    const repaired = normalizeKnowledgeEvolutionPayload({ content: response.content, sources: input.sources, entries: input.entries, requestId: response.requestId });
    repaired.diagnostics.unshift({ id: "repair-retry", tone: repaired.proposals.length ? "info" : "warning", message: "已自动执行一次结构化修复重试。" });
    result = repaired;
  }
  emitAiActivity({
    ...activityBase,
    phase: result.proposals.length ? "done" : "error",
    stepId: result.proposals.length ? "proposal" : "empty",
    text: result.proposals.length ? `解析出 ${result.proposals.length} 条可确认提案` : result.emptyReason,
  });
  return result;
}
