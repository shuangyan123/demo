/**
 * 设置中的数据管理按业务域拆分删除范围；完整重置才删除整个 v16 数据库。
 */
import { reviewDb } from "../db/review-db.ts";

export type LocalDataSummary = {
  importRecords: number;
  mistakeReviewRecords: number;
  conversationRecords: number;
  totalIndexedDbRecords: number;
};

/** 读取危险操作前的真实数量，界面不使用估算值。 */
export async function loadLocalDataSummary(): Promise<LocalDataSummary> {
  const [importJobs, importBatches, importDrafts, mistakes, attempts, conversations, messages, attachments, runSteps, folders, tableCounts] = await Promise.all([
    reviewDb.importJobs.count(),
    reviewDb.importBatches.count(),
    reviewDb.importDrafts.count(),
    reviewDb.mistakes.count(),
    reviewDb.attempts.count(),
    reviewDb.aiConversations.count(),
    reviewDb.aiConversationMessages.count(),
    reviewDb.aiConversationAttachments.count(),
    reviewDb.aiConversationRunSteps.count(),
    reviewDb.aiConversationFolders.count(),
    Promise.all(reviewDb.tables.map((table) => table.count())),
  ]);
  return {
    importRecords: importJobs + importBatches + importDrafts,
    mistakeReviewRecords: mistakes + attempts,
    conversationRecords: conversations + messages + attachments + runSteps + folders,
    totalIndexedDbRecords: tableCounts.reduce((total, count) => total + count, 0),
  };
}

export const localDataManagementRepository = {
  loadSummary: loadLocalDataSummary,

  /** 只清理导入任务、批次与未确认草稿。 */
  async clearImports(): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.importJobs, reviewDb.importBatches, reviewDb.importDrafts], async () => {
      await Promise.all([reviewDb.importJobs.clear(), reviewDb.importBatches.clear(), reviewDb.importDrafts.clear()]);
    });
  },

  /** 清理错题、复盘和指向错题的关联，不删除知识资料或训练记录主体。 */
  async clearMistakeReviews(): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.mistakes, reviewDb.attempts, reviewDb.knowledgeMistakeLinks, reviewDb.interviewLinks, reviewDb.tutoringLinks], async () => {
      await Promise.all([
        reviewDb.mistakes.clear(),
        reviewDb.attempts.clear(),
        reviewDb.knowledgeMistakeLinks.clear(),
        reviewDb.interviewLinks.where("targetType").equals("mistake").delete(),
        reviewDb.tutoringLinks.where("targetType").equals("mistake").delete(),
      ]);
    });
  },

  /** 清理会话、消息、附件摘要、工具步骤和空文件夹，保留项目与连接。 */
  async clearConversations(): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.aiConversationFolders, reviewDb.aiConversations, reviewDb.aiConversationMessages, reviewDb.aiConversationAttachments, reviewDb.aiConversationRunSteps], async () => {
      await Promise.all([
        reviewDb.aiConversationFolders.clear(),
        reviewDb.aiConversations.clear(),
        reviewDb.aiConversationMessages.clear(),
        reviewDb.aiConversationAttachments.clear(),
        reviewDb.aiConversationRunSteps.clear(),
      ]);
    });
  },

  /** 完整重置删除 IndexedDB 和本应用 localStorage；调用方完成后刷新页面。 */
  async resetAll(): Promise<void> {
    reviewDb.close();
    await reviewDb.delete();
    if (typeof window !== "undefined") {
      const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => Boolean(key));
      for (const key of keys) {
        if (/^(review-workspace:|review_workspace_|review_provider_models_)/.test(key)) window.localStorage.removeItem(key);
      }
    }
  },
};
