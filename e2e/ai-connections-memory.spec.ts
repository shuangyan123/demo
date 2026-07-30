import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { startMockAiProvider } from "./helpers/mock-ai-provider";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 打开设置中的 AI 连接页。 */
async function openConnections(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
}

test("编辑草稿测试使用新地址，紧凑结果卡不渲染对话栏", async ({ page }, testInfo) => {
  const oldProvider = await startMockAiProvider({ protocol: "openai_responses", models: ["gpt-5.5"], response: "OK", responseDelayMs: 1_000 });
  const newProvider = await startMockAiProvider({ protocol: "openai_responses", models: ["gpt-5.5"], response: "OK" });
  const runtimeErrors = collectRuntimeErrors(page);
  try {
    await openConnections(page);
    await page.getByRole("combobox", { name: "厂商" }).click();
    await page.getByRole("option", { name: "OpenAI", exact: true }).click();
    await page.getByText("高级设置", { exact: true }).click();
    await page.getByLabel("连接名称").fill("E2E 编辑测试");
    await page.getByLabel("Base URL").fill(oldProvider.baseUrl);
    await page.getByLabel("API Key").fill("old-key");
    await page.getByRole("button", { name: "获取模型" }).click();
    await expect(page.getByRole("combobox", { name: "测试模型 ID" })).toContainText("gpt-5.5");
    await page.getByRole("button", { name: "测试连接" }).click();
    const card = page.getByRole("region", { name: "连接测试结果" });
    await expect(card).toBeVisible();
    await expect(card.getByText("进行中", { exact: true })).toHaveCount(1);
    const cardBox = await card.boundingBox();
    expect(cardBox?.width).toBeGreaterThanOrEqual(350);
    expect(cardBox?.width).toBeLessThanOrEqual(354);
    await expect(card.getByRole("navigation")).toHaveCount(0);
    await expect(card.getByRole("textbox")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("compact-ai-test-card-desktop.png"), fullPage: false });
    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(page.getByRole("status")).toContainText("配置已保存");

    const oldPostCount = oldProvider.requests.filter((request) => request.method === "POST").length;
    await page.getByLabel("Base URL").fill(newProvider.baseUrl);
    await page.getByLabel("API Key").fill("new-key");
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect.poll(() => newProvider.requests.filter((request) => request.method === "POST").length).toBe(1);
    expect(oldProvider.requests.filter((request) => request.method === "POST").length).toBe(oldPostCount);
    await expect(page.getByRole("button", { name: "编辑" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "测试", exact: true }).first()).toBeVisible();
    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await oldProvider.stop();
    await newProvider.stop();
  }
});

test("Gemini 多模态默认模型把图片发送为 inlineData", async ({ page }) => {
  const provider = await startMockAiProvider({ protocol: "google_generate_content", models: ["gemini-2.5-flash"], response: "图片已识别" });
  const runtimeErrors = collectRuntimeErrors(page);
  try {
    await openConnections(page);
    await page.getByRole("combobox", { name: "厂商" }).click();
    await page.getByRole("option", { name: "Google Gemini", exact: true }).click();
    await page.getByText("高级设置", { exact: true }).click();
    await page.getByLabel("连接名称").fill("E2E Gemini");
    await page.getByLabel("Base URL").fill(provider.baseUrl);
    await page.getByLabel("API Key").fill("gemini-key");
    await page.getByRole("button", { name: "获取模型" }).click();
    // 在线目录会与 Interactions-only 静态模型合并，测试显式选择 GenerateContent 模型而不依赖排序。
    const testModel = page.getByRole("combobox", { name: "测试模型 ID" });
    await testModel.click();
    await page.getByRole("option", { name: "gemini-2.5-flash", exact: true }).click();
    await expect(testModel).toContainText("gemini-2.5-flash");
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByRole("status")).toContainText("连接成功");
    await page.getByRole("button", { name: "保存连接" }).click();
    await page.getByRole("combobox", { name: "默认多模态连接" }).click();
    await page.getByRole("option", { name: "E2E Gemini", exact: true }).click();
    await page.getByRole("combobox", { name: "默认多模态模型" }).click();
    await page.getByRole("option", { name: "gemini-2.5-flash", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "默认多模态模型" })).toContainText("gemini-2.5-flash");

    await page.getByRole("button", { name: "返回应用" }).click();
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4QAAAABJRU5ErkJggg==", "base64"),
    });
    await expect(page.getByRole("button", { name: "选择模型" })).toContainText("gemini-2.5-flash");
    await page.getByRole("textbox", { name: "对话输入" }).fill("描述这张图片");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("图片已识别").last()).toBeVisible();
    await expect(page.getByText("工具链", { exact: true })).toHaveCount(0);
    const request = provider.requests.findLast((item) => item.method === "POST" && item.url?.includes("streamGenerateContent"));
    const body = request?.body as { contents?: Array<{ parts?: Array<Record<string, unknown>> }> };
    expect(body.contents?.some((content) => content.parts?.some((part) => "inlineData" in part))).toBe(true);
    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});

test("个性化记忆刷新后恢复，数据管理使用独立危险确认", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "个性化" }).click();
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  await page.getByRole("button", { name: "添加记忆" }).click();
  const editor = page.getByRole("dialog", { name: "添加记忆" });
  await editor.getByLabel("标题").fill("回答风格");
  await editor.getByLabel("内容").fill("先给结论，再解释关键依据");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("回答风格")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "个性化" }).click();
  await page.getByRole("button", { name: "记忆", exact: true }).click();
  await expect(page.getByText("回答风格")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("personalization-memory-desktop.png"), fullPage: false });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("personalization-memory-zoom-200.png"), fullPage: false });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await page.getByRole("button", { name: "诊断" }).click();
  await expect(page.getByText("数据管理", { exact: true })).toBeVisible();
  const resetRow = page.getByText("完整重置（所有数据）", { exact: true }).locator("..");
  await resetRow.getByRole("button", { name: "清除" }).click();
  const dialog = page.getByRole("dialog", { name: "完整重置（所有数据）" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "完整重置" })).toBeDisabled();
  await dialog.getByLabel("请输入“完整重置”以继续").fill("完整重置");
  await expect(dialog.getByRole("button", { name: "完整重置" })).toBeEnabled();
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.y).toBeGreaterThanOrEqual(16);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(1008);
  await page.screenshot({ path: testInfo.outputPath("diagnostics-data-management-desktop.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
