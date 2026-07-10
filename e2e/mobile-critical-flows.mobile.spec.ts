import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 断言移动视口没有页面级横向溢出；横向工作台导航应只在自身容器内滚动。 */
async function expectNoDocumentHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
}

test("移动视口下关键入口可达且不会出现运行时错误或页面级横向溢出", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await expect(page.getByRole("heading", { name: "配置健康" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收起侧边栏" })).toBeVisible();
  await expect(page.getByRole("button", { name: "知识库", exact: true })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(page.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" })).toBeVisible();

  await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
  await expect(page.getByRole("heading", { name: "已安排", exact: true })).toBeVisible();
  await page.getByLabel("名称").fill("移动视口回归");
  await expect(page.getByLabel("名称")).toHaveValue("移动视口回归");
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await expect(page.getByText("Obsidian 知识图谱")).toBeVisible();
  await expect(page.getByRole("button", { name: "连接 Vault 文件夹" })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await page.getByRole("button", { name: /本地部署 \/ 自定义连接/ }).click();
  await page.getByLabel("连接名称").fill("E2E 移动本地连接");
  await page.getByLabel("Base URL").fill("http://127.0.0.1:9999/v1");
  await page.getByLabel("模型").fill("mobile-e2e-model");
  await expect(page.getByLabel("连接名称")).toHaveValue("E2E 移动本地连接");
  await page.getByRole("button", { name: "诊断" }).click();
  await expect(page.getByRole("heading", { name: "诊断", exact: true })).toBeVisible();
  await expect(page.getByLabel("诊断报告")).toContainText("本地诊断报告");

  await expectNoFrameworkOverlay(page);
  await expectNoDocumentHorizontalOverflow(page);
  expectNoRuntimeErrors(runtimeErrors);
});
