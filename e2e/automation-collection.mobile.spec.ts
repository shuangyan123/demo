import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("390×844 采集配置保持单栏且无横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
  await page.getByLabel("模板").selectOption("xingce_collection");
  await page.getByRole("button", { name: "+ 页面" }).click();
  await expect(page.getByText("外部知识采集")).toBeVisible();
  await expect(page.getByLabel("任务允许域名")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("scheduled-collection-mobile-390x844.png"), fullPage: true });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
