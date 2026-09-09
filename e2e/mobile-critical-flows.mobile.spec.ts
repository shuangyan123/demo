import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { configureCustomTextConnection } from "./helpers/configure-custom-ai";

/** 断言移动视口没有页面级横向溢出；横向工作台导航应只在自身容器内滚动。 */
async function expectNoDocumentHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
}

/** 从移动抽屉切换设置分区，并验证导航后抽屉自动关闭。 */
async function selectMobileSettingsSection(page: Page, sectionName: string) {
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await drawer.getByRole("button", { name: sectionName, exact: true }).click();
  await expect(drawer).toBeHidden();
}

test("移动视口下关键入口可达且不会出现运行时错误或页面级横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("Recall");
  await expect(page.locator(".dashboard-configuration-health > summary")).toContainText("配置健康");
  await expect(page.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
  await page.locator(".dashboard-configuration-health > summary").click();
  await expect(page.getByRole("button", { name: "连接 Obsidian" })).toBeVisible();
  await page.locator(".dashboard-configuration-health > summary").click();
  await expectNoFrameworkOverlay(page);
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(page.getByRole("button", { name: "收起侧边栏" })).toBeVisible();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  const scheduledNavigation = drawer.getByRole("region", { name: "工作台", exact: true }).getByRole("button", { name: "已安排", exact: true });
  await expect(scheduledNavigation).toBeVisible();

  await scheduledNavigation.click();
  await expect(page.getByRole("heading", { name: "已安排", exact: true })).toBeVisible();
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  await page.getByLabel("名称").fill("移动视口回归");
  await expect(page.getByLabel("名称")).toHaveValue("移动视口回归");
  await expectNoDocumentHorizontalOverflow(page);

  await page.goto("/");
  await page.locator(".dashboard-configuration-health > summary").click();
  await page.locator(".dashboard-configuration-health").getByRole("button", { name: "连接 Obsidian" }).click();
  await expect(page.getByText("Obsidian 知识图谱")).toBeVisible();
  await expect(page.getByRole("button", { name: "连接 Vault 文件夹" })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByRole("dialog", { name: "应用导航" }).getByRole("button", { name: "设置" }).click();
  await selectMobileSettingsSection(page, "AI 连接");
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await configureCustomTextConnection(page, { label: "E2E 移动本地连接", baseUrl: "http://127.0.0.1:9999/v1", model: "mobile-e2e-model" });
  await expect(page.getByLabel("连接名称")).toHaveValue("E2E 移动本地连接");
  const connectionActions = page.locator('[class*="connectionActions"]').first().getByRole("button");
  await expect(connectionActions).toHaveCount(3);
  for (const button of await connectionActions.all()) await expect(button).toBeVisible();
  await page.locator('[class*="connectionTable"]').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("ai-connections-mobile.png"), fullPage: false });
  await selectMobileSettingsSection(page, "诊断");
  await expect(page.getByRole("heading", { name: "诊断", exact: true })).toBeVisible();
  await expect(page.getByLabel("诊断报告")).toContainText("本地诊断报告");
  await selectMobileSettingsSection(page, "个性化");
  const memoryTab = page.getByRole("button", { name: "记忆", exact: true });
  await memoryTab.click();
  const memoryTabBox = await memoryTab.boundingBox();
  expect(memoryTabBox?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole("heading", { name: "记忆", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("personalization-memory-mobile.png"), fullPage: false });
  await expectNoDocumentHorizontalOverflow(page);
  await selectMobileSettingsSection(page, "外观");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await selectMobileSettingsSection(page, "个性化");
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("personalization-memory-mobile-dark.png"), fullPage: false });
  await expectNoDocumentHorizontalOverflow(page);

  await expectNoFrameworkOverlay(page);
  await expectNoDocumentHorizontalOverflow(page);
  expectNoRuntimeErrors(runtimeErrors);
});
