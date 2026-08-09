import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import Dexie from "dexie";
import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import { CORE_DATA_STORE_POLICIES, LOCAL_DATA_IMPORT_MAX_STORE_RECORDS, LOCAL_STORAGE_DATA_POLICIES, NON_CORE_DATA_STORE_POLICIES } from "./local-data-reliability.ts";
import { localDataManagementRepository, type LocalDataExportV2 } from "./local-data-management-repository.ts";
import { encryptSecret } from "./crypto-service.ts";
import { deleteSecureKeyStore, readSecurePrimaryKey } from "./secure-key-store.ts";
import { obsidianKnowledgeRepository } from "./obsidian-knowledge-repository.ts";
import { secretContext } from "./secret-context.ts";

async function resetDatabase(): Promise<void> {
  reviewDb.close();
  extensionDb.close();
  await Promise.all([reviewDb.delete(), extensionDb.delete(), deleteSecureKeyStore(), Dexie.delete("review_workspace_transfer")]);
  await reviewDb.open();
  await extensionDb.open();
}

async function withTransferDatabase<T>(run: (database: Dexie) => Promise<T>): Promise<T> {
  const database = new Dexie("review_workspace_transfer");
  database.version(1).stores({ jobs: "&id, status, createdAt" });
  try {
    await database.open();
    return await run(database);
  } finally {
    database.close();
  }
}

const now = "2026-08-09T00:00:00.000Z";

async function seedConversation(): Promise<void> {
  await reviewDb.aiProjects.put({ id: "civil-service", label: "公考", studyDomainId: "civil-service", createdAt: now, updatedAt: now } as never);
  await reviewDb.aiConversations.put({ id: "conversation", projectId: "civil-service", kind: "general", title: "测试", status: "active", createdAt: now, updatedAt: now } as never);
  await reviewDb.aiConversationMessages.put({ id: "message", conversationId: "conversation", role: "user", content: "测试", createdAt: now } as never);
}

test("数据管理按导入、错题复盘和对话范围独立统计与清理", async () => {
  await resetDatabase();
  const now = "2026-07-14T00:00:00.000Z";
  await reviewDb.importJobs.put({ id: "import", type: "text", status: "parsed", createdAt: now } as never);
  await reviewDb.importBatches.put({ id: "batch", source: "text", status: "parsed", createdAt: now, updatedAt: now } as never);
  await reviewDb.mistakes.put({ id: "mistake", board: "政治理论", source: "test", stem: "题", answer: "答", explanation: "解", reasons: [], tags: [], mastery: 1, nextReviewAt: now, createdAt: now, updatedAt: now } as never);
  await reviewDb.attempts.put({ id: "attempt", mistakeId: "mistake", reviewedAt: now, result: "wrong", masteryAfter: 1 } as never);
  await seedConversation();
  await reviewDb.aiConversationFolders.put({ id: "folder", projectId: "civil-service", label: "测试", createdAt: now, updatedAt: now } as never);
  await extensionDb.extensions.put({ id: "extension", kind: "theme", enabled: false, installedAt: now, updatedAt: now } as never);
  const encrypted = await encryptSecret("never-export-this", secretContext.aiConnection("connection"));
  await reviewDb.apiConnectionProfiles.put({
    id: "connection",
    label: "测试连接",
    provider: "openai",
    apiFormat: "responses",
    baseUrl: "https://api.openai.com/v1",
    capabilities: ["text"],
    ...encrypted,
    maskedKey: "neve...this",
    providerOptions: {},
    createdAt: now,
    updatedAt: now,
  });
  await reviewDb.apiSettings.put({
    id: "default",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-test",
    ...encrypted,
    maskedKey: "neve...this",
    updatedAt: now,
  });
  await reviewDb.obsidianVaultConfigs.put({
    id: "default",
    vaultName: "测试 Vault",
    managedRoot: "AI知识库",
    directoryHandle: "never-export-handle",
    status: "connected",
    updatedAt: now,
  } as never);

  const summary = await localDataManagementRepository.loadSummary();
  assert.equal(summary.importRecords, 2);
  assert.equal(summary.mistakeReviewRecords, 2);
  assert.equal(summary.conversationRecords, 3);
  assert.equal(summary.extensionRecords, 1);
  const exportSource = await localDataManagementRepository.exportAll();
  const exported = JSON.parse(exportSource) as {
    schemaVersion: number;
    credentialsExcluded: boolean;
    manifest: LocalDataExportV2["manifest"];
    databases: { review_workspace: Record<string, unknown[]>; review_extensions: { extensions: unknown[] } };
  };
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.credentialsExcluded, true);
  assert.equal(exported.manifest.schemaVersions.review_workspace, 16);
  assert.equal(exported.manifest.recordCounts.total, Object.values(exported.manifest.recordCounts.review_workspace).reduce((sum, count) => sum + count, 1));
  assert.deepEqual(new Set(exported.manifest.includedStores.review_workspace), new Set(Object.entries(CORE_DATA_STORE_POLICIES).filter(([, policy]) => policy.backup === "included").map(([table]) => table)));
  assert.equal(exported.databases.review_extensions.extensions.length, 1);
  assert.equal("apiSettings" in exported.databases.review_workspace, false);
  assert.equal("obsidianVaultConfigs" in exported.databases.review_workspace, false);
  assert.match(exportSource, /reconfigure_required/);
  assert.doesNotMatch(exportSource, /never-export-this|never-export-handle|encryptedKey|maskedKey|neve\.\.\.this|directoryHandle/);

  const restorePreview = await localDataManagementRepository.inspectRestore(exportSource);
  assert.equal(restorePreview.incomingRecords > 0, true);
  assert.match(restorePreview.reminders.join(" "), /凭据|Vault/);
  await reviewDb.mistakes.clear();
  await localDataManagementRepository.restore(restorePreview);
  assert.equal(await reviewDb.mistakes.count(), 1);
  const restoredProfile = await reviewDb.apiConnectionProfiles.get("connection");
  assert.equal((restoredProfile as unknown as Record<string, unknown>).credentialStatus, "reconfigure_required");
  assert.equal("encryptedKey" in (restoredProfile as unknown as Record<string, unknown>), false);

  await localDataManagementRepository.clearImports();
  assert.equal(await reviewDb.importJobs.count(), 0);
  assert.equal(await reviewDb.mistakes.count(), 1);
  await localDataManagementRepository.clearMistakeReviews();
  assert.equal(await reviewDb.mistakes.count(), 0);
  assert.equal(await reviewDb.aiConversations.count(), 1);
  await localDataManagementRepository.clearConversations();
  assert.equal(await reviewDb.aiConversations.count(), 0);
  assert.equal(await reviewDb.aiConversationFolders.count(), 0);
});

test("备份恢复拒绝错误版本、重复 ID 与悬空关联", async () => {
  await resetDatabase();
  const emptySource = await localDataManagementRepository.exportAll();
  const wrongVersion = JSON.parse(emptySource) as Record<string, unknown>;
  wrongVersion.schemaVersion = 99;
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(wrongVersion)), /不支持的备份版本/);

  const duplicate = JSON.parse(emptySource) as {
    databases: { review_workspace: Record<string, unknown[]> };
  };
  duplicate.databases.review_workspace.mistakes = [{ id: "same" }, { id: "same" }];
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(duplicate)), /重复 ID/);

  const dangling = JSON.parse(emptySource) as {
    databases: { review_workspace: Record<string, unknown[]> };
  };
  dangling.databases.review_workspace.attempts = [{ id: "attempt", mistakeId: "missing" }];
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(dangling)), /悬空关联/);
});

test("全部核心表显式分类，安全表保持排除且新 V2 清单与真实导出一致", async () => {
  await resetDatabase();
  const actualTables = reviewDb.tables.map((table) => table.name).sort();
  assert.deepEqual(Object.keys(CORE_DATA_STORE_POLICIES).sort(), actualTables);
  assert.deepEqual(
    Object.entries(CORE_DATA_STORE_POLICIES).filter(([, policy]) => policy.backup === "excluded").map(([table]) => table).sort(),
    ["apiSettings", "obsidianVaultConfigs"],
  );
  assert.equal(NON_CORE_DATA_STORE_POLICIES["review_extensions.extensions"].backup, "included");
  assert.equal(NON_CORE_DATA_STORE_POLICIES["review_workspace_secure_keys.keys"].backup, "excluded");
  assert.equal(NON_CORE_DATA_STORE_POLICIES["review_workspace_transfer.jobs"].backup, "excluded");
  assert.equal(new Set(LOCAL_STORAGE_DATA_POLICIES.map((policy) => policy.pattern)).size, LOCAL_STORAGE_DATA_POLICIES.length);
  assert.equal(LOCAL_STORAGE_DATA_POLICIES.every((policy) => policy.backup === "excluded" && Boolean(policy.reason)), true);
  const exported = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  assert.deepEqual(exported.manifest.recordCounts.review_workspace, Object.fromEntries(actualTables.filter((table) => CORE_DATA_STORE_POLICIES[table as keyof typeof CORE_DATA_STORE_POLICIES].backup === "included").map((table) => [table, 0])));
  assert.equal(exported.manifest.recordCounts.total, 0);
});

test("恢复 preflight 拒绝未知存储、敏感字段、伪造清单和超限记录且不改当前数据", async () => {
  await resetDatabase();
  await reviewDb.mistakes.put({ id: "existing", board: "判断推理", stem: "保留", answer: "A", explanation: "", reasons: [], tags: [], mastery: 1, createdAt: now, updatedAt: now } as never);
  const source = await localDataManagementRepository.exportAll();

  const unknownDatabase = JSON.parse(source) as LocalDataExportV2 & { databases: LocalDataExportV2["databases"] & { unknown?: unknown } };
  unknownDatabase.databases.unknown = {};
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(unknownDatabase)), /未知数据库/);

  const unknownExtensionStore = JSON.parse(source) as LocalDataExportV2 & { databases: { review_extensions: { extensions: unknown[]; scripts?: unknown[] } } };
  unknownExtensionStore.databases.review_extensions.scripts = [];
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(unknownExtensionStore)), /不允许导入的扩展表/);

  const secret = JSON.parse(source) as LocalDataExportV2;
  secret.databases.review_workspace.apiConnectionProfiles = [{ id: "unsafe", apiKey: "must-not-import" }];
  delete (secret as Partial<LocalDataExportV2>).manifest;
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(secret)), /安全敏感字段/);

  const wrongCounts = JSON.parse(source) as LocalDataExportV2;
  wrongCounts.manifest.recordCounts.total += 1;
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(wrongCounts)), /记录数与实际内容不一致/);

  const tooMany = JSON.parse(source) as LocalDataExportV2;
  tooMany.databases.review_workspace.mistakes = new Array(LOCAL_DATA_IMPORT_MAX_STORE_RECORDS + 1).fill({ id: "oversize" });
  delete (tooMany as Partial<LocalDataExportV2>).manifest;
  await assert.rejects(() => localDataManagementRepository.inspectRestore(JSON.stringify(tooMany)), /记录限制/);

  assert.equal((await reviewDb.mistakes.get("existing"))?.stem, "保留");
  assert.equal(await reviewDb.mistakes.count(), 1);
});

test("早期无 manifest 的 V2 仍可读取并规范化为当前清单", async () => {
  await resetDatabase();
  const legacy = JSON.parse(await localDataManagementRepository.exportAll()) as Partial<LocalDataExportV2>;
  delete legacy.manifest;
  const preview = await localDataManagementRepository.inspectRestore(JSON.stringify(legacy));
  assert.equal(preview.payload.manifest.schemaVersions.review_workspace, 16);
  assert.equal(preview.payload.manifest.recordCounts.total, 0);
});

test("恢复应用后的 verify 失败会回滚旧快照并在完成回滚后清理事务", async () => {
  await resetDatabase();
  await reviewDb.mistakes.put({ id: "before", board: "资料分析", stem: "旧数据", answer: "A", explanation: "", reasons: [], tags: [], mastery: 1, createdAt: now, updatedAt: now } as never);
  const incoming = JSON.parse(await localDataManagementRepository.exportAll()) as Partial<LocalDataExportV2> & { databases: LocalDataExportV2["databases"] };
  incoming.databases.review_workspace.mistakes = [{ id: "after", board: "资料分析", stem: "新数据", answer: "B", explanation: "", reasons: [], tags: [], mastery: 1, createdAt: now, updatedAt: now }];
  incoming.databases.review_extensions.extensions = [{ id: "extension", kind: "theme", enabled: false, installedAt: now, updatedAt: now }];
  delete incoming.manifest;
  const preview = await localDataManagementRepository.inspectRestore(JSON.stringify(incoming));

  const originalBulkAdd = extensionDb.extensions.bulkAdd.bind(extensionDb.extensions);
  let dropFirstWrite = true;
  Object.defineProperty(extensionDb.extensions, "bulkAdd", {
    configurable: true,
    value: async (records: never[]) => {
      if (dropFirstWrite) {
        dropFirstWrite = false;
        return [];
      }
      return originalBulkAdd(records);
    },
  });
  try {
    await assert.rejects(() => localDataManagementRepository.restore(preview), /记录数|恢复后验证/);
  } finally {
    Object.defineProperty(extensionDb.extensions, "bulkAdd", { configurable: true, value: originalBulkAdd });
  }

  assert.equal((await reviewDb.mistakes.get("before"))?.stem, "旧数据");
  assert.equal(await reviewDb.mistakes.get("after"), undefined);
  assert.equal(await withTransferDatabase((database) => database.table("jobs").count()), 0);
});

test("Health Check 将关键用户数据与缺失主密钥保持 manual-only", async () => {
  await resetDatabase();
  const healthy = await localDataManagementRepository.inspectHealth();
  assert.equal(healthy.healthy, true);
  assert.deepEqual(healthy.repairable, []);

  await reviewDb.attempts.put({ id: "dangling", mistakeId: "missing", reviewedAt: now, result: "wrong", masteryAfter: 1 } as never);
  await reviewDb.apiConnectionProfiles.put({ id: "credential", encryptedKey: "do-not-print", iv: "do-not-print-iv" } as never);
  const broken = await localDataManagementRepository.inspectHealth();
  assert.equal(broken.healthy, false);
  assert.equal(broken.errors.find((issue) => issue.code === "critical-integrity")?.repairability, "manual-only");
  assert.equal(broken.errors.find((issue) => issue.code === "credential-key-unavailable")?.repairability, "manual-only");
  assert.deepEqual(broken.repairable, []);
  assert.doesNotMatch(JSON.stringify(broken), /do-not-print/);
});

test("孤立对话运行步骤提供无泄漏 preview，确认前不修改且只定向删除预期记录", async () => {
  await resetDatabase();
  await seedConversation();
  await reviewDb.aiConversationRunSteps.bulkPut([
    { id: "valid-step", conversationId: "conversation", runId: "valid-run", label: "有效步骤", state: "done", createdAt: now, updatedAt: now },
    { id: "orphan-step", conversationId: "missing-conversation", runId: "orphan-run", label: "孤立步骤", text: "never-leak-repair-evidence", state: "error", createdAt: now, updatedAt: now },
  ] as never[]);

  const health = await localDataManagementRepository.inspectHealth();
  assert.equal(health.repairable.length, 1);
  assert.equal(health.repairable[0]?.id, "delete-orphan-conversation-run-steps");
  assert.equal(health.errors.find((issue) => issue.recordId === "orphan-step")?.repairability, "targeted-safe");

  const preview = await localDataManagementRepository.inspectRepair("delete-orphan-conversation-run-steps");
  assert.deepEqual(preview.affectedRecordIds, ["orphan-step"]);
  assert.equal(preview.backupRequired, true);
  assert.equal(await reviewDb.aiConversationRunSteps.count(), 2);
  assert.doesNotMatch(JSON.stringify(preview), /never-leak-repair-evidence/);

  const backup = await localDataManagementRepository.prepareRepairBackup(preview);
  await localDataManagementRepository.inspectRestore(backup.source);
  assert.doesNotMatch(backup.source, /never-leak-repair-evidence|orphan-step/);
  await assert.rejects(() => localDataManagementRepository.executeRepair(preview, backup, false), /明确确认/);
  assert.equal(await reviewDb.aiConversationRunSteps.count(), 2);

  const result = await localDataManagementRepository.executeRepair(preview, backup, true);
  assert.equal(result.verified, true);
  assert.equal(await reviewDb.aiConversationRunSteps.get("orphan-step"), undefined);
  assert.ok(await reviewDb.aiConversationRunSteps.get("valid-step"));
  assert.ok(await reviewDb.aiConversations.get("conversation"));
  assert.ok(await reviewDb.aiConversationMessages.get("message"));
  assert.equal((await localDataManagementRepository.inspectHealth()).healthy, true);
});

test("定向修复 verify 失败会中止 transaction 并保留诊断证据", async () => {
  await resetDatabase();
  await reviewDb.aiConversationRunSteps.put({ id: "orphan-step", conversationId: "missing", runId: "run", label: "孤立", state: "error", createdAt: now, updatedAt: now } as never);
  const preview = await localDataManagementRepository.inspectRepair("delete-orphan-conversation-run-steps");
  const backup = await localDataManagementRepository.prepareRepairBackup(preview);
  const originalBulkDelete = reviewDb.aiConversationRunSteps.bulkDelete.bind(reviewDb.aiConversationRunSteps);
  Object.defineProperty(reviewDb.aiConversationRunSteps, "bulkDelete", { configurable: true, value: async () => undefined });
  try {
    await assert.rejects(() => localDataManagementRepository.executeRepair(preview, backup, true), /修复后验证失败/);
  } finally {
    Object.defineProperty(reviewDb.aiConversationRunSteps, "bulkDelete", { configurable: true, value: originalBulkDelete });
  }
  assert.ok(await reviewDb.aiConversationRunSteps.get("orphan-step"));
});

test("prepared 恢复事务只清理暂存且不改业务数据", async () => {
  await resetDatabase();
  await reviewDb.mistakes.put({ id: "current", board: "数量关系", stem: "当前数据", answer: "A", explanation: "", reasons: [], tags: [], mastery: 1, createdAt: now, updatedAt: now } as never);
  const snapshot = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  await withTransferDatabase(async (database) => {
    await database.table("jobs").put({ id: "prepared", status: "prepared", incoming: snapshot, previous: snapshot, createdAt: now });
  });
  const result = await localDataManagementRepository.recoverInterruptedRestore();
  assert.equal(result.status, "recovered");
  assert.equal(result.preparedDiscarded, 1);
  assert.equal(result.applyingRolledBack, 0);
  assert.equal((await reviewDb.mistakes.get("current"))?.stem, "当前数据");
  assert.equal(await withTransferDatabase((database) => database.table("jobs").count()), 0);
});

test("applying 恢复事务成功回滚并验证后才清理", async () => {
  await resetDatabase();
  await reviewDb.mistakes.put({ id: "snapshot", board: "数量关系", stem: "原数据", answer: "A", explanation: "", reasons: [], tags: [], mastery: 1, createdAt: now, updatedAt: now } as never);
  const previous = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  await reviewDb.mistakes.clear();
  const incoming = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  await withTransferDatabase(async (database) => {
    await database.table("jobs").put({ id: "interrupted", status: "applying", incoming, previous, createdAt: now });
  });
  const interrupted = await localDataManagementRepository.inspectHealth();
  assert.equal(interrupted.errors.find((issue) => issue.code === "restore-interrupted")?.repairability, "manual-only");
  const result = await localDataManagementRepository.recoverInterruptedRestore();
  assert.equal(result.applyingRolledBack, 1);
  assert.equal((await reviewDb.mistakes.get("snapshot"))?.stem, "原数据");
  assert.equal(await withTransferDatabase((database) => database.table("jobs").count()), 0);
});

test("applying 回滚验证失败会保留事务且不报告恢复成功", async () => {
  await resetDatabase();
  const previous = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  previous.manifest.recordCounts.total += 1;
  const incoming = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  await withTransferDatabase(async (database) => {
    await database.table("jobs").put({ id: "broken-applying", status: "applying", incoming, previous, createdAt: now });
  });
  await assert.rejects(() => localDataManagementRepository.recoverInterruptedRestore(), /记录数与实际内容不一致/);
  assert.equal(await withTransferDatabase((database) => database.table("jobs").count()), 1);
});

test("Vault permission、mapping conflict 与 hash 异常只读报告为 manual-only", async () => {
  await resetDatabase();
  await reviewDb.knowledgeEntries.put({ id: "knowledge", category: "方法", title: "知识", summary: "", content: "", tags: [], source: "test", favorite: false, mastery: 1, nextReviewAt: now, reviewCount: 0, createdAt: now, updatedAt: now } as never);
  await reviewDb.obsidianVaultConfigs.put({ id: "default", backend: "browser", vaultName: "测试 Vault", managedRoot: "AI知识库", directoryHandle: "never-print-handle", createdAt: now, updatedAt: now } as never);
  await reviewDb.obsidianNoteMappings.put({ path: "方法/知识.md", knowledgeId: "knowledge", category: "方法", baseHash: "base", vaultHash: "vault", appHash: "app", status: "conflict", wikilinks: [], sourceRefs: [], conflictVaultMarkdown: "never-print-vault-body", createdAt: now, updatedAt: now } as never);
  const beforeConfig = await reviewDb.obsidianVaultConfigs.get("default");
  const beforeMapping = await reviewDb.obsidianNoteMappings.get("方法/知识.md");
  const originalLoadSnapshot = obsidianKnowledgeRepository.loadSnapshot.bind(obsidianKnowledgeRepository);
  Object.defineProperty(obsidianKnowledgeRepository, "loadSnapshot", {
    configurable: true,
    value: async () => ({ id: "default", vaultName: "测试 Vault", managedRoot: "AI知识库", createdAt: now, updatedAt: now, connected: false, permission: "denied", recovery: "reauthorize", mappedCount: 1, conflictCount: 1, pendingProposalCount: 0 }),
  });
  try {
    const health = await localDataManagementRepository.inspectHealth();
    assert.equal(health.errors.find((issue) => issue.code === "vault-unavailable")?.repairability, "manual-only");
    assert.equal(health.errors.find((issue) => issue.code === "vault-mapping-issue")?.repairability, "manual-only");
    assert.doesNotMatch(JSON.stringify(health), /never-print/);
    assert.doesNotMatch(await localDataManagementRepository.exportAll(), /never-print|conflictVaultMarkdown|conflictAppMarkdown/);
  } finally {
    Object.defineProperty(obsidianKnowledgeRepository, "loadSnapshot", { configurable: true, value: originalLoadSnapshot });
  }
  assert.deepEqual(await reviewDb.obsidianVaultConfigs.get("default"), beforeConfig);
  assert.deepEqual(await reviewDb.obsidianNoteMappings.get("方法/知识.md"), beforeMapping);
});

test("恢复 preflight 拒绝伪造进入 V2 的 Vault conflict 正文", async () => {
  await resetDatabase();
  const payload = JSON.parse(await localDataManagementRepository.exportAll()) as LocalDataExportV2;
  payload.databases.review_workspace.obsidianNoteMappings.push({
    path: "方法/伪造.md",
    knowledgeId: "knowledge",
    conflictVaultMarkdown: "不得进入恢复边界的 Vault 正文",
  });
  payload.manifest.recordCounts.review_workspace.obsidianNoteMappings += 1;
  payload.manifest.recordCounts.total += 1;
  await assert.rejects(
    () => localDataManagementRepository.inspectRestore(JSON.stringify(payload)),
    /安全敏感字段/,
  );
});

test("完整重置同时删除业务数据和不可导出主密钥", async () => {
  await resetDatabase();
  await encryptSecret("reset-secret", secretContext.aiConnection("reset"));
  assert.ok(await readSecurePrimaryKey());
  const storage = new Map<string, string>([
    ["review-workspace:mcp-settings:v2", "secret"],
    ["review_connection_test_model_v1:reset", "model"],
    ["other-application", "keep"],
  ]);
  const localStorage = {
    get length() { return storage.size; },
    key(index: number) { return [...storage.keys()][index] ?? null; },
    getItem(key: string) { return storage.get(key) ?? null; },
    setItem(key: string, value: string) { storage.set(key, value); },
    removeItem(key: string) { storage.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });

  await localDataManagementRepository.resetAll();

  assert.equal(await readSecurePrimaryKey(), undefined);
  assert.equal(storage.has("review-workspace:mcp-settings:v2"), false);
  assert.equal(storage.has("review_connection_test_model_v1:reset"), false);
  assert.equal(storage.get("other-application"), "keep");
  Reflect.deleteProperty(globalThis, "window");
  await reviewDb.open();
  assert.equal(await reviewDb.apiConnectionProfiles.count(), 0);
});

test.after(async () => {
  reviewDb.close();
  extensionDb.close();
  await Promise.all([reviewDb.delete(), extensionDb.delete(), deleteSecureKeyStore(), Dexie.delete("review_workspace_transfer")]);
});
