import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 通过真实表单创建一条今日可复盘错题，避免测试依赖预置数据库。 */
async function createMistake(page: Page) {
  await page.locator(".dashboard-configuration-health > summary").click();
  await page.locator(".dashboard-configuration-health").getByRole("button", { name: "手动录入" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存错题" }) });
  await form.getByLabel("板块").selectOption("资料分析");
  await form.getByLabel("来源").fill("P1 视觉回归");
  await form.getByLabel("题干").fill("某地区今年产值增长 12%，基期应如何计算？");
  await form.getByLabel("答案").fill("现期值除以 1.12");
  await form.getByLabel("错因").fill("基期公式混淆");
  await form.getByLabel("解析").fill("先识别现期与增长率，再使用基期量等于现期量除以一加增长率。 ");
  await form.getByRole("button", { name: "保存错题" }).click();
  await expect(page.getByText("错题已保存到 IndexedDB")).toBeVisible();
}

/** 仅在原生详情未展开时点击 summary，避免重复导航时反向收起项目树。 */
async function ensureDetailsOpen(summary: Locator) {
  const open = await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open);
  if (!open) await summary.click();
}

/** 从桌面侧栏进入指定公考模块。 */
async function openDesktopModule(page: Page, name: string) {
  const sidebar = page.locator(".chrome-sidebar:visible");
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "公考" }).first());
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "学习" }).first());
  await sidebar.getByRole("button", { name }).click();
}

test("P1 桌面错题、复盘和知识工作区保持紧凑主从布局", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await createMistake(page);

  await openDesktopModule(page, "错题库");
  await page.getByRole("button", { name: "批量管理" }).click();
  await expect(page.getByRole("button", { name: "返回统一浏览" })).toBeVisible();
  await expect(page.locator(".learning-master-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: /某地区今年产值增长/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p1-mistakes-desktop.png"), fullPage: false });

  await openDesktopModule(page, "错题复盘");
  await expect(page.getByRole("heading", { name: "错题复盘" })).toBeVisible();
  await page.getByRole("button", { name: "查看答案" }).click();
  await expect(page.getByText("现期值除以 1.12")).toBeVisible();
  await expect(page.locator(".review-session-rail")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p1-review-desktop.png"), fullPage: false });

  await openDesktopModule(page, "错题库");
  await page.getByRole("button", { name: "知识演进与 Obsidian" }).click();
  const knowledgeForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存到知识库" }) });
  await knowledgeForm.getByLabel("标题").fill("增长率与基期量换算");
  await knowledgeForm.getByLabel("正文").fill("基期量等于现期量除以一加增长率。 ");
  await knowledgeForm.getByRole("button", { name: "保存到知识库" }).click();
  await expect(page.getByRole("heading", { name: "知识库", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "知识库", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /增长率与基期量换算/ })).toBeVisible();
  await expect(page.locator(".learning-master-detail")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p1-knowledge-desktop.png"), fullPage: false });

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
