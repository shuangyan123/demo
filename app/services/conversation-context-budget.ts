import type { ChatMessage, ChatMessageContent } from "./api-client.ts";

export type ConversationContextBudget = {
  usedTokens: number;
  outputReserveTokens: number;
  contextWindow?: number;
  remainingTokens?: number;
  remainingPercent?: number;
  precision: "estimated" | "usage-calibrated";
};

/** 未来自动压缩的 UI/policy 契约；当前只提供告警语义，不触发后台行为。 */
export const conversationContextUsagePolicy = Object.freeze({
  warningPercent: 72,
  autoCompactionPercent: 84,
  autoCompactionEnabled: false,
});

function estimateTextTokens(value: string): number {
  let units = 0;
  for (const character of value) units += character.codePointAt(0)! <= 0x7f ? 0.25 : 1;
  return Math.ceil(units);
}

/** 以保守规则估算跨厂商文本和多模态输入，不会把未发送草稿上传到外部计数接口。 */
export function estimateChatContentTokens(content: ChatMessageContent): number {
  if (typeof content === "string") return estimateTextTokens(content);
  return content.reduce((total, item) => {
    if (item.type === "text") return total + estimateTextTokens(item.text);
    return total + 256;
  }, 0);
}

export function estimateChatMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + 4 + estimateChatContentTokens(message.content), 2);
}

export function buildConversationContextBudget(input: {
  messages: ChatMessage[];
  contextWindow?: number;
  outputReserveTokens?: number;
  calibratedInputTokens?: number;
}): ConversationContextBudget {
  const outputReserveTokens = Math.max(0, input.outputReserveTokens ?? 1_200);
  const estimated = estimateChatMessagesTokens(input.messages);
  const usedTokens = Math.max(estimated, input.calibratedInputTokens ?? 0);
  if (!input.contextWindow) return {
    usedTokens,
    outputReserveTokens,
    precision: input.calibratedInputTokens ? "usage-calibrated" : "estimated",
  };
  const remainingTokens = Math.max(0, input.contextWindow - usedTokens - outputReserveTokens);
  return {
    usedTokens,
    outputReserveTokens,
    contextWindow: input.contextWindow,
    remainingTokens,
    remainingPercent: Math.max(0, Math.min(100, Math.round((remainingTokens / input.contextWindow) * 100))),
    precision: input.calibratedInputTokens ? "usage-calibrated" : "estimated",
  };
}

export function formatContextTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
