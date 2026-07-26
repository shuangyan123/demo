/** 厂商无关的可见会话轮次；不承载隐藏思维链或厂商私有状态。 */
export type CanonicalConversationTurn = {
  role: "user" | "assistant";
  content: string;
  attachmentSummaries?: string[];
  toolResults?: Array<{ name: string; summary: string; state: "done" | "error" }>;
  createdAt: string;
};
