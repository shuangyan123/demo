import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("已安排表单完整交互不会触发空事件目标运行时错误", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();

  await expect(page.getByRole("heading", { name: "已安排", exact: true })).toBeVisible();
  await expect(page.getByText("新建已安排")).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.getByLabel("名称").fill("名称输入初次回归");
  await page.getByLabel("模板").selectOption("custom");
  await page.getByLabel("名称").fill("事件生命周期回归");
  await page.getByLabel("提示词").fill("验证已安排表单事件处理不会读取空目标。");

  await page.getByLabel("错题").uncheck();
  await page.getByLabel("知识库").uncheck();
  await page.getByLabel("面试").check();
  await page.getByLabel("辅导").check();

  await page.getByLabel("周期").selectOption("interval");
  await page.getByLabel("间隔分钟").fill("15");
  await page.getByLabel("周期").selectOption("daily");
  await page.locator('input[type="time"]').fill("10:30");
  await page.getByLabel("周期").selectOption("weekly");
  await page.getByLabel("星期").selectOption("2");
  await page.locator('input[type="time"]').fill("11:45");
  await page.getByLabel("周期").selectOption("cron");
  await page.getByLabel("五段式 Cron").fill("0 8 * * *");

  await expect(page.getByLabel("名称")).toHaveValue("事件生命周期回归");
  await expect(page.getByLabel("模板")).toHaveValue("custom");
  await expect(page.getByLabel("周期")).toHaveValue("cron");
  await expect(page.getByLabel("五段式 Cron")).toHaveValue("0 8 * * *");
  await expect(page.getByLabel("面试")).toBeChecked();
  await expect(page.getByLabel("辅导")).toBeChecked();
  await expect(page.getByLabel("错题")).not.toBeChecked();
  await expect(page.getByLabel("知识库")).not.toBeChecked();

  await page.getByRole("button", { name: "预览读取范围" }).click();
  const previewPanel = page.getByRole("region", { name: "已安排读取范围预览" });
  await expect(previewPanel).toBeVisible();
  await expect(previewPanel.getByText("面试")).toBeVisible();
  await expect(previewPanel.getByText("辅导")).toBeVisible();

  await page.getByRole("button", { name: "试运行", exact: true }).click();
  await expect(page.getByText("试运行失败", { exact: true })).toBeVisible();
  await expect(page.getByText("缺少默认文本连接")).toBeVisible();
  await expect(page.getByRole("button", { name: "配置 AI 连接" })).toBeVisible();

  await page.getByRole("button", { name: "创建已安排" }).click();
  const taskCard = page.locator("article").filter({ hasText: "事件生命周期回归" }).first();
  await expect(taskCard).toBeVisible();
  await taskCard.getByRole("button", { name: "立即运行" }).click();

  const inbox = page.locator("section").filter({ hasText: "运行收件箱" }).first();
  await expect(inbox.getByText("请先配置默认文本连接")).toBeVisible();
  await inbox.getByRole("button", { name: "查看详情" }).first().click();
  await expect(inbox.getByText("触发方式：手动")).toBeVisible();
  await expect(inbox.getByText("读取摘要")).toBeVisible();
  await expect(inbox.getByText("缺少默认文本连接")).toBeVisible();
  await inbox.getByRole("button", { name: "配置 AI 连接" }).last().click();
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  expectNoRuntimeErrors(runtimeErrors);
});
