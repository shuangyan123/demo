import type { Transaction } from "dexie";
import type { AiConversation, AiConversationAttachment, AiConversationMessage, AiConversationRunStep } from "../types/review";

export const REVIEW_DB_NAME = "review_workspace";
export const REVIEW_DB_VERSION = 16;

/**
 * v16 只清理历史版本错误持久化的空白“新对话”。
 * 查询与级联删除均位于同一升级事务内，重复执行不会产生额外副作用。
 */
export async function migrateToV16(transaction: Transaction) {
  const conversations = transaction.table<AiConversation, string>("aiConversations");
  const emptyLegacyDrafts = await conversations.filter((conversation) => conversation.title === "新对话" && conversation.messageCount === 0).toArray();
  const ids = emptyLegacyDrafts.map((conversation) => conversation.id);
  if (!ids.length) return;
  await transaction.table<AiConversationAttachment, string>("aiConversationAttachments").where("conversationId").anyOf(ids).delete();
  await transaction.table<AiConversationMessage, string>("aiConversationMessages").where("conversationId").anyOf(ids).delete();
  await transaction.table<AiConversationRunStep, string>("aiConversationRunSteps").where("conversationId").anyOf(ids).delete();
  await conversations.bulkDelete(ids);
}
