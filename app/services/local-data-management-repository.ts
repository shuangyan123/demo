/**
 * 设置中的数据管理按业务域拆分删除范围；完整重置才删除整个 v16 数据库。
 */
import Dexie, { type Table } from "dexie";
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
export const LOCAL_DATA_IMPORT_MAX_BYTES = 100 * 1024 * 1024;

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

type TransferJob = {
  id: string;
  status: "prepared" | "applying";
  incoming: LocalDataExportV2;
  previous: LocalDataExportV2;
  createdAt: string;
};

class LocalDataTransferDatabase extends Dexie {
  jobs!: Table<TransferJob, string>;

  constructor() {
    super("review_workspace_transfer");
    this.version(1).stores({ jobs: "&id, status, createdAt" });
  }
}

const transferDb = new LocalDataTransferDatabase();

export type LocalDataRestorePreview = {
  payload: LocalDataExportV2;
  exportedAt: string;
  incomingRecords: number;
  replacingRecords: number;
  tableCounts: Array<{ table: string; incoming: number; replacing: number }>;
  reminders: string[];
};

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

/** 解析恢复包并执行默认拒绝校验；未知表、重复主键和悬空关联都会阻止替换。 */
export async function inspectLocalDataRestore(source: string): Promise<LocalDataRestorePreview> {
  if (new TextEncoder().encode(source).byteLength > LOCAL_DATA_IMPORT_MAX_BYTES) {
    throw new Error("备份文件超过 100MB 限制");
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("备份文件不是有效的 JSON");
  }
  const payload = validateRestorePayload(value);
  const tableCounts = await Promise.all([
    ...Object.entries(payload.databases.review_workspace).map(async ([table, records]) => ({
      table,
      incoming: records.length,
      replacing: await reviewDb.table(table).count(),
    })),
    {
      table: "extensions",
      incoming: payload.databases.review_extensions.extensions.length,
      replacing: await extensionDb.extensions.count(),
    },
  ]);
  return {
    payload,
    exportedAt: payload.exportedAt,
    incomingRecords: tableCounts.reduce((sum, item) => sum + item.incoming, 0),
    replacingRecords: tableCounts.reduce((sum, item) => sum + item.replacing, 0),
    tableCounts,
    reminders: ["AI、额度、MCP 与粉笔凭据需要重新输入", "Obsidian Vault 需要重新选择"],
  };
}

function validateRestorePayload(value: unknown): LocalDataExportV2 {
  if (!value || typeof value !== "object") throw new Error("备份包结构无效");
  const payload = value as Partial<LocalDataExportV2>;
  if (payload.schemaVersion !== 2) throw new Error(`不支持的备份版本：${String(payload.schemaVersion ?? "未知")}`);
  if (payload.credentialsExcluded !== true) throw new Error("备份包未声明凭据已排除");
  if (!payload.databases || typeof payload.databases !== "object") throw new Error("备份包缺少数据库内容");
  const core = payload.databases.review_workspace;
  const extensions = payload.databases.review_extensions?.extensions;
  if (!core || typeof core !== "object" || !Array.isArray(extensions)) throw new Error("备份包数据库结构无效");
  for (const [table, records] of Object.entries(core)) {
    if (!EXPORT_TABLE_ALLOWLIST.has(table)) throw new Error(`备份包含不允许导入的表：${table}`);
    if (!Array.isArray(records)) throw new Error(`表 ${table} 不是记录数组`);
    validateRecordKeys(table, records);
  }
  for (const table of EXPORT_TABLE_ALLOWLIST) {
    if (!Array.isArray(core[table])) throw new Error(`备份缺少必需表：${table}`);
  }
  validateRecordKeys("extensions", extensions);
  validateReferences(core);
  return payload as LocalDataExportV2;
}

function validateRecordKeys(table: string, records: unknown[]): void {
  const keys = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`表 ${table} 含无效记录`);
    const item = record as Record<string, unknown>;
    const key = typeof item.id === "string" ? item.id : table === "obsidianNoteMappings" && typeof item.path === "string" ? item.path : undefined;
    if (!key) throw new Error(`表 ${table} 含缺少唯一 ID 的记录`);
    if (keys.has(key)) throw new Error(`表 ${table} 含重复 ID：${key}`);
    keys.add(key);
  }
}

function validateReferences(core: Record<string, unknown[]>): void {
  const rules: Array<[string, string, string]> = [
    ["attempts", "mistakeId", "mistakes"],
    ["knowledgeAttempts", "knowledgeId", "knowledgeEntries"],
    ["knowledgeMistakeLinks", "mistakeId", "mistakes"],
    ["knowledgeMistakeLinks", "knowledgeId", "knowledgeEntries"],
    ["importDrafts", "batchId", "importBatches"],
    ["interviewTurns", "sessionId", "interviewSessions"],
    ["interviewEvaluations", "sessionId", "interviewSessions"],
    ["tutoringTurns", "sessionId", "tutoringSessions"],
    ["automationRuns", "automationId", "automationDefinitions"],
    ["aiConversationMessages", "conversationId", "aiConversations"],
    ["aiConversationAttachments", "conversationId", "aiConversations"],
    ["aiConversationRunSteps", "conversationId", "aiConversations"],
  ];
  for (const [childTable, field, parentTable] of rules) {
    const children = core[childTable] ?? [];
    const parents = new Set((core[parentTable] ?? []).map((item) => (item as Record<string, unknown>).id));
    for (const child of children) {
      const reference = (child as Record<string, unknown>)[field];
      if (typeof reference === "string" && !parents.has(reference)) {
        throw new Error(`表 ${childTable} 含悬空关联：${field}=${reference}`);
      }
    }
  }
}

async function exportPayload(): Promise<LocalDataExportV2> {
  return JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
}

async function replaceWithPayload(payload: LocalDataExportV2): Promise<void> {
  const coreEntries = Object.entries(payload.databases.review_workspace);
  const coreTables = coreEntries.map(([table]) => reviewDb.table(table));
  await reviewDb.transaction("rw", coreTables, async () => {
    for (const [tableName, records] of coreEntries) {
      const table = reviewDb.table(tableName);
      await table.clear();
      if (records.length) await table.bulkAdd(records);
    }
  });
  await extensionDb.transaction("rw", extensionDb.extensions, async () => {
    await extensionDb.extensions.clear();
    if (payload.databases.review_extensions.extensions.length) {
      await extensionDb.extensions.bulkAdd(payload.databases.review_extensions.extensions as never[]);
    }
  });
}

/** 先将恢复包和旧快照写入独立数据库；跨数据库提交失败时用旧快照回滚。 */
export async function restoreLocalData(preview: LocalDataRestorePreview): Promise<void> {
  const job: TransferJob = {
    id: crypto.randomUUID(),
    status: "prepared",
    incoming: preview.payload,
    previous: await exportPayload(),
    createdAt: new Date().toISOString(),
  };
  await transferDb.jobs.put(job);
  try {
    await transferDb.jobs.update(job.id, { status: "applying" });
    await replaceWithPayload(job.incoming);
    await transferDb.jobs.delete(job.id);
  } catch (error) {
    await replaceWithPayload(job.previous);
    await transferDb.jobs.delete(job.id);
    throw error;
  }
}

/** 应用启动或诊断页加载时恢复未完成事务，避免中断后留下半套数据。 */
export async function recoverInterruptedLocalDataRestore(): Promise<boolean> {
  const jobs = await transferDb.jobs.toArray();
  for (const job of jobs) {
    if (job.status === "applying") await replaceWithPayload(job.previous);
    await transferDb.jobs.delete(job.id);
  }
  return jobs.length > 0;
}

export const localDataManagementRepository = {
  loadSummary: loadLocalDataSummary,
  inspectRestore: inspectLocalDataRestore,
  restore: restoreLocalData,
  recoverInterruptedRestore: recoverInterruptedLocalDataRestore,

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
