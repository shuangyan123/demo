import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function seedConversation(page: Page, title: string): Promise<void> {
  await page.goto("/");
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
