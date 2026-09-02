import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout-assertions";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function ensureDetailsOpen(summary: Locator): Promise<void> {
  const open = await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open);
  if (!open) await summary.click();
}

async function openMobileProjectModules(page: Page): Promise<Locator> {
  const drawer = page.getByRole("dialog", { name: "应用导航", exact: true });
  if (!(await drawer.isVisible())) await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await expect(drawer).toBeVisible();
  await ensureDetailsOpen(drawer.locator("summary.workspace-project-row"));
  await ensureDetailsOpen(drawer.locator('summary[data-study-module-header="true"]'));
  return drawer.locator(".app-sidebar-shell");
}

test("移动端模块弹窗保留抽屉、支持添加管理并保持无横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();

  let sidebar = await openMobileProjectModules(page);
  await expect(sidebar.locator(".workspace-project-row").getByRole("button")).toHaveCount(0);
  await sidebar.getByRole("button", { name: "添加公考模块", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "添加模块到「公考」", exact: true });
  await expect(addDialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("module-management-mobile-add.png"), fullPage: false });
  const addBounds = await addDialog.boundingBox();
  expect(addBounds).not.toBeNull();
  expect(addBounds!.x).toBeGreaterThanOrEqual(0);
  expect(addBounds!.y).toBeGreaterThanOrEqual(0);
  expect(addBounds!.x + addBounds!.width).toBeLessThanOrEqual(390);
  expect(addBounds!.y + addBounds!.height).toBeLessThanOrEqual(844);
  await expectNoHorizontalOverflow(page);

  await page.keyboard.press("Escape");
  await expect(addDialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "应用导航", exact: true })).toBeVisible();

  await sidebar.getByRole("button", { name: "添加公考模块", exact: true }).click();
  await addDialog.getByRole("button", { name: "添加 薄弱分析", exact: true }).click();
  await expect(addDialog.getByRole("button", { name: "薄弱分析 已添加", exact: true })).toBeDisabled();
  await addDialog.getByRole("button", { name: "关闭添加模块", exact: true }).click();
  await expect(addDialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "应用导航", exact: true })).toBeVisible();

  sidebar = await openMobileProjectModules(page);
  await expect(sidebar.getByRole("button", { name: "薄弱分析", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "薄弱分析", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "应用导航", exact: true })).toBeHidden();
  await expect(page.locator(".workspace-view-header").getByRole("heading", { name: "薄弱分析", exact: true })).toBeVisible();

  sidebar = await openMobileProjectModules(page);
  await sidebar.getByRole("button", { name: "管理公考模块", exact: true }).click();
  const manageDialog = page.getByRole("dialog", { name: "管理「公考」模块", exact: true });
  await expect(manageDialog).toBeVisible();
  await manageDialog.getByRole("button", { name: "移除 薄弱分析", exact: true }).click();
  await expect(manageDialog.locator('[data-study-module-row][data-study-module-id="stats"]')).toHaveCount(0);
  await manageDialog.getByRole("button", { name: "关闭模块管理", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "应用导航", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
