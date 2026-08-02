import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function readReviewConversations(page: import("@playwright/test").Page) {
  return page.evaluate(() => new Promise<Array<{ id: string; projectId: string; title: string }>>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("aiConversations", "readonly");
      const records = transaction.objectStore("aiConversations").getAll();
      records.onsuccess = () => resolve(records.result.map(({ id, projectId, title }) => ({ id, projectId, title })));
      records.onerror = () => reject(records.error);
    };
  }));
}

test("UI 审查对话数据提供主题目录、阅读保护和跳到最新消息", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/?ui-review=1");
  await page.getByRole("button", { name: "新对话" }).first().click();

  await page.locator(".sample-scenario-trigger").click();
  await page.getByLabel("选择当前页面审查场景").selectOption("conversation-normal");
  await page.getByRole("button", { name: "载入本页" }).click();
  await expect.poll(() => readReviewConversations(page), { timeout: 80_000 }).toContainEqual(expect.objectContaining({
    id: "ui-review:conversation-normal:conversation",
    projectId: "civil-service",
  }));
  await page.reload();
  await page.getByRole("button", { name: "必要条件与充分条件", exact: true }).click();

  const topics = page.getByRole("navigation", { name: "对话主题目录" });
  await expect(topics).toBeVisible();
  await expect(topics.getByRole("button")).toHaveCount(6);
  await topics.getByRole("button", { name: /必要条件的常见题型陷阱/ }).click();

  const messageList = page.locator(".conversation-message-list");
  await messageList.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  const jump = page.getByRole("button", { name: "跳到最新消息" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toBeHidden();

  await page.screenshot({ path: testInfo.outputPath("v0.2.2-conversation-topics-desktop.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("完整 UI 审查数据刷新后保留且可以精准清理", async ({ page }) => {
  await page.goto("/?ui-review=1");
  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("button", { name: "载入完整数据" }).click();
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible({ timeout: 15_000 });
  await page.locator("details.dashboard-disclosure").filter({ hasText: "六大板块" }).locator("summary").click();
  await expect(page.getByText("今日队列", { exact: true })).toBeVisible();
  await expect(page.getByText("薄弱板块", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible({ timeout: 15_000 });
  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("button", { name: "删除审查数据" }).click();
  await expect(page.getByRole("button", { name: "删除审查数据" })).toBeHidden();
});
