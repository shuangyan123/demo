import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("自动化中心表单完整交互不会触发空事件目标运行时错误", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByLabel("侧栏导航").getByRole("button", { name: "自动化" }).click();

  await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
  await expect(page.getByText("新建自动化")).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.getByLabel("名称").fill("名称输入初次回归");
  await page.getByLabel("模板").selectOption("custom");
  await page.getByLabel("名称").fill("事件生命周期回归");
  await page.getByLabel("提示词").fill("验证自动化表单事件处理不会读取空目标。");

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
  expectNoRuntimeErrors(runtimeErrors);
});
