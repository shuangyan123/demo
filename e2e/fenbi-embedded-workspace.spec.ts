import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function openFenbiModule(page: Page): Promise<void> {
  const sidebar = page.locator(".app-sidebar-shell");
  const moduleButton = sidebar.getByRole("button", { name: "粉笔练习", exact: true });
  if (!(await moduleButton.isVisible())) {
    await sidebar.locator("summary.workspace-project-row").click();
    await sidebar.getByText("模块", { exact: true }).click();
  }
  await moduleButton.click();
}

test("粉笔练习进入公考模块并连接现有 SummaryPopover/ContextPanel", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();

  await openFenbiModule(page);
  await expect(page.locator('[data-fenbi-workspace="true"]')).toBeVisible();
  await expect(page.locator('[data-fenbi-browser-fallback="true"]').getByText("粉笔嵌入仅桌面版可用", { exact: true })).toBeVisible();
  await expect(page.locator('[data-main-content-width="wide"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const summaryTrigger = page.getByRole("button", { name: "查看当前工作区摘要" });
  await summaryTrigger.click();
  const summary = page.locator('[data-summary-popover-surface="true"]');
  await expect(summary).toContainText("粉笔练习");
  await page.keyboard.press("Escape");

  const contextToggle = page.getByRole("button", { name: "显示上下文面板" });
  await contextToggle.click();
  const panel = page.locator('[data-context-panel="true"]');
  await expect(panel).toHaveAttribute("data-context-panel-content-id", "fenbi");
  await expect(panel).toContainText("粉笔");
  await expect(panel.getByRole("button", { name: "回到粉笔首页" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "打开粉笔导入" })).toBeVisible();
  await expect(panel).not.toContainText("自动同步错题");

  await summaryTrigger.click();
  await expect(summary).toBeVisible();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
  await panel.getByRole("button", { name: "关闭上下文面板" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");

  await page.locator(".app-sidebar-shell").getByRole("button", { name: "总览", exact: true }).click();
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();
  await openFenbiModule(page);
  await expect(page.locator('[data-fenbi-workspace="true"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
