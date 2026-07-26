import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 仅在原生详情未展开时点击 summary。 */
async function ensureDetailsOpen(summary: Locator) {
  const open = await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open);
  if (!open) await summary.click();
}

/** 从移动抽屉进入公考模块，并在选择后确认抽屉关闭。 */
async function openMobileModule(page: Page, name: string) {
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await ensureDetailsOpen(drawer.locator("summary").filter({ hasText: "公考" }).first());
  await ensureDetailsOpen(drawer.locator("summary").filter({ hasText: "模块" }).first());
  await drawer.getByRole("button", { name }).click();
  await expect(drawer).toBeHidden();
}

/** 断言移动页面没有文档级横向滚动。 */
async function expectNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

/** 使用移动端可见的录入表单创建今日复盘数据。 */
async function createMobileMistake(page: Page) {
  await page.locator(".dashboard-configuration-health > summary").click();
  await page.locator(".dashboard-configuration-health").getByRole("button", { name: "手动录入" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存错题" }) });
  await form.getByLabel("板块").selectOption("资料分析");
  await form.getByLabel("来源").fill("P1 移动回归");
  await form.getByLabel("题干").fill("移动端错题：基期量换算应使用哪个公式？");
  await form.getByLabel("答案").fill("现期量除以一加增长率");
  await form.getByLabel("错因").fill("公式混淆");
  await form.getByLabel("解析").fill("先识别现期和增长率，再计算基期。 ");
  await form.getByRole("button", { name: "保存错题" }).click();
}

test("P1 移动端列表详情、复盘底栏和知识工作区可达", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await createMobileMistake(page);
  await openMobileModule(page, "学习数据");
  await page.getByRole("button", { name: "批量管理" }).click();
  await expect(page.locator(".chrome-topbar").getByText("错题库", { exact: true })).toBeVisible();
  await expect(page.locator(".learning-detail")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("p1-mistakes-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: /移动端错题/ }).click();
  await expect(page.getByRole("button", { name: "返回错题列表" })).toBeVisible();
  await page.getByRole("button", { name: "返回错题列表" }).click();

  await openMobileModule(page, "开始复盘");
  await expect(page.locator(".chrome-topbar").getByText("错题复盘", { exact: true })).toBeVisible();
  await expect(page.locator(".review-session-actions")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p1-review-mobile.png"), fullPage: false });

  await openMobileModule(page, "学习数据");
  await page.getByRole("button", { name: "知识演进与 Obsidian" }).click();
  await expect(page.locator(".chrome-topbar").getByText("知识库", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p1-knowledge-mobile.png"), fullPage: false });
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByRole("dialog", { name: "应用导航" }).getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await openMobileModule(page, "学习数据");
  await page.getByRole("button", { name: "批量管理" }).click();
  await page.screenshot({ path: testInfo.outputPath("p1-mistakes-mobile-dark.png"), fullPage: false });
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
