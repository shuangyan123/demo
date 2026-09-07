import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

const PLUGIN_SECTION_RENDER_TIMEOUT = 15_000;

async function openInstalledPlugins(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "设置" }).click();
  const settingsSidebar = page.locator(".settings-sidebar-shell:visible");
  await expect(settingsSidebar).toBeVisible({ timeout: PLUGIN_SECTION_RENDER_TIMEOUT });
  await settingsSidebar.getByRole("button", { name: "插件", exact: true }).click();
  // 设置区内容按 section 懒加载；等待已点击的真实面板完成渲染，不改变全局超时。
  await expect(page.getByRole("region", { name: "已安装插件管理" })).toBeVisible({ timeout: PLUGIN_SECTION_RENDER_TIMEOUT });
}

test("内置插件停用后设置面板立即阻断后续操作并保留数据提示", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openInstalledPlugins(page);
  await page.getByRole("button", { name: "Obsidian Vault 本地 Vault 双向知识同步", exact: true }).click();

  const detail = page.getByRole("region", { name: "Obsidian Vault 详情" });
  const enabled = detail.getByRole("checkbox", { name: "Obsidian Vault 启用状态" });
  await enabled.uncheck();
  await expect(detail.getByText("插件已停用", { exact: true })).toBeVisible();
  await expect(detail.getByText(/现有数据和配置仍保留/)).toBeVisible();

  await enabled.check();
  await expect(detail.getByRole("heading", { name: "Obsidian 知识图谱" })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("声明式主题扩展通过真实安装、启停和 reload 保持执行边界闭合", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openInstalledPlugins(page);
  await page.getByRole("button", { name: "插件市场" }).click();

  const themeRow = page.getByRole("listitem").filter({ hasText: "专注纸张" });
  await expect(themeRow).toBeVisible();
  await themeRow.getByRole("button", { name: "安装", exact: true }).click();

  const detail = page.getByRole("region", { name: "专注纸张 详情" });
  await expect(detail).toBeVisible();
  const enabled = detail.getByRole("checkbox", { name: "专注纸张 启用状态" });
  const initialBackground = await page.evaluate(() => document.documentElement.style.getPropertyValue("--background"));
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--background"))).toBe("#f7f4ec");

  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--background"))).toBe(initialBackground);

  await page.reload();
  await openInstalledPlugins(page);
  await page.getByRole("listitem").filter({ hasText: "专注纸张" }).getByRole("button").first().click();
  const reloadedDetail = page.getByRole("region", { name: "专注纸张 详情" });
  await expect(reloadedDetail.getByRole("checkbox", { name: "专注纸张 启用状态" })).not.toBeChecked();
  await expect(reloadedDetail.getByText("扩展已停用", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--background"))).toBe(initialBackground);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
