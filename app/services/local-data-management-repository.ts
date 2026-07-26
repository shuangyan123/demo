/**
 * 设置中的数据管理按业务域拆分删除范围；完整重置才删除整个 v16 数据库。
 */
import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import { deleteSecureKeyStore } from "./secure-key-store.ts";

export type LocalDataSummary = {
  importRecords: number;
  mistakeReviewRecords: number;
  conversationRecords: number;
  extensionRecords: number;
  totalIndexedDbRecords: number;
};

export type LocalDataExportV2 = {
  schemaVersion: 2;
  exportedAt: string;
  credentialsExcluded: true;
  databases: {
    review_workspace: Record<string, unknown[]>;
    review_extensions: { extensions: unknown[] };
  };
};

// 安全导出采用默认拒绝：只有这里逐项审阅过的业务表可以进入版本化导出包。
const EXPORT_TABLE_ALLOWLIST = new Set([
  "mistakes",
  "attempts",
  "importJobs",
  "apiConnectionProfiles",
  "apiConnectionDefaults",
  "appearanceSettings",
  "personalizationSettings",
  "knowledgeEntries",
  "knowledgeAttempts",
  "knowledgeMistakeLinks",
  "knowledgeInternalizationDrafts",
  "importBatches",
  "importDrafts",
  "interviewQuestions",
  "interviewQuestionSets",
  "interviewPracticePlans",
  "interviewSessions",
  "interviewTurns",
  "interviewEvaluations",
  "interviewLinks",
  "tutoringSessions",
  "tutoringTurns",
  "tutoringPlans",
  "tutoringLinks",
  "obsidianNoteMappings",
  "knowledgeEvolutionProposals",
  "automationDefinitions",
  "automationRuns",
  "aiProjects",
  "aiConversationFolders",
  "aiConversations",
  "aiConversationAttachments",
  "aiConversationMessages",
  "aiConversationRunSteps",
]);

/** 导出值只保留可序列化且非敏感字段，新增表不会绕过统一清理边界。 */
function sanitizeExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const isConnectionMetadata = "provider" in source
    && "baseUrl" in source
    && ("encryptedKey" in source || "maskedKey" in source);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (/^(encryptedKey|iv|encryptedToken|encryptedTokenIv|encryptedCookie|encryptedCredentials|maskedKey|directoryHandle)$/i.test(key)) continue;
    if (/^(apiKey|token|cookie|authorization|providerRawResponse)$/i.test(key)) continue;
    result[key] = sanitizeExportValue(item);
  }
  if (isConnectionMetadata) result.credentialStatus = "reconfigure_required";
  return result;
}

/** 读取危险操作前的真实数量，界面不使用估算值。 */
export async function loadLocalDataSummary(): Promise<LocalDataSummary> {
  const [importJobs, importBatches, importDrafts, mistakes, attempts, conversations, messages, attachments, runSteps, folders, tableCounts, extensionRecords] = await Promise.all([
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
    extensionDb.extensions.count(),
  ]);
  return {
    importRecords: importJobs + importBatches + importDrafts,
    mistakeReviewRecords: mistakes + attempts,
    conversationRecords: conversations + messages + attachments + runSteps + folders,
    extensionRecords,
    totalIndexedDbRecords: tableCounts.reduce((total, count) => total + count, 0) + extensionRecords,
  };
}

export const localDataManagementRepository = {
  loadSummary: loadLocalDataSummary,

  /** 安全导出使用显式版本和字段清理，凭据与目录句柄永不进入导出包。 */
  async exportAll(): Promise<string> {
    const coreEntries = await Promise.all(
      reviewDb.tables
        .filter((table) => EXPORT_TABLE_ALLOWLIST.has(table.name))
        .map(async (table) => [table.name, sanitizeExportValue(await table.toArray())] as const),
    );
    const payload: LocalDataExportV2 = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      credentialsExcluded: true,
      databases: {
        review_workspace: Object.fromEntries(coreEntries) as Record<string, unknown[]>,
        review_extensions: { extensions: sanitizeExportValue(await extensionDb.extensions.toArray()) as unknown[] },
      },
    };
    return JSON.stringify(payload, null, 2);
  },

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

  /** 完整重置删除业务库、扩展库、安全密钥库和本应用 localStorage。 */
  async resetAll(): Promise<void> {
    reviewDb.close();
    extensionDb.close();
    await Promise.all([reviewDb.delete(), extensionDb.delete(), deleteSecureKeyStore()]);
    if (typeof window !== "undefined") {
      const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => Boolean(key));
      for (const key of keys) {
        if (/^review(?:[-_:]|$)/.test(key)) window.localStorage.removeItem(key);
      }
    }
  },
};
