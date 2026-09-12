import type { Transaction } from "dexie";
import type { AiConversation, AiConversationAttachment, AiConversationMessage, AiConversationRunStep } from "../types/domains/conversation.ts";
import { learningEventFromKnowledgeAttempt, learningEventFromReviewAttempt } from "../types/domains/learning-event.ts";
import type { KnowledgeAttempt } from "../types/domains/knowledge.ts";
import type { Attempt } from "../types/domains/review.ts";
import type { LearningEvent } from "../types/domains/learning-event.ts";

export const REVIEW_DB_NAME = "review_workspace";
export const REVIEW_DB_VERSION = 17;

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

/**
 * v17 为已有错题复盘和知识训练事实补建学习事件。
 * 事件主键由来源 Attempt 决定，重复执行只会覆盖同一事实，不会制造重复历史。
 */
export async function migrateToV17(transaction: Transaction) {
  const attempts = await transaction.table<Attempt, string>("attempts").toArray();
  const knowledgeAttempts = await transaction.table<KnowledgeAttempt, string>("knowledgeAttempts").toArray();
  const events: LearningEvent[] = [
    ...attempts.map(learningEventFromReviewAttempt),
    ...knowledgeAttempts.map(learningEventFromKnowledgeAttempt),
  ];
  if (events.length) await transaction.table<LearningEvent, string>("learningEvents").bulkPut(events);
}
