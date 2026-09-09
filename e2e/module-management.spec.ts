import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout-assertions";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function ensureDetailsOpen(summary: Locator): Promise<void> {
  const open = await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open);
  if (!open) await summary.click();
}

async function openProjectModules(page: Page): Promise<Locator> {
  const sidebar = page.locator(".app-sidebar-shell");
  await ensureDetailsOpen(sidebar.locator("summary.workspace-project-row"));
  await ensureDetailsOpen(sidebar.locator('summary[data-study-module-header="true"]'));
  return sidebar;
}

test("项目模块可添加、移除、恢复默认并在当前模块移除时回到总览", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();

  let sidebar = await openProjectModules(page);
  await expect(sidebar.locator(".workspace-project-row").getByRole("button")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "管理公考模块", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "添加公考模块", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "粉笔练习", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "粉笔导入", exact: true })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "添加公考模块", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "添加模块到「公考」", exact: true });
  await expect(addDialog).toBeVisible();
  await expect(addDialog.locator("[data-study-module-row]")).toHaveCount(10);
  await page.screenshot({ path: testInfo.outputPath("module-management-desktop-add.png"), fullPage: false });
  await expect(addDialog.getByRole("button", { name: "粉笔练习 已添加", exact: true })).toBeDisabled();
  await expect(addDialog.getByRole("button", { name: "添加 粉笔导入", exact: true })).toBeVisible();
  await expect(addDialog.getByRole("button", { name: "关闭添加模块", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(addDialog).toBeHidden();
  await expect(sidebar.getByRole("button", { name: "添加公考模块", exact: true })).toBeFocused();

  await sidebar.getByRole("button", { name: "添加公考模块", exact: true }).click();
  await addDialog.getByRole("button", { name: "添加 粉笔导入", exact: true }).click();
  await expect(addDialog.getByRole("button", { name: "粉笔导入 已添加", exact: true })).toBeDisabled();
  await addDialog.getByRole("button", { name: "关闭添加模块", exact: true }).click();
  await expect(addDialog).toBeHidden();

  sidebar = await openProjectModules(page);
  await expect(sidebar.getByRole("button", { name: "粉笔导入", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "粉笔导入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "导入", exact: true })).toBeVisible();

  sidebar = await openProjectModules(page);
  await sidebar.getByRole("button", { name: "管理公考模块", exact: true }).click();
  const manageDialog = page.getByRole("dialog", { name: "管理「公考」模块", exact: true });
  await expect(manageDialog).toBeVisible();
  const dashboardRow = manageDialog.locator('[data-study-module-row][data-study-module-id="dashboard"]');
  await expect(dashboardRow).toContainText("始终保留");
  await expect(dashboardRow.getByRole("button", { name: /移除/ })).toHaveCount(0);
  await manageDialog.getByRole("button", { name: "移除 粉笔导入", exact: true }).click();
  await expect(manageDialog.locator('[data-study-module-row][data-study-module-id="import"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();
  await manageDialog.getByRole("button", { name: "关闭模块管理", exact: true }).click();

  sidebar = await openProjectModules(page);
  await expect(sidebar.getByRole("button", { name: "粉笔导入", exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "管理公考模块", exact: true }).click();
  await manageDialog.getByRole("button", { name: "移除 错题库", exact: true }).click();
  await expect(manageDialog.locator('[data-study-module-row][data-study-module-id="library"]')).toHaveCount(0);
  await manageDialog.getByRole("button", { name: "恢复默认模块", exact: true }).click();
  await expect(manageDialog.locator('[data-study-module-row][data-study-module-id="library"]')).toBeVisible();
  await manageDialog.getByRole("button", { name: "关闭模块管理", exact: true }).click();

  sidebar = await openProjectModules(page);
  await expect(sidebar.getByRole("button", { name: "错题库", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "粉笔导入", exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
