import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { reviewDb } from "../db/review-db.ts";
import { extensionDb } from "../db/extension-db.ts";
import { localDataManagementRepository } from "./local-data-management-repository.ts";
import { encryptSecret } from "./crypto-service.ts";
import { readSecurePrimaryKey } from "./secure-key-store.ts";
import { secretContext } from "./secret-context.ts";

async function resetDatabase(): Promise<void> {
  reviewDb.close();
  extensionDb.close();
  await Promise.all([reviewDb.delete(), extensionDb.delete()]);
  await reviewDb.open();
  await extensionDb.open();
}

test("数据管理按导入、错题复盘和对话范围独立统计与清理", async () => {
  await resetDatabase();
  const now = "2026-07-14T00:00:00.000Z";
  await reviewDb.importJobs.put({ id: "import", type: "text", status: "parsed", createdAt: now } as never);
  await reviewDb.importBatches.put({ id: "batch", source: "text", status: "parsed", createdAt: now, updatedAt: now } as never);
  await reviewDb.mistakes.put({ id: "mistake", board: "政治理论", source: "test", stem: "题", answer: "答", explanation: "解", reasons: [], tags: [], mastery: 1, nextReviewAt: now, createdAt: now, updatedAt: now } as never);
  await reviewDb.attempts.put({ id: "attempt", mistakeId: "mistake", reviewedAt: now, result: "wrong", masteryAfter: 1 } as never);
  await reviewDb.aiConversationFolders.put({ id: "folder", projectId: "civil-service", label: "测试", createdAt: now, updatedAt: now } as never);
  await reviewDb.aiConversations.put({ id: "conversation", projectId: "civil-service", kind: "general", title: "测试", status: "active", createdAt: now, updatedAt: now } as never);
  await reviewDb.aiConversationMessages.put({ id: "message", conversationId: "conversation", role: "user", content: "测试", createdAt: now } as never);
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
    databases: { review_workspace: Record<string, unknown[]>; review_extensions: { extensions: unknown[] } };
  };
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.credentialsExcluded, true);
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
  await Promise.all([reviewDb.delete(), extensionDb.delete()]);
});
