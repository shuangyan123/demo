/**
 * 设置中的数据管理按业务域拆分删除范围；完整重置才删除整个 v17 数据库。
 */
import Dexie, { type Table } from "dexie";
import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import {
  CORE_BACKUP_TABLE_NAMES,
  CORE_DATA_STORE_POLICIES,
  LOCAL_DATA_IMPORT_MAX_RECORDS,
  LOCAL_DATA_IMPORT_MAX_STORE_RECORDS,
  LOCAL_DATA_SCHEMA_VERSIONS,
  PREVIOUS_REVIEW_WORKSPACE_SCHEMA_VERSION,
  createLocalDataExportManifest,
  findSensitiveRestoreFields,
  inspectLocalDataIntegrity,
  type LocalDataReviewWorkspaceSchemaVersion,
  type LocalDataExportManifestV2,
} from "./local-data-reliability.ts";
import { deleteSecureKeyStore, readSecurePrimaryKey } from "./secure-key-store.ts";
import { learningEventFromKnowledgeAttempt, learningEventFromReviewAttempt } from "../types/domains/learning-event.ts";
import type { KnowledgeAttempt } from "../types/domains/knowledge.ts";
import type { Attempt } from "../types/domains/review.ts";

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
const CURRENT_REVIEW_WORKSPACE_SCHEMA_VERSION = LOCAL_DATA_SCHEMA_VERSIONS.review_workspace;
const SUPPORTED_REVIEW_WORKSPACE_SCHEMA_VERSIONS = new Set<LocalDataReviewWorkspaceSchemaVersion>([
  PREVIOUS_REVIEW_WORKSPACE_SCHEMA_VERSION,
  CURRENT_REVIEW_WORKSPACE_SCHEMA_VERSION,
]);
const LEGACY_CORE_BACKUP_TABLE_NAMES = CORE_BACKUP_TABLE_NAMES.filter((table) => table !== "learningEvents");

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
  code: "credential-key-unavailable" | "critical-integrity" | "restore-interrupted" | "store-classification-mismatch" | "vault-mapping-issue" | "vault-unavailable";
  manualAction?: string;
  message: string;
  recordId?: string;
  repairability: LocalDataRepairability;
  scope: string;
};

export type LocalDataRepairability = "manual-only" | "not-repairable" | "targeted-safe";
export type LocalDataRepairId = "delete-orphan-conversation-run-steps";

export type LocalDataRepairCandidate = {
  action: string;
  affectedRecords: number;
  id: LocalDataRepairId;
  issueCode: LocalDataHealthIssue["code"];
  scope: string;
};

export type LocalDataHealthReport = {
  checkedAt: string;
  errors: LocalDataHealthIssue[];
  healthy: boolean;
  manualActions: string[];
  repairable: LocalDataRepairCandidate[];
  warnings: LocalDataHealthIssue[];
};

export type LocalDataRepairPreview = {
  action: string;
  affectedRecordIds: string[];
  affectedRecords: number;
  dataLossRisk: "low";
  issueCode: "critical-integrity";
  recoverySnapshotRequired: true;
  repairId: LocalDataRepairId;
  scope: "aiConversationRunSteps";
  targetRecordsRecoverableFromSnapshot: false;
  verificationPlan: string;
};

export type LocalDataRepairBackup = {
  affectedRecordIds: string[];
  createdAt: string;
  repairId: LocalDataRepairId;
  snapshotKind: "recovery-safe";
  source: string;
  targetRecordsRecoverable: false;
};

export type LocalDataRepairConfirmation = {
  recoverySnapshotSaved: boolean;
  targetRecordsNotRecoverableAcknowledged: boolean;
};

export type LocalDataRepairResult = {
  affectedRecords: number;
  repairId: LocalDataRepairId;
  verified: true;
};

export type InterruptedRestoreRecoveryResult = {
  applyingRolledBack: number;
  message?: string;
  preparedDiscarded: number;
  status: "none" | "recovered";
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
    if (/^(conflictAppMarkdown|conflictVaultMarkdown|encryptedKey|iv|encryptedToken|encryptedTokenIv|encryptedCookie|encryptedCredentials|maskedKey|directoryHandle)$/i.test(key)) continue;
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

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function detectReviewWorkspaceSchemaVersion(manifest: unknown, core: Record<string, unknown[]>): LocalDataReviewWorkspaceSchemaVersion {
  if (manifest === undefined) {
    return Object.prototype.hasOwnProperty.call(core, "learningEvents")
      ? CURRENT_REVIEW_WORKSPACE_SCHEMA_VERSION
      : PREVIOUS_REVIEW_WORKSPACE_SCHEMA_VERSION;
  }
  if (!manifest || typeof manifest !== "object") throw new Error("备份清单结构无效");
  const schemaVersions = (manifest as { schemaVersions?: unknown }).schemaVersions;
  const reviewWorkspaceSchemaVersion = schemaVersions && typeof schemaVersions === "object"
    ? (schemaVersions as { review_workspace?: unknown }).review_workspace
    : undefined;
  if (typeof reviewWorkspaceSchemaVersion !== "number"
    || !SUPPORTED_REVIEW_WORKSPACE_SCHEMA_VERSIONS.has(reviewWorkspaceSchemaVersion as LocalDataReviewWorkspaceSchemaVersion)) {
    throw new Error("备份清单 schema 版本不受支持");
  }
  return reviewWorkspaceSchemaVersion as LocalDataReviewWorkspaceSchemaVersion;
}

function validateRestoreStoreShape(
  core: Record<string, unknown[]>,
  extensions: unknown[],
  allowedTableNames: readonly string[],
): void {
  const allowedTables = new Set(allowedTableNames);
  let totalRecords = extensions.length;
  for (const [table, records] of Object.entries(core)) {
    if (!allowedTables.has(table)) throw new Error(`备份包含不允许导入的表：${table}`);
    if (!Array.isArray(records)) throw new Error(`表 ${table} 不是记录数组`);
    if (records.length > LOCAL_DATA_IMPORT_MAX_STORE_RECORDS) throw new Error(`表 ${table} 超过 ${LOCAL_DATA_IMPORT_MAX_STORE_RECORDS} 条记录限制`);
    totalRecords += records.length;
  }
  if (extensions.length > LOCAL_DATA_IMPORT_MAX_STORE_RECORDS) throw new Error(`表 extensions 超过 ${LOCAL_DATA_IMPORT_MAX_STORE_RECORDS} 条记录限制`);
  if (totalRecords > LOCAL_DATA_IMPORT_MAX_RECORDS) throw new Error(`备份包超过 ${LOCAL_DATA_IMPORT_MAX_RECORDS} 条记录限制`);
  for (const table of allowedTableNames) {
    if (!Array.isArray(core[table])) throw new Error(`备份缺少必需表：${table}`);
  }
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
  const reviewWorkspaceSchemaVersion = detectReviewWorkspaceSchemaVersion(payload.manifest, core);
  validateRestoreStoreShape(core, extensions, reviewWorkspaceSchemaVersion === PREVIOUS_REVIEW_WORKSPACE_SCHEMA_VERSION
    ? LEGACY_CORE_BACKUP_TABLE_NAMES
    : CORE_BACKUP_TABLE_NAMES);
  const sensitiveFields = findSensitiveRestoreFields(payload.databases);
  if (sensitiveFields.length) throw new Error(`备份包含安全敏感字段：${sensitiveFields[0]}`);
  const integrityIssue = [
    ...inspectLocalDataIntegrity(core),
    ...inspectLocalDataIntegrity({ extensions }),
  ][0];
  if (integrityIssue) throw new Error(integrityIssue.message);
  const expectedInputManifest = createLocalDataExportManifest(core, extensions.length, reviewWorkspaceSchemaVersion);
  // 2026-07 发布的早期 V2 没有 manifest；继续兼容读取。v16 有清单时仍按历史表集合严格校验。
  if (payload.manifest !== undefined) validateManifest(payload.manifest, expectedInputManifest);

  const normalizedCore = reviewWorkspaceSchemaVersion === PREVIOUS_REVIEW_WORKSPACE_SCHEMA_VERSION
    ? {
      ...core,
      learningEvents: [
        ...(core.attempts as Attempt[]).map(learningEventFromReviewAttempt),
        ...(core.knowledgeAttempts as KnowledgeAttempt[]).map(learningEventFromKnowledgeAttempt),
      ],
    }
    : core;
  if (reviewWorkspaceSchemaVersion === PREVIOUS_REVIEW_WORKSPACE_SCHEMA_VERSION) {
    validateRestoreStoreShape(normalizedCore, extensions, CORE_BACKUP_TABLE_NAMES);
  }
  const normalizedIntegrityIssue = [
    ...inspectLocalDataIntegrity(normalizedCore),
    ...inspectLocalDataIntegrity({ extensions }),
  ][0];
  if (normalizedIntegrityIssue) throw new Error(normalizedIntegrityIssue.message);
  const normalizedManifest = createLocalDataExportManifest(
    normalizedCore,
    extensions.length,
    CURRENT_REVIEW_WORKSPACE_SCHEMA_VERSION,
  );
  return {
    ...(payload as Omit<LocalDataExportV2, "manifest">),
    manifest: normalizedManifest,
    databases: {
      review_workspace: normalizedCore,
      review_extensions: { extensions },
    },
  };
}

async function exportPayload(): Promise<LocalDataExportV2> {
  const databases = await readBackupDatabases();
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    credentialsExcluded: true,
    manifest: createLocalDataExportManifest(databases.review_workspace, databases.review_extensions.extensions.length),
    databases,
  };
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

async function readAllCoreData(): Promise<Record<string, unknown[]>> {
  return Object.fromEntries(
    await Promise.all(reviewDb.tables.map(async (table) => [table.name, await table.toArray()] as const)),
  ) as Record<string, unknown[]>;
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

function targetedRepairPreview(core: Record<string, unknown[]>): LocalDataRepairPreview | undefined {
  const affectedRecordIds = inspectLocalDataIntegrity(core)
    .filter((issue) => issue.code === "dangling-reference" && issue.table === "aiConversationRunSteps" && issue.recordId)
    .map((issue) => issue.recordId as string)
    .sort();
  if (!affectedRecordIds.length) return undefined;
  return {
    action: "删除没有父对话的脱敏工具与诊断运行步骤；不会删除对话、消息、附件或学习记录。",
    affectedRecordIds,
    affectedRecords: affectedRecordIds.length,
    dataLossRisk: "low",
    issueCode: "critical-integrity",
    recoverySnapshotRequired: true,
    repairId: "delete-orphan-conversation-run-steps",
    scope: "aiConversationRunSteps",
    targetRecordsRecoverableFromSnapshot: false,
    verificationPlan: "在同一 Dexie transaction 内重新检查父对话、删除精确记录 ID，并确认目标悬空问题消失且未引入新的完整性问题。",
  };
}

function assertSameRepairPreview(expected: LocalDataRepairPreview, candidate: LocalDataRepairPreview): void {
  if (candidate.repairId !== expected.repairId
    || candidate.scope !== expected.scope
    || !sameStringSet(candidate.affectedRecordIds, expected.affectedRecordIds)) {
    throw new Error("修复预览已过期，请重新检查数据健康后再继续");
  }
}

export async function inspectLocalDataRepair(repairId: LocalDataRepairId): Promise<LocalDataRepairPreview> {
  if (repairId !== "delete-orphan-conversation-run-steps") throw new Error("不支持的数据修复类型");
  const preview = targetedRepairPreview(await readAllCoreData());
  if (!preview) throw new Error("目标问题已不存在，请重新检查数据健康");
  return preview;
}

async function buildRepairSafetyPayload(preview: LocalDataRepairPreview): Promise<LocalDataExportV2> {
  const payload = await exportPayload();
  const affected = new Set(preview.affectedRecordIds);
  payload.databases.review_workspace.aiConversationRunSteps = payload.databases.review_workspace.aiConversationRunSteps
    .filter((record) => !affected.has((record as Record<string, unknown>).id as string));
  payload.manifest = createLocalDataExportManifest(
    payload.databases.review_workspace,
    payload.databases.review_extensions.extensions.length,
  );
  return payload;
}

/** 生成 recovery-safe V2 快照；它排除目标孤立元数据，因此不能把目标记录恢复到修复前状态。 */
export async function prepareLocalDataRepairBackup(preview: LocalDataRepairPreview): Promise<LocalDataRepairBackup> {
  const current = await inspectLocalDataRepair(preview.repairId);
  assertSameRepairPreview(preview, current);
  const payload = await buildRepairSafetyPayload(current);
  let validated: LocalDataExportV2;
  try {
    validated = validateRestorePayload(payload);
  } catch (error) {
    throw new Error(`当前还存在无法安全自动处理的关键问题，已停止生成修复安全恢复快照：${error instanceof Error ? error.message : "未知完整性错误"}`);
  }
  return {
    affectedRecordIds: [...current.affectedRecordIds],
    createdAt: validated.exportedAt,
    repairId: current.repairId,
    snapshotKind: "recovery-safe",
    source: JSON.stringify(validated, null, 2),
    targetRecordsRecoverable: false,
  };
}

/** 用户确认恢复快照限制且 fresh V2 快照仍匹配当前数据后，原子删除精确目标并在提交前验证。 */
export async function executeLocalDataRepair(
  preview: LocalDataRepairPreview,
  backup: LocalDataRepairBackup,
  confirmation: LocalDataRepairConfirmation,
): Promise<LocalDataRepairResult> {
  if (!confirmation.recoverySnapshotSaved || !confirmation.targetRecordsNotRecoverableAcknowledged) {
    throw new Error("必须确认恢复快照已保存并理解目标记录无法通过该快照恢复后才能继续");
  }
  if (backup.snapshotKind !== "recovery-safe"
    || backup.targetRecordsRecoverable !== false
    || backup.repairId !== preview.repairId
    || !sameStringSet(backup.affectedRecordIds, preview.affectedRecordIds)) {
    throw new Error("修复安全恢复快照与当前预览不匹配，请重新生成快照");
  }
  let backupPayload: LocalDataExportV2;
  try {
    backupPayload = validateRestorePayload(JSON.parse(backup.source) as unknown);
  } catch (error) {
    throw new Error(`修复安全恢复快照无法通过恢复校验：${error instanceof Error ? error.message : "未知错误"}`);
  }
  const current = await inspectLocalDataRepair(preview.repairId);
  assertSameRepairPreview(preview, current);
  const expectedBackup = await buildRepairSafetyPayload(current);
  if (JSON.stringify(backupPayload.databases) !== JSON.stringify(expectedBackup.databases)) {
    throw new Error("生成恢复快照后本地数据已变化，请重新预览并下载新快照");
  }

  await reviewDb.transaction("rw", reviewDb.tables, async () => {
    const beforeCore = await readAllCoreData();
    const transactionPreview = targetedRepairPreview(beforeCore);
    if (!transactionPreview) throw new Error("目标问题已不存在，请重新检查数据健康");
    assertSameRepairPreview(current, transactionPreview);
    const baselineIssues = new Set(inspectLocalDataIntegrity(beforeCore)
      .filter((issue) => !(issue.code === "dangling-reference" && issue.table === "aiConversationRunSteps" && issue.recordId && current.affectedRecordIds.includes(issue.recordId)))
      .map((issue) => `${issue.code}:${issue.table}:${issue.recordId ?? ""}`));

    await reviewDb.aiConversationRunSteps.bulkDelete(current.affectedRecordIds);
    const afterCore = await readAllCoreData();
    if (targetedRepairPreview(afterCore)) throw new Error("修复后验证失败：目标孤立运行步骤仍然存在");
    const introducedIssue = inspectLocalDataIntegrity(afterCore)
      .find((issue) => !baselineIssues.has(`${issue.code}:${issue.table}:${issue.recordId ?? ""}`));
    if (introducedIssue) throw new Error(`修复后验证失败：${introducedIssue.message}`);
  });

  return { affectedRecords: current.affectedRecords, repairId: current.repairId, verified: true };
}

/** 根 Bootstrap 独占中断恢复：prepared 可丢弃，applying 必须回滚并验证后才清理。 */
export async function recoverInterruptedLocalDataRestore(): Promise<InterruptedRestoreRecoveryResult> {
  const jobs = await transferDb.jobs.orderBy("createdAt").toArray();
  const applying = jobs.filter((job) => job.status === "applying");
  if (applying.length > 1) throw new Error("检测到多个 applying 恢复事务，无法安全判断回滚顺序；事务记录已保留");

  let preparedDiscarded = 0;
  let applyingRolledBack = 0;
  for (const job of jobs) {
    if (job.status === "prepared") {
      await transferDb.jobs.delete(job.id);
      preparedDiscarded += 1;
      continue;
    }
    await replaceWithPayload(job.previous);
    await verifyAppliedPayload(job.previous);
    await transferDb.jobs.delete(job.id);
    applyingRolledBack += 1;
  }
  if (!jobs.length) return { applyingRolledBack, preparedDiscarded, status: "none" };
  const parts = [
    preparedDiscarded ? `已丢弃 ${preparedDiscarded} 个尚未修改业务数据的恢复暂存` : "",
    applyingRolledBack ? `已回滚并验证 ${applyingRolledBack} 个中断恢复事务` : "",
  ].filter(Boolean);
  return { applyingRolledBack, message: `${parts.join("；")}。`, preparedDiscarded, status: "recovered" };
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
    const manualAction = "升级应用或联系维护者确认新增表的备份分类";
    errors.push({ code: "store-classification-mismatch", manualAction, message: "本地数据库表与备份分类清单不一致；已停止自动判断备份覆盖范围。", repairability: "manual-only", scope: "review_workspace" });
    manualActions.add(manualAction);
  }

  const allCore = await readAllCoreData();
  const integrityIssues = inspectLocalDataIntegrity(allCore).slice(0, 50);
  const safeRunStepIssues = integrityIssues.filter((issue) => issue.code === "dangling-reference" && issue.table === "aiConversationRunSteps" && issue.recordId);
  const manualIntegrityIssues = integrityIssues.filter((issue) => !safeRunStepIssues.includes(issue));
  for (const issue of integrityIssues) {
    const targetedSafe = safeRunStepIssues.includes(issue);
    const manualAction = targetedSafe ? undefined : "先导出当前备份，再从已验证备份恢复或联系维护者";
    errors.push({
      code: "critical-integrity",
      manualAction,
      message: targetedSafe ? `${issue.message}；该记录仅为无父对话的脱敏运行元数据，可预览后定向清理。` : issue.message,
      recordId: issue.recordId,
      repairability: targetedSafe ? "targeted-safe" : "manual-only",
      scope: issue.table,
    });
    if (manualAction) manualActions.add(manualAction);
  }

  const transferJobs = await transferDb.jobs.toArray();
  if (transferJobs.length) {
    const prepared = transferJobs.filter((job) => job.status === "prepared").length;
    const applying = transferJobs.filter((job) => job.status === "applying").length;
    const manualAction = "重新打开应用完成安全恢复；不要手工删除恢复事务库";
    errors.push({ code: "restore-interrupted", manualAction, message: `检测到未完成恢复事务：prepared ${prepared} 个，applying ${applying} 个。根启动边界必须先处理它们。`, repairability: "manual-only", scope: "review_workspace_transfer" });
    manualActions.add(manualAction);
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
        const manualAction = "重新输入受影响的凭据";
        errors.push({ code: "credential-key-unavailable", manualAction, message: "检测到已加密凭据，但本机主密钥不可用；诊断未读取或输出凭据内容。", repairability: "manual-only", scope: "review_workspace_secure_keys" });
        manualActions.add(manualAction);
      }
    } catch {
      const manualAction = "重新输入受影响的凭据；若仍失败，先备份业务数据再完整重置";
      errors.push({ code: "credential-key-unavailable", manualAction, message: "本机主密钥库无法安全读取；诊断未读取或输出凭据内容。", repairability: "manual-only", scope: "review_workspace_secure_keys" });
      manualActions.add(manualAction);
    }
  }

  const vaultConfigs = allCore.obsidianVaultConfigs ?? [];
  const vaultMappings = (allCore.obsidianNoteMappings ?? []) as Array<Record<string, unknown>>;
  if (vaultConfigs.length || vaultMappings.length) {
    const permissionAction = "重新授权或重新选择 Obsidian Vault，然后重新运行只读同步检查";
    try {
      // Vault service 保持按需加载，避免 Health foundation 把文件系统实现带回主工作台首屏。
      const { obsidianKnowledgeRepository } = await import("./obsidian-knowledge-repository.ts");
      const snapshot = await obsidianKnowledgeRepository.loadSnapshot();
      if (!snapshot.connected || snapshot.permission !== "granted") {
        errors.push({ code: "vault-unavailable", manualAction: permissionAction, message: `Vault 当前不可用（${snapshot.recovery}）；应用不会自动选择目录或修改 Markdown。`, repairability: "manual-only", scope: "obsidianVaultConfigs" });
        manualActions.add(permissionAction);
      }
    } catch {
      errors.push({ code: "vault-unavailable", manualAction: permissionAction, message: "Vault 权限状态无法安全读取；应用未修改目录授权或 Markdown。", repairability: "manual-only", scope: "obsidianVaultConfigs" });
      manualActions.add(permissionAction);
    }

    const knowledgeIds = new Set((allCore.knowledgeEntries ?? []).map((record) => (record as Record<string, unknown>).id));
    const missingKnowledge = vaultMappings.filter((mapping) => !knowledgeIds.has(mapping.knowledgeId)).length;
    const conflictCount = vaultMappings.filter((mapping) => mapping.status === "conflict").length;
    const disconnectedCount = vaultMappings.filter((mapping) => mapping.status === "disconnected").length;
    const staleHashCount = vaultMappings.filter((mapping) => mapping.status === "synced"
      && (mapping.baseHash !== mapping.vaultHash || mapping.baseHash !== mapping.appHash)).length;
    const knowledgeIdCounts = new Map<string, number>();
    for (const mapping of vaultMappings) {
      if (typeof mapping.knowledgeId !== "string") continue;
      knowledgeIdCounts.set(mapping.knowledgeId, (knowledgeIdCounts.get(mapping.knowledgeId) ?? 0) + 1);
    }
    const duplicateMappings = [...knowledgeIdCounts.values()].filter((count) => count > 1).length;
    const mappingAction = "在 Vault 详情中重新授权并人工对账 mapping、review-id 与三方 hash；不要覆盖或删除 Vault 文件";
    if (missingKnowledge || conflictCount || staleHashCount || duplicateMappings) {
      errors.push({
        code: "vault-mapping-issue",
        manualAction: mappingAction,
        message: `Vault mapping 需要人工对账：缺本地知识 ${missingKnowledge}，冲突 ${conflictCount}，hash 不一致 ${staleHashCount}，重复知识映射 ${duplicateMappings}。`,
        repairability: "manual-only",
        scope: "obsidianNoteMappings",
      });
      manualActions.add(mappingAction);
    }
    if (disconnectedCount) {
      warnings.push({ code: "vault-mapping-issue", manualAction: mappingAction, message: `有 ${disconnectedCount} 条 Vault mapping 处于 disconnected；只报告，不自动删除 mapping 或 Vault 文件。`, repairability: "manual-only", scope: "obsidianNoteMappings" });
      manualActions.add(mappingAction);
    }
  }

  const repairPreview = targetedRepairPreview(allCore);
  const repairable: LocalDataRepairCandidate[] = repairPreview && manualIntegrityIssues.length === 0
    ? [{ action: repairPreview.action, affectedRecords: repairPreview.affectedRecords, id: repairPreview.repairId, issueCode: repairPreview.issueCode, scope: repairPreview.scope }]
    : [];

  return {
    checkedAt: new Date().toISOString(),
    errors,
    healthy: errors.length === 0 && warnings.length === 0,
    manualActions: [...manualActions],
    repairable,
    warnings,
  };
}

export const localDataManagementRepository = {
  executeRepair: executeLocalDataRepair,
  loadSummary: loadLocalDataSummary,
  inspectRepair: inspectLocalDataRepair,
  inspectRestore: inspectLocalDataRestore,
  prepareRepairBackup: prepareLocalDataRepairBackup,
  restore: restoreLocalData,
  recoverInterruptedRestore: recoverInterruptedLocalDataRestore,
  inspectHealth: inspectLocalDataHealth,

  /** 安全导出使用显式版本和字段清理，凭据与目录句柄永不进入导出包。 */
  async exportAll(): Promise<string> {
    return JSON.stringify(await exportPayload(), null, 2);
  },

  /** 只清理导入任务、批次与未确认草稿。 */
  async clearImports(): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.importJobs, reviewDb.importBatches, reviewDb.importDrafts], async () => {
      await Promise.all([reviewDb.importJobs.clear(), reviewDb.importBatches.clear(), reviewDb.importDrafts.clear()]);
    });
  },

  /** 清理错题、复盘和指向错题的关联，不删除知识资料或训练记录主体。 */
  async clearMistakeReviews(): Promise<void> {
    await reviewDb.transaction("rw", [reviewDb.mistakes, reviewDb.attempts, reviewDb.learningEvents, reviewDb.knowledgeMistakeLinks, reviewDb.interviewLinks, reviewDb.tutoringLinks], async () => {
      await Promise.all([
        reviewDb.mistakes.clear(),
        reviewDb.attempts.clear(),
        reviewDb.learningEvents.where("subjectType").equals("mistake").delete(),
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
