import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("真实对话示例提供主题目录、阅读保护和跳到最新消息", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "新对话" }).first().click();

  await page.getByLabel("选择示例场景").selectOption("conversation-normal");
  await page.getByRole("button", { name: "载入示例" }).click();
  await expect(page.getByText("示例模式", { exact: true })).toBeVisible({ timeout: 15_000 });

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

test("示例模式退出后回到个人数据且清理操作保持可用", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("选择示例场景").selectOption("dashboard-normal");
  await page.getByRole("button", { name: "载入示例" }).click();
  await expect(page.getByText("示例模式", { exact: true })).toBeVisible();
  await page.locator("details.dashboard-disclosure").filter({ hasText: "六大板块" }).locator("summary").click();
  await expect(page.getByText("今日队列", { exact: true })).toBeVisible();
  await expect(page.getByText("薄弱板块", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出示例" }).click();
  await expect(page.getByText("示例模式", { exact: true })).toBeHidden();
});
