import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { configureCustomTextConnection } from "./helpers/configure-custom-ai";

test("AI 连接可保存本地自定义文本连接并设为默认", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();

  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await configureCustomTextConnection(page, { label: "E2E 本地文本连接", baseUrl: "http://127.0.0.1:9999/v1", model: "local-e2e-model" });

  await expect(page.getByRole("status")).toContainText("配置已保存");
  await expect(page.getByRole("button", { name: /E2E 本地文本连接/ })).toBeVisible();
  await page.getByLabel("默认文本").selectOption({ label: "E2E 本地文本连接" });
  await expect(page.getByLabel("默认文本")).toHaveValue(/.+/);

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
