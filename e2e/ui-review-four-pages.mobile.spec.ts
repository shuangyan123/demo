import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/**
 * PRE-EXISTING MOBILE E2E DEBT EXPOSED BY RESTORED ACTIONS EXECUTION:
 * import is a dashboard next action, not a normal study-module entry.
 */
async function openStudyModule(drawer: Locator, label: string) {
  await drawer.evaluate((element, targetLabel) => {
    for (const details of element.querySelectorAll("details")) details.open = true;
    const target = [...element.querySelectorAll("button")].find((button) => button.textContent?.trim() === targetLabel);
    if (!(target instanceof HTMLButtonElement)) throw new Error(`未找到模块入口：${targetLabel}`);
    target.click();
  }, label);
}

async function openDrawer(page: Page) {
  const drawer = page.locator(".chrome-sidebar");
  const activeDrawer = page.getByRole("dialog", { name: "应用导航" });
  if (!await activeDrawer.isVisible()) await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(activeDrawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(-0.5);
  return drawer;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("四页审查数据在 390×844 保持移动步骤、详情层与完整操作", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/?ui-review=1");
  const drawer = await openDrawer(page);
  await drawer.locator(".sample-scenario-trigger").dispatchEvent("click");
  const loadAll = drawer.locator("button").filter({ hasText: "载入完整数据" });
  await loadAll.click();
  await expect(loadAll).toBeDisabled();
  await expect(loadAll).toHaveCount(0, { timeout: 80_000 });
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();

  const mobileDrawer = page.getByRole("dialog", { name: "应用导航" });
  await page.keyboard.press("Escape");
  await expect(mobileDrawer).toBeHidden();
  await page.getByRole("region", { name: "公考学习链路" }).getByRole("button", { name: /^粉笔导入/ }).click();
  await expect(page.getByRole("heading", { name: "导入", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1 来源" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2 草稿" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3 确认" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(process.cwd(), "docs/design/ui-review-four-pages/import-console-390.png"), fullPage: false });

  await page.reload();
  const pluginDrawer = await openDrawer(page);
  await pluginDrawer.getByRole("button", { name: "设置", exact: true }).dispatchEvent("click");
  await page.getByRole("combobox", { name: "设置分区" }).selectOption("installed-plugins");
  await page.getByRole("button", { name: "Obsidian Vault 本地 Vault 双向知识同步", exact: true }).click();
  await expect(page.getByRole("region", { name: "Obsidian Vault 详情" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const learningDrawer = await openDrawer(page);
  await openStudyModule(learningDrawer, "错题库");
  await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "当前薄弱项" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const settingsDrawer = await openDrawer(page);
  await settingsDrawer.getByRole("button", { name: "设置", exact: true }).dispatchEvent("click");
  await page.getByRole("combobox", { name: "设置分区" }).selectOption("configuration");
  await expect(page.getByRole("region", { name: "已保存连接" }).getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "删除" })).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(process.cwd(), "docs/design/ui-review-four-pages/ai-connections-390.png"), fullPage: false });
  const reviewDrawer = await openDrawer(page);
  await reviewDrawer.locator(".sample-scenario-trigger").dispatchEvent("click");
  await page.screenshot({ path: path.join(process.cwd(), "docs/design/ui-review-four-pages/settings-review-launcher-390.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
