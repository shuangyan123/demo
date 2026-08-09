import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function seedConversation(page: Page, title: string): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "设置" }).first()).toBeEnabled();
  await page.evaluate(async (conversationTitle) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("review_workspace");
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("review_workspace 打开被阻塞"));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("aiConversations", "readwrite");
        const timestamp = new Date().toISOString();
        transaction.objectStore("aiConversations").put({ id: "data-reliability-conversation", projectId: "civil-service", studyDomainId: "civil-service", kind: "general", title: conversationTitle, status: "active", sourceType: "manual", messageCount: 0, createdAt: timestamp, updatedAt: timestamp });
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("写入测试会话失败"));
        transaction.oncomplete = () => { database.close(); resolve(); };
      };
    });
  }, title);
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function deleteSeededConversation(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("review_workspace");
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("review_workspace 打开被阻塞"));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("aiConversations", "readwrite");
        transaction.objectStore("aiConversations").delete("data-reliability-conversation");
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("删除测试会话失败"));
        transaction.oncomplete = () => { database.close(); resolve(); };
      };
    });
  });
}

async function seedOrphanRunStep(page: Page): Promise<void> {
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("aiConversationRunSteps", "readwrite");
      transaction.objectStore("aiConversationRunSteps").put({ id: "data-reliability-orphan-step", conversationId: "missing-conversation", runId: "orphan-run", label: "孤立诊断步骤", state: "error", text: "不应出现在修复预览", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }));
}

async function hasRecord(page: Page, store: string, id: string): Promise<boolean> {
  return page.evaluate(async ({ storeName, recordId }) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const getRequest = request.result.transaction(storeName, "readonly").objectStore(storeName).get(recordId);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => resolve(Boolean(getRequest.result));
    };
  }), { storeName: store, recordId: id });
}

async function seedApplyingTransferJob(page: Page, previous: unknown): Promise<void> {
  await page.evaluate(async (previousSnapshot) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace_transfer");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("jobs", "readwrite");
      transaction.objectStore("jobs").put({ id: "e2e-applying", status: "applying", incoming: previousSnapshot, previous: previousSnapshot, createdAt: new Date().toISOString() });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }), previous);
}

async function transferJobCount(page: Page): Promise<number> {
  return page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("review_workspace_transfer");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const count = request.result.transaction("jobs", "readonly").objectStore("jobs").count();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => resolve(count.result);
    };
  }));
}

async function openDataManagement(page: Page): Promise<void> {
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "诊断" }).click();
  await expect(page.getByText("数据管理", { exact: true })).toBeVisible();
}

test("真实备份恢复在删除后找回用户可见记录并通过只读健康检查", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const title = "数据可靠性备份会话";
  await seedConversation(page, title);
  await openDataManagement(page);

  await page.getByRole("button", { name: "检查数据健康" }).click();
  await expect(page.getByText("本地业务数据正常")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();

  await deleteSeededConversation(page);
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  await openDataManagement(page);
  await page.getByLabel("选择本地数据备份").setInputFiles(backupPath!);
  const dialog = page.getByRole("dialog", { name: "确认恢复本地备份" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认替换" }).click();
  await expect(page.getByRole("status")).toContainText("备份已恢复");

  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("畸形备份在 destructive mutation 前被拒绝且刷新后原数据保持", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const title = "畸形恢复保留会话";
  await seedConversation(page, title);
  await openDataManagement(page);

  await page.getByLabel("选择本地数据备份").setInputFiles({
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 99, credentialsExcluded: true, databases: {} })),
    mimeType: "application/json",
    name: "malformed-backup.json",
  });
  await expect(page.getByRole("status")).toContainText("不支持的备份版本");
  await expect(page.getByRole("dialog", { name: "确认恢复本地备份" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("targeted repair 必须预览、下载恢复快照和双确认，验证后只移除孤立运行元数据", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const title = "定向修复保留会话";
  await seedConversation(page, title);
  await seedOrphanRunStep(page);
  await openDataManagement(page);

  await page.getByRole("button", { name: "检查数据健康" }).click();
  await expect(page.getByText("可定向修复", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看修复预览" }).click();
  const dialog = page.getByRole("dialog", { name: "定向修复预览" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("aiConversationRunSteps · 1 条精确记录");
  await expect(dialog).toContainText("本次目标记录不能通过该快照恢复");
  await expect(dialog).not.toContainText("不应出现在修复预览");
  const executeButton = dialog.getByRole("button", { name: "确认定向修复" });
  await expect(executeButton).toBeDisabled();
  expect(await hasRecord(page, "aiConversationRunSteps", "data-reliability-orphan-step")).toBe(true);

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载修复安全恢复快照" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^review-workspace-repair-recovery-\d{4}-\d{2}-\d{2}\.json$/);
  const savedAcknowledgement = dialog.getByLabel("我已确认浏览器已保存恢复快照");
  const deletionAcknowledgement = dialog.getByLabel("我理解本次孤立运行元数据不会进入恢复快照，确认后无法通过该快照恢复");
  await savedAcknowledgement.check();
  await expect(executeButton).toBeDisabled();
  await savedAcknowledgement.uncheck();
  await deletionAcknowledgement.check();
  await expect(executeButton).toBeDisabled();
  await savedAcknowledgement.check();
  await expect(executeButton).toBeEnabled();
  await executeButton.click();
  await expect(page.getByText("已定向清理 1 条孤立运行元数据，并通过修复后完整性验证。", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  expect(await hasRecord(page, "aiConversationRunSteps", "data-reliability-orphan-step")).toBe(false);
  await openDataManagement(page);
  await page.getByRole("button", { name: "检查数据健康" }).click();
  await expect(page.getByText("本地业务数据正常")).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("applying transfer job 在启动业务前回滚 previous snapshot 并显示恢复结果", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const title = "中断恢复找回会话";
  await seedConversation(page, title);
  await openDataManagement(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();
  const previous = JSON.parse(await readFile(backupPath!, "utf8")) as unknown;

  await deleteSeededConversation(page);
  expect(await hasRecord(page, "aiConversations", "data-reliability-conversation")).toBe(false);
  await seedApplyingTransferJob(page, previous);
  await page.reload();

  await expect(page.getByText(/已回滚并验证 1 个中断恢复事务/)).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  expect(await transferJobCount(page)).toBe(0);
  await expect(page.getByRole("button", { name: "设置" }).first()).toBeEnabled();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
