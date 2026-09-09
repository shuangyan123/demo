import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 仅在原生详情未展开时打开侧栏分组。 */
async function ensureDetailsOpen(summary: Locator) {
  await summary.waitFor({ state: "visible" });
  if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}

/** 从桌面侧栏进入公考模块。 */
async function openDesktopModule(page: Page, name: string) {
  const sidebar = page.locator(".chrome-sidebar:visible");
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "公考" }).first());
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "学习" }).first());
  await sidebar.getByRole("button", { name }).click();
}

/** 用真实表单创建薄弱分析所需的基础错题。 */
async function createMistake(page: Page) {
  await page.locator(".dashboard-configuration-health > summary").click();
  await page.locator(".dashboard-configuration-health").getByRole("button", { name: "手动录入" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "保存错题" }) });
  await form.getByLabel("板块").selectOption("判断推理");
  await form.getByLabel("来源").fill("P3 验收");
  await form.getByLabel("题干").fill("P3 薄弱分析证据题");
  await form.getByLabel("答案").fill("A");
  await form.getByLabel("错因").fill("审题偏差");
  await form.getByRole("button", { name: "保存错题" }).click();
}

test("P3 桌面薄弱分析、插件检查器与命令搜索保持真实状态", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await createMistake(page);

  await openDesktopModule(page, "错题库");
  await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "薄弱分析", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "数据不足" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p3-insights-desktop.png"), fullPage: false });

  const searchTrigger = page.locator(".chrome-sidebar:visible").getByRole("button", { name: "搜索" });
  await searchTrigger.click();
  const palette = page.getByRole("dialog", { name: "搜索聊天或运行命令" });
  await expect(palette).toBeVisible();
  const commandInput = palette.getByRole("textbox");
  await commandInput.fill("插件");
  const commandFocus = await commandInput.evaluate((element) => {
    const inputStyle = getComputedStyle(element);
    const rowStyle = getComputedStyle(element.parentElement!);
    return {
      borderBottomWidth: inputStyle.borderBottomWidth,
      borderLeftWidth: inputStyle.borderLeftWidth,
      borderRightWidth: inputStyle.borderRightWidth,
      borderTopWidth: inputStyle.borderTopWidth,
      boxShadow: inputStyle.boxShadow,
      outlineStyle: inputStyle.outlineStyle,
      rowBackground: rowStyle.backgroundColor,
    };
  });
  expect(commandFocus).toMatchObject({
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    borderTopWidth: "0px",
    boxShadow: "none",
    outlineStyle: "none",
  });
  expect(commandFocus.rowBackground).not.toBe("rgba(0, 0, 0, 0)");
  await expect(palette.getByRole("button", { name: /插件/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(searchTrigger).toBeFocused();

  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "插件" }).click();
  await expect(page.getByRole("heading", { name: "插件市场", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath("p3-plugins-list-desktop.png"), fullPage: false });

  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "设置" }).click();
  const settingsSidebar = page.locator('[data-sidebar-kind="settings"]:visible');
  await expect(settingsSidebar).toBeVisible();
  await settingsSidebar.getByRole("button", { name: "插件", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已安装插件", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Obsidian Vault 本地 Vault 双向知识同步", exact: true }).click();
  await expect(page.getByText("本地数据边界")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Obsidian 知识图谱" })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath("p3-plugins-desktop.png"), fullPage: false });

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
