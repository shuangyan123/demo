import { expect, test, type Locator, type Page } from "@playwright/test";

async function ensureOpen(summary: Locator) {
  if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  return page.getByRole("dialog");
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("四页审查数据在 390×844 保持移动步骤、详情层与完整操作", async ({ page }) => {
  await page.goto("/");
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "载入完整数据" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();

  await page.getByRole("button", { name: "导入资料" }).first().click();
  await expect(page.getByRole("button", { name: "1 来源" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2 草稿" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3 确认" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const pluginDrawer = await openDrawer(page);
  await pluginDrawer.getByRole("button", { name: "插件", exact: true }).click();
  await expect(page.getByRole("complementary", { name: /详情/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const learningDrawer = await openDrawer(page);
  await ensureOpen(learningDrawer.locator("summary").filter({ hasText: "公考" }).first());
  await ensureOpen(learningDrawer.locator("summary").filter({ hasText: "模块" }).first());
  await learningDrawer.getByRole("button", { name: "学习数据" }).click();
  await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "优先改进" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const settingsDrawer = await openDrawer(page);
  await settingsDrawer.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("combobox", { name: "设置分区" }).selectOption("configuration");
  await expect(page.getByRole("region", { name: "已保存连接" }).getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "删除" })).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
});
