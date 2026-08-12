import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("内置插件停用后设置面板立即阻断后续操作并保留数据提示", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "插件" }).click();
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
