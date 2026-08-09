import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { AiConversation, AiConversationAttachment, AiConversationMessage, AiConversationRunStep, ConversationContextCompaction } from "../types/domains/conversation.ts";
import { parseAiJsonObject } from "./ai-json.ts";
import { generateWithConnection } from "./ai-connection-client.ts";
import { canonicalTurnsToChatHistory, buildCanonicalConversationTurns } from "./canonical-conversation-context.ts";
import { estimateChatMessagesTokens } from "./conversation-context-budget.ts";

const KEEP_RECENT_MESSAGES = 12;
const MIN_SOURCE_TOKENS = 400;

export type ConversationCompactionCandidate = {
  boundaryMessageId: string;
  sourceMessageCount: number;
  sourceText: string;
  estimatedTokensBefore: number;
};

/** 只压缩边界后的旧消息，最近六轮始终以原文保留。 */
export function buildConversationCompactionCandidate(input: {
  conversation: AiConversation;
  messages: AiConversationMessage[];
  attachments?: AiConversationAttachment[];
  runSteps?: AiConversationRunStep[];
}): ConversationCompactionCandidate | undefined {
  const visible = input.messages.filter((message) => message.role === "user" || message.role === "assistant");
  const previousBoundary = input.conversation.contextCompaction
    ? visible.findIndex((message) => message.id === input.conversation.contextCompaction?.throughMessageId)
    : -1;
  const uncompacted = previousBoundary >= 0 ? visible.slice(previousBoundary + 1) : visible;
  const candidates = uncompacted.slice(0, Math.max(0, uncompacted.length - KEEP_RECENT_MESSAGES));
  const boundary = candidates.at(-1);
  if (!boundary) return undefined;
  const history = canonicalTurnsToChatHistory(buildCanonicalConversationTurns({
    messages: candidates,
    attachments: input.attachments,
    runSteps: input.runSteps,
  }));
  const estimatedTokensBefore = estimateChatMessagesTokens(history);
  if (estimatedTokensBefore < MIN_SOURCE_TOKENS) return undefined;
  return {
    boundaryMessageId: boundary.id,
    sourceMessageCount: candidates.length,
    sourceText: history.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n"),
    estimatedTokensBefore,
  };
}

function compactStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`压缩摘要缺少${label}`);
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
}

function normalizeSummary(value: unknown): string {
  const parsed = typeof value === "string" ? parseAiJsonObject(value, "模型没有返回有效的上下文摘要") : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("模型没有返回有效的上下文摘要");
  const object = parsed as Record<string, unknown>;
  const sections: Array<[string, string[]]> = [
    ["目标", compactStringList(object.goals, "目标")],
    ["确认事实", compactStringList(object.facts, "确认事实")],
    ["用户要求与约束", compactStringList(object.constraints, "约束")],
    ["已作决定", compactStringList(object.decisions, "决定")],
    ["未完成事项", compactStringList(object.openItems, "未完成事项")],
    ["工具与附件引用", compactStringList(object.references, "引用")],
  ];
  const summary = sections.filter(([, items]) => items.length).map(([label, items]) => `${label}：\n${items.map((item) => `- ${item}`).join("\n")}`).join("\n\n");
  if (!summary.trim()) throw new Error("模型返回的上下文摘要为空");
  return summary.slice(0, 8_000);
}

const summarySchema = {
  type: "object",
  properties: {
    goals: { type: "array", items: { type: "string" } },
    facts: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    openItems: { type: "array", items: { type: "string" } },
    references: { type: "array", items: { type: "string" } },
  },
  required: ["goals", "facts", "constraints", "decisions", "openItems", "references"],
  additionalProperties: false,
} as const;

/** 使用当前连接生成规范化摘要；厂商原始响应和隐藏状态不会进入持久化记录。 */
export async function requestConversationContextCompaction(input: {
  candidate: ConversationCompactionCandidate;
  connection: ApiConnectionProfile;
  conversation: AiConversation;
  modelId: string;
}): Promise<ConversationContextCompaction> {
  const previous = input.conversation.contextCompaction?.summary;
  const structuredOutput = input.connection.capabilities.includes("structured_output")
    ? { name: "conversation_context_compaction", schema: summarySchema, strict: true }
    : undefined;
  const result = await generateWithConnection(input.connection, "text", {
    modelId: input.modelId,
    maxOutputTokens: 1_500,
    structuredOutput,
    messages: [
      { role: "system", content: "将长对话压缩为可跨模型继续使用的事实摘要。不得添加对话中不存在的信息，不得包含隐藏推理、密钥或厂商私有状态。只输出符合 schema 的 JSON。" },
      { role: "user", content: `${previous ? `上一版摘要：\n${previous}\n\n` : ""}本次需要合并的旧对话：\n${input.candidate.sourceText}` },
    ],
    activity: { conversationId: input.conversation.id, module: "对话", purpose: "context-compaction", presentation: "compact-test" },
  });
  const summary = normalizeSummary(result.content);
  const estimatedTokensAfter = estimateChatMessagesTokens([{ role: "assistant", content: summary }]);
  if (estimatedTokensAfter >= input.candidate.estimatedTokensBefore * 0.9) throw new Error("本次压缩预计节省不足 10%，未更新上下文");
  return {
    version: 1,
    summary,
    throughMessageId: input.candidate.boundaryMessageId,
    sourceMessageCount: (input.conversation.contextCompaction?.sourceMessageCount ?? 0) + input.candidate.sourceMessageCount,
    compactedAt: new Date().toISOString(),
    connectionId: input.connection.id,
    modelId: input.modelId,
    estimatedTokensBefore: input.candidate.estimatedTokensBefore,
    estimatedTokensAfter,
  };
}
