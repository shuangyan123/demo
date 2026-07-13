import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  failNextConversationModelWrite,
  installConversationModelWriteFailureHook,
  readConversationModelSelection,
  seedConversationModelFixtures,
} from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 打开指定持久化对话的模型菜单，避免依赖会话排序。 */
async function openConversationModelPicker(page: Page, conversationId: string): Promise<Locator> {
  await page.locator(`[data-conversation-id="${conversationId}"] .conversation-tree-chat-label`).click();
  await page.getByRole("button", { name: "选择模型" }).click();
  return page.getByRole("dialog", { name: "选择对话模型" });
}

/** 宽度规格允许浏览器子像素和边框产生 2px 误差。 */
async function expectPickerWidth(picker: Locator, expected: number): Promise<void> {
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeGreaterThanOrEqual(expected - 2);
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeLessThanOrEqual(expected + 2);
}

/** 连续 Tab 到弹层之外，验证关闭逻辑不会把焦点强制抢回触发器。 */
async function tabOutOfPicker(page: Page, picker: Locator): Promise<void> {
  for (let index = 0; index < 30 && await picker.isVisible(); index += 1) await page.keyboard.press("Tab");
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).not.toBeFocused();
}

test("桌面模型菜单按层紧凑变宽，并保持键盘、tooltip 与焦点语义", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "picker-openai", label: "E2E OpenAI", provider: "openai", apiFormat: "responses" },
    { id: "picker-google", label: "E2E Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [
    { id: "picker-openai-chat", title: "模型宽度 OpenAI", connectionId: "picker-openai", modelId: "gpt-5.5" },
    { id: "picker-google-chat", title: "模型宽度 Gemini", connectionId: "picker-google", modelId: "gemini-2.5-pro" },
  ]);
  await page.reload();

  const openAiPicker = await openConversationModelPicker(page, "picker-openai-chat");
  await expect(openAiPicker).toHaveAttribute("data-model-picker-view", "providers");
  await expectPickerWidth(openAiPicker, 208);
  await openAiPicker.getByRole("button", { name: "OpenAI" }).click();
  await expect(openAiPicker).toHaveAttribute("data-model-picker-view", "models");
  await expectPickerWidth(openAiPicker, 240);

  const selectedModel = openAiPicker.getByRole("radio", { name: /gpt-5\.5/ });
  await expect(selectedModel).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(selectedModel).toHaveAttribute("aria-describedby", /.+/);
  await page.keyboard.press("ArrowDown");
  await expect(openAiPicker.getByRole("radio", { name: /gpt-5\.6-sol/ })).toBeFocused();

  const reasoningEntry = openAiPicker.getByRole("button", { name: /推理/ });
  await reasoningEntry.click();
  await expect(openAiPicker).toHaveAttribute("data-model-picker-view", "reasoning");
  await expectPickerWidth(openAiPicker, 160);
  const selectedReasoning = openAiPicker.getByRole("radio", { checked: true });
  await expect(selectedReasoning).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const nextReasoning = openAiPicker.getByRole("radio", { name: "high", exact: true });
  await expect(nextReasoning).toBeFocused();
  await expect(nextReasoning).toBeChecked();
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-openai-chat")).runtime?.reasoning).toBe("high");
  await openAiPicker.getByRole("button", { name: "返回模型" }).click();
  await expect(reasoningEntry).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(openAiPicker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toBeFocused();

  const tabPicker = await openConversationModelPicker(page, "picker-openai-chat");
  await tabOutOfPicker(page, tabPicker);

  const geminiPicker = await openConversationModelPicker(page, "picker-google-chat");
  await geminiPicker.getByRole("button", { name: "Google Gemini" }).click();
  await geminiPicker.getByRole("button", { name: /推理/ }).click();
  await expect(geminiPicker).toHaveAttribute("data-model-picker-view", "reasoning");
  await expectPickerWidth(geminiPicker, 200);
  const budget = geminiPicker.getByRole("spinbutton", { name: "自定义推理预算" });
  await budget.fill("12000");
  await budget.press("ArrowUp");
  await budget.press("Tab");
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-google-chat")).runtime?.reasoning).toBe(12001);
  await expect(geminiPicker).toBeHidden();

  await page.getByRole("button", { name: "选择模型" }).click();
  await geminiPicker.getByRole("button", { name: "Google Gemini" }).click();
  await geminiPicker.getByRole("button", { name: /推理/ }).click();
  await geminiPicker.getByRole("spinbutton", { name: "自定义推理预算" }).fill("13000");
  await page.keyboard.press("Escape");
  await expect(geminiPicker).toBeHidden();
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-google-chat")).runtime?.reasoning).toBe(13000);

  await page.getByRole("button", { name: "选择模型" }).click();
  await geminiPicker.getByRole("button", { name: "Google Gemini" }).click();
  await geminiPicker.getByRole("button", { name: /推理/ }).click();
  await geminiPicker.getByRole("spinbutton", { name: "自定义推理预算" }).fill("14000");
  await page.getByRole("textbox", { name: "对话输入" }).click();
  await expect(geminiPicker).toBeHidden();
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-google-chat")).runtime?.reasoning).toBe(14000);

  await page.getByRole("button", { name: "选择模型" }).click();
  await geminiPicker.getByRole("button", { name: "Google Gemini" }).click();
  await geminiPicker.getByRole("button", { name: /推理/ }).click();

  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-desktop-light.png"), fullPage: false });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "返回应用" }).click();
  const darkPicker = await openConversationModelPicker(page, "picker-google-chat");
  await darkPicker.getByRole("button", { name: "Google Gemini" }).click();
  await darkPicker.getByRole("button", { name: /推理/ }).click();
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-desktop-dark.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("手动模型支持行尾提交与 Enter，普通选择无需全局确认", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "picker-custom", label: "E2E Custom", provider: "custom", apiFormat: "chat_completions" },
  ], [
    { id: "picker-custom-chat", title: "手动模型提交", connectionId: "picker-custom", modelId: "manual-initial" },
  ]);
  await page.reload();

  const picker = await openConversationModelPicker(page, "picker-custom-chat");
  await picker.getByRole("button", { name: "Local / Custom OpenAI compatible" }).click();
  const input = picker.getByRole("textbox", { name: "手动模型 ID" });
  await input.fill("manual-by-button");
  await picker.getByRole("button", { name: "使用手动模型" }).click();
  await expect(picker).toBeVisible();
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-custom-chat")).modelId).toBe("manual-by-button");

  await input.fill("manual-by-enter");
  await input.press("Enter");
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-custom-chat")).modelId).toBe("manual-by-enter");
  await expect(picker.getByText("使用此模型", { exact: true })).toHaveCount(0);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("未知或带后缀的 GLM 模型不展示猜测出的运行选项", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "unknown-glm", label: "E2E Unknown GLM", provider: "zhipu", apiFormat: "chat_completions" },
  ], [
    { id: "unknown-glm-chat", title: "未知 GLM", connectionId: "unknown-glm", modelId: "glm-5.2-custom" },
  ]);
  await page.reload();

  const picker = await openConversationModelPicker(page, "unknown-glm-chat");
  await picker.getByRole("button", { name: "GLM / 智谱" }).click();
  const unknownModel = picker.getByRole("radio", { name: /^glm-5\.2-custom/ });
  await expect(unknownModel).toBeChecked();
  await expect(picker.getByRole("button", { name: /推理|速度/ })).toHaveCount(0);
  await unknownModel.focus();
  await expect(page.getByRole("tooltip")).toContainText("运行参数尚未核验");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("持久化模型选择按对话隔离、连续点击以最后一次为准且失败回滚", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await installConversationModelWriteFailureHook(page);
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "state-openai", label: "E2E State OpenAI", provider: "openai", apiFormat: "responses" },
  ], [
    { id: "state-chat-a", title: "状态隔离 A", connectionId: "state-openai", modelId: "gpt-5.5" },
    { id: "state-chat-b", title: "状态隔离 B", connectionId: "state-openai", modelId: "gpt-5.5" },
  ]);
  await page.reload();

  let picker = await openConversationModelPicker(page, "state-chat-a");
  await picker.getByRole("button", { name: "OpenAI" }).click();
  await picker.getByRole("radio", { name: /gpt-5\.6-sol/ }).locator("xpath=..").click();
  await expect.poll(async () => (await readConversationModelSelection(page, "state-chat-a")).modelId).toBe("gpt-5.6-sol");

  await page.locator('[data-conversation-id="state-chat-b"] .conversation-tree-chat-label').click();
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("gpt-5.5");
  expect((await readConversationModelSelection(page, "state-chat-b")).modelId).toBe("gpt-5.5");

  picker = await openConversationModelPicker(page, "state-chat-b");
  await picker.getByRole("button", { name: "OpenAI" }).click();
  await picker.getByRole("radio", { name: /gpt-5\.6-sol/ }).locator("xpath=..").click();
  await picker.getByRole("radio", { name: /gpt-5\.6-terra/ }).locator("xpath=..").click();
  await expect.poll(async () => (await readConversationModelSelection(page, "state-chat-b")).modelId).toBe("gpt-5.6-terra");

  await page.keyboard.press("Escape");
  await page.reload();
  picker = await openConversationModelPicker(page, "state-chat-b");
  await picker.getByRole("button", { name: "OpenAI" }).click();
  await expect(picker.getByRole("radio", { name: /gpt-5\.6-terra/ })).toBeChecked();
  await failNextConversationModelWrite(page, "gpt-5.6-luna");
  await picker.getByRole("radio", { name: /gpt-5\.6-luna/ }).locator("xpath=..").click();
  await expect(page.getByText(/模型选择保存失败/).first()).toBeVisible();
  await expect(picker.getByRole("radio", { name: /gpt-5\.6-terra/ })).toBeChecked();
  expect((await readConversationModelSelection(page, "state-chat-b")).modelId).toBe("gpt-5.6-terra");

  await page.reload();
  await page.locator('[data-conversation-id="state-chat-b"] .conversation-tree-chat-label').click();
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("gpt-5.6-terra");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
