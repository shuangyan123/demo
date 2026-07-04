import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("配置健康面板展示新库缺项并可导航到补齐入口", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await expect(page.getByRole("heading", { name: "配置健康" })).toBeVisible();
  await expect(page.getByText(/项待配置/)).toBeVisible();
  await expect(page.getByText("默认文本连接未配置")).toBeVisible();
  await expect(page.getByText("尚未连接 Obsidian Vault")).toBeVisible();
  await expect(page.getByText("尚未创建自动化任务")).toBeVisible();
  await expect(page.getByText("还没有学习资料")).toBeVisible();

  await page.locator("section").filter({ has: page.getByRole("heading", { name: "配置健康" }) }).first().getByRole("button", { name: "配置 AI 连接" }).click();
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.goto("/");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "配置健康" }) }).first().getByRole("button", { name: "连接 Obsidian" }).click();
  await expect(page.getByText("Obsidian 知识图谱")).toBeVisible();
  await expect(page.getByRole("button", { name: "连接 Vault 文件夹" })).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.goto("/");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "配置健康" }) }).first().getByRole("button", { name: "设置自动化" }).click();
  await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
  await expect(page.getByText("新建自动化")).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.goto("/");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "配置健康" }) }).first().getByRole("button", { name: "导入资料" }).click();
  await expect(page.getByRole("button", { name: "生成资料草稿" })).toBeVisible();
  await expectNoFrameworkOverlay(page);

  await page.goto("/");
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "配置健康" }) }).first().getByRole("button", { name: "手动录入" }).click();
  await expect(page.getByRole("button", { name: "保存错题" })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
