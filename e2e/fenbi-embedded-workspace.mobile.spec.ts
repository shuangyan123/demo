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

test("移动端粉笔练习与侧栏/ContextPanel drawer 维持遮挡状态", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await openFenbiModule(page);
  await expect(page.locator('[data-fenbi-browser-fallback="true"]').getByText("粉笔嵌入仅桌面版可用", { exact: true })).toBeVisible();

  const workspace = page.locator('[data-fenbi-workspace="true"]');
  const contextToggle = page.getByRole("button", { name: "显示上下文面板" });
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "false");

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "true");
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "false");

  await contextToggle.click();
  const panel = page.locator('[data-context-panel="true"]');
  await expect(panel).toHaveAttribute("data-context-panel-content-id", "fenbi");
  await expect(panel).toHaveCSS("position", "fixed");
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "true");

  const summaryTrigger = page.getByRole("button", { name: "查看当前工作区摘要" });
  await summaryTrigger.click();
  await expect(page.locator('[data-summary-popover-surface="true"]')).toBeVisible();
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-summary-popover-surface="true"]')).toBeHidden();
  await panel.getByRole("button", { name: "关闭上下文面板" }).click();
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "false");

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "true");
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(workspace).toHaveAttribute("data-native-surface-occluded", "false");
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
