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

test("移动端 SummaryPopover 保持紧凑，ContextPanel 使用 drawer 且焦点可恢复", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const summaryTrigger = page.getByRole("button", { name: "查看当前工作区摘要" });
  const contextToggle = page.getByRole("button", { name: "显示上下文面板" });
  await summaryTrigger.click();
  const summary = page.locator('[data-summary-popover-surface="true"]');
  await expect(summary).toBeVisible();
  const summaryWidth = await summary.evaluate((element) => element.getBoundingClientRect().width);
  expect(summaryWidth).toBeLessThanOrEqual(374);

  await contextToggle.click();
  const panel = page.locator('[data-context-panel="true"]');
  const backdrop = page.locator('[data-context-panel-backdrop="true"]');
  await expect(panel).toBeVisible();
  await expect(backdrop).toBeVisible();
  await expect(panel).toHaveCSS("position", "fixed");
  await expect(panel.getByRole("button", { name: "关闭上下文面板" })).toBeFocused();
  await expect(summary).toBeHidden();

  await summaryTrigger.click();
  await expect(summary).toBeVisible();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(contextToggle).toBeFocused();
  await expectNoHorizontalOverflow(page);

  await contextToggle.click();
  await panel.getByRole("button", { name: "关闭上下文面板" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(contextToggle).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("workspace-context-mobile.png"), fullPage: false });

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
