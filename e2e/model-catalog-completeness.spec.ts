import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { startMockAiProvider } from "./helpers/mock-ai-provider";
import { openConnectionEditor } from "./helpers/configure-custom-ai";

test.setTimeout(60_000);

/**
 * 验证连接测试与默认能力共用完整目录，当前选择不会把其他候选过滤掉。
 */
test("Google 完整模型目录可在连接测试和默认能力中重复选择", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const provider = await startMockAiProvider({
    protocol: "google_generate_content",
    models: ["gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await (await openConnectionEditor(page)).click();
    await page.getByRole("option", { name: /Google Gemini/ }).click();

    await page.getByText("高级设置", { exact: true }).click();
    await page.getByLabel("连接名称").fill("E2E Gemini 完整目录");
    await page.getByLabel("Base URL").fill(provider.baseUrl);
    await page.getByLabel("API Key").fill("fixture-key");
    await page.getByRole("button", { name: "获取模型" }).click();
    await expect(page.getByRole("status")).toContainText("已获取");

    const testModel = page.getByRole("combobox", { name: "测试模型 ID" });
    await testModel.click();
    await expect(page.getByRole("option", { name: /^gemini-3\.5-flash$/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /^gemini-2\.5-pro$/i })).toBeVisible();
    await page.getByRole("option", { name: /^gemini-2\.5-flash$/i }).click();

    await testModel.click();
    await page.getByRole("textbox", { name: "搜索测试模型 ID" }).fill("gemini");
    await expect(page.getByRole("option", { name: /^gemini-3\.5-flash$/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /^gemini-2\.5-pro$/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /^gemini-2\.5-flash$/i })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(page.getByRole("status")).toContainText("配置已保存");
    await page.getByRole("combobox", { name: "默认文本连接" }).click();
    await page.getByRole("option", { name: /E2E Gemini 完整目录/ }).click();
    const defaultModel = page.getByRole("combobox", { name: "默认文本模型" });
    await defaultModel.click();
    await expect(page.getByRole("option", { name: /^gemini-3\.5-flash$/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /^gemini-2\.5-pro$/i })).toBeVisible();
    await expect(page.getByRole("option", { name: /^gemini-2\.5-flash$/i })).toBeVisible();

    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});
