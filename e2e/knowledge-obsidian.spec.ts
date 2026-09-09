import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("知识库 Obsidian 桥接入口在未连接状态下可恢复展示", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("Recall");
  await page.locator(".dashboard-configuration-health > summary").click();
  await page.locator(".dashboard-configuration-health").getByRole("button", { name: "连接 Obsidian" }).click();

  await expect(page.getByText("Obsidian 知识图谱")).toBeVisible();
  await expect(page.getByLabel("Vault 托管目录")).toHaveValue("AI知识库");
  await expect(page.getByRole("button", { name: "连接 Vault 文件夹" })).toBeVisible();
  await expect(page.getByText("未连接 Vault")).toBeVisible();
  await expect(page.getByText(/权限/)).toBeVisible();
  await expect(page.getByText("一次性导入 Markdown 文件夹", { exact: true })).toBeVisible();
  await expect(page.getByText("AI 只会生成待确认提案，不会后台改写 Vault。")).toBeVisible();

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
