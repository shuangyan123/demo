/**
 * 设置中的数据管理按业务域拆分删除范围；完整重置才删除整个 v16 数据库。
 */
import Dexie, { type Table } from "dexie";
import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import {
  CORE_BACKUP_TABLE_NAMES,
  CORE_DATA_STORE_POLICIES,
  LOCAL_DATA_IMPORT_MAX_RECORDS,
  LOCAL_DATA_IMPORT_MAX_STORE_RECORDS,
  createLocalDataExportManifest,
  findSensitiveRestoreFields,
  inspectLocalDataIntegrity,
  type LocalDataExportManifestV2,
} from "./local-data-reliability.ts";
import { deleteSecureKeyStore, readSecurePrimaryKey } from "./secure-key-store.ts";

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
  manifest: LocalDataExportManifestV2;
  databases: {
    review_workspace: Record<string, unknown[]>;
    review_extensions: { extensions: unknown[] };
  };
};

// 安全导出采用默认拒绝：只有这里逐项审阅过的业务表可以进入版本化导出包。
export const LOCAL_DATA_IMPORT_MAX_BYTES = 100 * 1024 * 1024;

const EXPORT_TABLE_ALLOWLIST = new Set(CORE_BACKUP_TABLE_NAMES);

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

export type LocalDataHealthIssue = {
  code: "credential-key-unavailable" | "critical-integrity" | "restore-interrupted" | "store-classification-mismatch";
  message: string;
  scope: string;
};

export type LocalDataHealthReport = {
  checkedAt: string;
  errors: LocalDataHealthIssue[];
  healthy: boolean;
  manualActions: string[];
  repairable: [];
  warnings: LocalDataHealthIssue[];
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
  assertImportSize(source);
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

function assertImportSize(source: string): void {
  if (new TextEncoder().encode(source).byteLength > LOCAL_DATA_IMPORT_MAX_BYTES) throw new Error("备份文件超过 100MB 限制");
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function validateManifest(manifest: unknown, expected: LocalDataExportManifestV2): void {
  if (!manifest || typeof manifest !== "object") throw new Error("备份清单结构无效");
  const candidate = manifest as Partial<LocalDataExportManifestV2>;
  if (candidate.app?.name !== "review-workspace" || typeof candidate.app.version !== "string" || !candidate.app.version) throw new Error("备份清单缺少应用元数据");
  if (candidate.schemaVersions?.review_workspace !== expected.schemaVersions.review_workspace
    || candidate.schemaVersions?.review_extensions !== expected.schemaVersions.review_extensions) throw new Error("备份清单 schema 版本不受支持");
  if (!candidate.includedStores
    || !Array.isArray(candidate.includedStores.review_workspace)
    || !Array.isArray(candidate.includedStores.review_extensions)
    || !sameStringSet(candidate.includedStores.review_workspace, expected.includedStores.review_workspace)
    || !sameStringSet(candidate.includedStores.review_extensions, expected.includedStores.review_extensions)) throw new Error("备份清单与允许表不一致");
  if (!candidate.recordCounts
    || candidate.recordCounts.total !== expected.recordCounts.total
    || candidate.recordCounts.review_extensions?.extensions !== expected.recordCounts.review_extensions.extensions) throw new Error("备份清单记录数与实际内容不一致");
  const counts = candidate.recordCounts.review_workspace;
  if (!counts || !sameStringSet(Object.keys(counts), Object.keys(expected.recordCounts.review_workspace))) throw new Error("备份清单记录数与实际表不一致");
  for (const [table, count] of Object.entries(expected.recordCounts.review_workspace)) {
    if (counts[table] !== count) throw new Error(`备份清单中 ${table} 的记录数不一致`);
  }
  if (!Array.isArray(candidate.excludedCategories)
    || !sameStringSet(candidate.excludedCategories, expected.excludedCategories)) throw new Error("备份清单排除类别不完整");
}

function validateRestorePayload(value: unknown): LocalDataExportV2 {
  if (!value || typeof value !== "object") throw new Error("备份包结构无效");
  const payload = value as Partial<LocalDataExportV2>;
  if (payload.schemaVersion !== 2) throw new Error(`不支持的备份版本：${String(payload.schemaVersion ?? "未知")}`);
  if (payload.credentialsExcluded !== true) throw new Error("备份包未声明凭据已排除");
  if (typeof payload.exportedAt !== "string" || Number.isNaN(new Date(payload.exportedAt).getTime())) throw new Error("备份包创建时间无效");
  if (!payload.databases || typeof payload.databases !== "object") throw new Error("备份包缺少数据库内容");
  if (!sameStringSet(Object.keys(payload.databases), ["review_workspace", "review_extensions"])) throw new Error("备份包包含未知数据库");
  const core = payload.databases.review_workspace;
  const extensionDatabase = payload.databases.review_extensions;
  const extensions = extensionDatabase?.extensions;
  if (!core || typeof core !== "object" || !Array.isArray(extensions)) throw new Error("备份包数据库结构无效");
  if (!sameStringSet(Object.keys(extensionDatabase), ["extensions"])) throw new Error("备份包含不允许导入的扩展表");
  let totalRecords = extensions.length;
  for (const [table, records] of Object.entries(core)) {
    if (!EXPORT_TABLE_ALLOWLIST.has(table)) throw new Error(`备份包含不允许导入的表：${table}`);
    if (!Array.isArray(records)) throw new Error(`表 ${table} 不是记录数组`);
    if (records.length > LOCAL_DATA_IMPORT_MAX_STORE_RECORDS) throw new Error(`表 ${table} 超过 ${LOCAL_DATA_IMPORT_MAX_STORE_RECORDS} 条记录限制`);
    totalRecords += records.length;
  }
  if (extensions.length > LOCAL_DATA_IMPORT_MAX_STORE_RECORDS) throw new Error(`表 extensions 超过 ${LOCAL_DATA_IMPORT_MAX_STORE_RECORDS} 条记录限制`);
  if (totalRecords > LOCAL_DATA_IMPORT_MAX_RECORDS) throw new Error(`备份包超过 ${LOCAL_DATA_IMPORT_MAX_RECORDS} 条记录限制`);
  for (const table of EXPORT_TABLE_ALLOWLIST) {
    if (!Array.isArray(core[table])) throw new Error(`备份缺少必需表：${table}`);
  }
  const sensitiveFields = findSensitiveRestoreFields(payload.databases);
  if (sensitiveFields.length) throw new Error(`备份包含安全敏感字段：${sensitiveFields[0]}`);
  const integrityIssue = [
    ...inspectLocalDataIntegrity(core),
    ...inspectLocalDataIntegrity({ extensions }),
  ][0];
  if (integrityIssue) throw new Error(integrityIssue.message);
  const expectedManifest = createLocalDataExportManifest(core, extensions.length);
  // 2026-07 发布的早期 V2 没有 manifest；继续兼容读取，并为后续事务补齐规范化清单。
  if (payload.manifest !== undefined) validateManifest(payload.manifest, expectedManifest);
  return { ...(payload as Omit<LocalDataExportV2, "manifest">), manifest: expectedManifest };
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

async function readBackupDatabases(): Promise<LocalDataExportV2["databases"]> {
  const coreEntries = await Promise.all(
    reviewDb.tables
      .filter((table) => EXPORT_TABLE_ALLOWLIST.has(table.name))
      .map(async (table) => [table.name, sanitizeExportValue(await table.toArray())] as const),
  );
  return {
    review_workspace: Object.fromEntries(coreEntries) as Record<string, unknown[]>,
    review_extensions: { extensions: sanitizeExportValue(await extensionDb.extensions.toArray()) as unknown[] },
  };
}

/** 跨库 apply 后以记录数和关键引用复核真实落盘状态，验证成功才提交清理。 */
async function verifyAppliedPayload(payload: LocalDataExportV2): Promise<void> {
  const actual = await readBackupDatabases();
  const actualManifest = createLocalDataExportManifest(actual.review_workspace, actual.review_extensions.extensions.length);
  validateManifest(payload.manifest, actualManifest);
  const integrityIssue = inspectLocalDataIntegrity(actual.review_workspace)[0];
  if (integrityIssue) throw new Error(`恢复后验证失败：${integrityIssue.message}`);
}

/** 先将恢复包和旧快照写入独立数据库；跨数据库提交失败时用旧快照回滚。 */
export async function restoreLocalData(preview: LocalDataRestorePreview): Promise<void> {
  const serialized = JSON.stringify(preview.payload);
  assertImportSize(serialized);
  // Preview 是 UI 便利对象而不是安全边界；破坏性修改前必须对当前 payload 再做完整 preflight。
  const incoming = validateRestorePayload(JSON.parse(serialized));
  const job: TransferJob = {
    id: crypto.randomUUID(),
    status: "prepared",
    incoming,
    previous: await exportPayload(),
    createdAt: new Date().toISOString(),
  };
  await transferDb.jobs.put(job);
  try {
    await transferDb.jobs.update(job.id, { status: "applying" });
    await replaceWithPayload(job.incoming);
    await verifyAppliedPayload(job.incoming);
    await transferDb.jobs.delete(job.id);
  } catch (error) {
    try {
      await replaceWithPayload(job.previous);
      await verifyAppliedPayload(job.previous);
      await transferDb.jobs.delete(job.id);
    } catch (rollbackError) {
      // 保留 applying job，下一次启动仍能识别并继续回滚，不能把失败伪装成已清理。
      throw new AggregateError([error, rollbackError], "恢复失败且旧数据尚未完成回滚");
    }
    throw error;
  }
}

/** 应用启动或诊断页加载时恢复未完成事务，避免中断后留下半套数据。 */
export async function recoverInterruptedLocalDataRestore(): Promise<boolean> {
  const jobs = await transferDb.jobs.toArray();
  for (const job of jobs) {
    if (job.status === "applying") {
      await replaceWithPayload(job.previous);
      await verifyAppliedPayload(job.previous);
    }
    await transferDb.jobs.delete(job.id);
  }
  return jobs.length > 0;
}

function containsEncryptedCredentialMaterial(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsEncryptedCredentialMaterial);
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => /^(?:encryptedCookie|encryptedCredentials|encryptedKey|encryptedToken)$/i.test(key) || containsEncryptedCredentialMaterial(item));
}

/** 只读检查本地 schema、关键引用、未完成恢复和主密钥可用性，不自动修改业务数据。 */
export async function inspectLocalDataHealth(): Promise<LocalDataHealthReport> {
  const errors: LocalDataHealthIssue[] = [];
  const warnings: LocalDataHealthIssue[] = [];
  const manualActions = new Set<string>();
  const actualStores = reviewDb.tables.map((table) => table.name);
  const classifiedStores = Object.keys(CORE_DATA_STORE_POLICIES);
  if (!sameStringSet(actualStores, classifiedStores)) {
    errors.push({ code: "store-classification-mismatch", message: "本地数据库表与备份分类清单不一致；已停止自动判断备份覆盖范围。", scope: "review_workspace" });
    manualActions.add("升级应用或联系维护者确认新增表的备份分类");
  }

  const allCore = Object.fromEntries(await Promise.all(reviewDb.tables.map(async (table) => [table.name, await table.toArray()] as const))) as Record<string, unknown[]>;
  for (const issue of inspectLocalDataIntegrity(allCore).slice(0, 50)) {
    errors.push({ code: "critical-integrity", message: issue.message, scope: issue.table });
    manualActions.add("先导出当前备份，再从已验证备份恢复或联系维护者");
  }

  const transferJobs = await transferDb.jobs.toArray();
  if (transferJobs.length) {
    errors.push({ code: "restore-interrupted", message: `检测到 ${transferJobs.length} 个未完成恢复事务；重新打开应用会尝试回滚旧快照。`, scope: "review_workspace_transfer" });
    manualActions.add("重新打开应用完成安全回滚；不要手工删除恢复事务库");
  }

  const credentialRecords = [allCore.apiSettings ?? [], allCore.apiConnectionProfiles ?? []];
  let hasEncryptedCredentials = credentialRecords.some(containsEncryptedCredentialMaterial);
  if (typeof window !== "undefined") {
    for (let index = 0; index < window.localStorage.length && !hasEncryptedCredentials; index += 1) {
      const key = window.localStorage.key(index);
      const value = key ? window.localStorage.getItem(key) : null;
      if (value && /"(?:encryptedCookie|encryptedCredentials|encryptedKey|encryptedToken)"\s*:/.test(value)) hasEncryptedCredentials = true;
    }
  }
  if (hasEncryptedCredentials) {
    try {
      if (!await readSecurePrimaryKey()) {
        errors.push({ code: "credential-key-unavailable", message: "检测到已加密凭据，但本机主密钥不可用；诊断未读取或输出凭据内容。", scope: "review_workspace_secure_keys" });
        manualActions.add("重新输入受影响的凭据");
      }
    } catch {
      errors.push({ code: "credential-key-unavailable", message: "本机主密钥库无法安全读取；诊断未读取或输出凭据内容。", scope: "review_workspace_secure_keys" });
      manualActions.add("重新输入受影响的凭据；若仍失败，先备份业务数据再完整重置");
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    errors,
    healthy: errors.length === 0,
    manualActions: [...manualActions],
    repairable: [],
    warnings,
  };
}

export const localDataManagementRepository = {
  loadSummary: loadLocalDataSummary,
  inspectRestore: inspectLocalDataRestore,
  restore: restoreLocalData,
  recoverInterruptedRestore: recoverInterruptedLocalDataRestore,
  inspectHealth: inspectLocalDataHealth,

  /** 安全导出使用显式版本和字段清理，凭据与目录句柄永不进入导出包。 */
  async exportAll(): Promise<string> {
    const databases = await readBackupDatabases();
    const payload: LocalDataExportV2 = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      credentialsExcluded: true,
      manifest: createLocalDataExportManifest(databases.review_workspace, databases.review_extensions.extensions.length),
      databases,
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
