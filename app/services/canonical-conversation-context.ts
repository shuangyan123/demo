import type { AiConversation, AiConversationAttachment, AiConversationMessage, AiConversationRunStep } from "../types/domains/conversation.ts";
import type { CanonicalConversationTurn } from "../types/domains/ai-conversation-context.ts";

export type CanonicalConversationContextInput = {
  conversation?: Pick<AiConversation, "summary" | "contextCompaction">;
  messages: AiConversationMessage[];
  attachments?: AiConversationAttachment[];
  runSteps?: AiConversationRunStep[];
  maxCharacters?: number;
};

/** 将 IndexedDB 中的可见消息和必要工具结果归一为跨厂商事实源。 */
export function buildCanonicalConversationTurns(input: CanonicalConversationContextInput): CanonicalConversationTurn[] {
  const attachmentsByMessage = new Map<string, string[]>();
  for (const attachment of input.attachments ?? []) {
    if (!attachment.messageId || !attachment.summary.trim()) continue;
    attachmentsByMessage.set(attachment.messageId, [...(attachmentsByMessage.get(attachment.messageId) ?? []), attachment.summary.trim()]);
  }
  const toolsByTurn = new Map<string, CanonicalConversationTurn["toolResults"]>();
  for (const step of input.runSteps ?? []) {
    if (step.visibility !== "timeline" || !step.turnId || !step.text?.trim()) continue;
    const state = step.state === "error" ? "error" : step.state === "done" ? "done" : undefined;
    if (!state) continue;
    toolsByTurn.set(step.turnId, [...(toolsByTurn.get(step.turnId) ?? []), { name: step.label, summary: step.text.trim(), state }]);
  }

  const compaction = input.conversation?.contextCompaction;
  const boundaryIndex = compaction
    ? input.messages.findIndex((message) => message.id === compaction.throughMessageId)
    : -1;
  const visibleMessages = boundaryIndex >= 0 ? input.messages.slice(boundaryIndex + 1) : input.messages;
  const turns = visibleMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      attachmentSummaries: attachmentsByMessage.get(message.id),
      toolResults: message.role === "assistant" && message.turnId ? toolsByTurn.get(message.turnId) : undefined,
      createdAt: message.createdAt,
    }));

  const limit = Math.max(4_000, input.maxCharacters ?? 32_000);
  const size = turns.reduce((total, turn) => total + turn.content.length
    + (turn.attachmentSummaries?.join("").length ?? 0)
    + (turn.toolResults?.reduce((sum, tool) => sum + tool.summary.length, 0) ?? 0), 0);
  const compactedTurns: CanonicalConversationTurn[] = compaction && boundaryIndex >= 0
    ? [{ role: "assistant", content: `此前对话压缩摘要：\n${compaction.summary.trim()}`, createdAt: turns[0]?.createdAt ?? compaction.compactedAt }, ...turns]
    : turns;
  if (size <= limit) return compactedTurns;

  const recent = turns.slice(-24); // 最近 12 轮用户/助手消息。
  const summary = compaction?.summary.trim() || input.conversation?.summary?.trim();
  if (!summary) return recent;
  return [{ role: "assistant", content: `此前对话摘要：${summary}`, createdAt: recent[0]?.createdAt ?? new Date(0).toISOString() }, ...recent];
}

/** 映射为统一聊天请求，同时只附加摘要，不读取附件正文或厂商私有字段。 */
export function canonicalTurnsToChatHistory(turns: CanonicalConversationTurn[]) {
  return turns.map((turn) => {
    const extras = [
      ...(turn.attachmentSummaries?.map((summary) => `附件摘要：${summary}`) ?? []),
      ...(turn.toolResults?.map((tool) => `工具 ${tool.name}（${tool.state === "done" ? "完成" : "失败"}）：${tool.summary}`) ?? []),
    ];
    return { role: turn.role, content: extras.length ? `${turn.content}\n\n${extras.join("\n")}` : turn.content };
  });
}
