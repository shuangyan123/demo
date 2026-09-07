import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  clearConversationModelConnections,
  failNextConversationModelWrite,
  installConversationModelWriteFailureHook,
  readConversationModelSelection,
  seedConversationModelFixtures,
} from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

const WINDOWS_COLD_START_TEST_TIMEOUT = 75_000;
const WINDOWS_COLD_START_READY_TIMEOUT = 60_000;

/** 打开指定持久化对话的模型菜单，避免依赖会话排序。 */
async function openConversationModelPicker(page: Page, conversationId: string): Promise<Locator> {
  await page.locator(`[data-conversation-id="${conversationId}"] .conversation-tree-chat-label`).click();
  await page.getByRole("button", { name: "选择模型" }).click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  // 桌面端厂商层由真实模型控制行的 hover 打开；初始弹层只展示 controls。
  await picker.getByRole("button", { name: /^模型 / }).hover();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  return picker;
}

/** 独立 surface 的宽度规格允许浏览器子像素和边框产生 2px 误差。 */
async function expectPickerWidth(picker: Locator, expected: number): Promise<void> {
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeGreaterThanOrEqual(expected - 2);
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeLessThanOrEqual(expected + 2);
}

async function expectSurfaceWidth(picker: Locator, surface: string, expected: number): Promise<void> {
  const locator = picker.locator(`[data-model-picker-surface="${surface}"]`);
  await expect.poll(async () => (await locator.boundingBox())?.width).toBeGreaterThanOrEqual(expected - 2);
  await expect.poll(async () => (await locator.boundingBox())?.width).toBeLessThanOrEqual(expected + 2);
}

/** 连续三帧确认菜单宽度与页面滚动高度稳定，防止换层时滚动条闪烁。 */
async function expectStablePickerFrames(picker: Locator): Promise<void> {
  const frames = await picker.evaluate(async (element) => {
    const values: Array<{ width: number; pageHeight: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      values.push({ width: element.getBoundingClientRect().width, pageHeight: document.documentElement.scrollHeight });
    }
    return values;
  });
  expect(new Set(frames.map((frame) => `${frame.width}:${frame.pageHeight}`)).size).toBe(1);
}

/** 连续 Tab 到弹层之外，验证关闭逻辑不会把焦点强制抢回触发器。 */
async function tabOutOfPicker(page: Page, picker: Locator): Promise<void> {
  for (let index = 0; index < 30 && await picker.isVisible(); index += 1) await page.keyboard.press("Tab");
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).not.toBeFocused();
}

test("桌面模型菜单保持稳定外框，并保留键盘、tooltip 与焦点语义", async ({ page }, testInfo) => {
  // Windows 冷启动可能让应用首屏数据初始化超过默认 30 秒；只扩展该测试的有限启动预算。
  test.setTimeout(WINDOWS_COLD_START_TEST_TIMEOUT);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "picker-openai", label: "E2E OpenAI", provider: "openai", apiFormat: "responses" },
    { id: "picker-google", label: "E2E Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [
    { id: "picker-openai-chat", title: "模型宽度 OpenAI", connectionId: "picker-openai", modelId: "gpt-5.5" },
    { id: "picker-google-chat", title: "模型宽度 Gemini", connectionId: "picker-google", modelId: "gemini-2.5-pro" },
  ], { readyTimeout: WINDOWS_COLD_START_READY_TIMEOUT });
  await page.reload();

  const openAiPicker = await openConversationModelPicker(page, "picker-openai-chat");
  await expect(openAiPicker).toHaveAttribute("data-model-picker-view", "providers");
  await expectPickerWidth(openAiPicker, 296);
  await expectSurfaceWidth(openAiPicker, "provider", 240);
  await expect(openAiPicker.locator('[data-model-picker-surface="model"]')).toHaveCount(0);
  await expect(openAiPicker.getByRole("button", { name: "管理 AI 连接" })).toHaveCount(0);
  const openAiProvider = openAiPicker.getByRole("button", { name: "OpenAI" });
  await openAiProvider.focus();
  await expect(openAiPicker.locator('[data-model-picker-surface="model"]')).toBeVisible();
  await expectSurfaceWidth(openAiPicker, "model", 420);
  await openAiProvider.press("ArrowRight");
  await expect(openAiPicker).toHaveAttribute("data-model-picker-view", "models");
  await expectPickerWidth(openAiPicker, 296);
  await expectStablePickerFrames(openAiPicker);

  const selectedModel = openAiPicker.getByRole("radio", { name: /gpt-5\.5/ });
  const modelSearch = openAiPicker.getByRole("searchbox", { name: "搜索模型" });
  await expect(modelSearch).toBeFocused();
  await expect(page.locator('body > [role="tooltip"]')).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(selectedModel).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(openAiPicker.getByRole("radio", { name: /gpt-5\.6-sol/ })).toBeFocused();
  await expect(page.locator('body > [role="tooltip"]')).toHaveCount(0);

  await expect(openAiPicker.getByRole("button", { name: /^推理强度 / })).toBeEnabled();
  await selectedModel.locator("xpath=..").click();
  const runtimePicker = await openConversationModelPicker(page, "picker-openai-chat");
  const reasoningControl = runtimePicker.getByRole("button", { name: /^推理强度 / });
  await reasoningControl.focus();
  await expect(runtimePicker).toHaveAttribute("data-model-picker-view", "reasoning");
  await reasoningControl.press("ArrowRight");
  await runtimePicker.getByRole("radio", { name: "high", exact: true }).locator("xpath=..").click();
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-openai-chat")).runtime?.reasoning).toBe("high");
  await page.keyboard.press("Escape");
  await expect(openAiPicker).toHaveAttribute("data-model-picker-view", "controls");
  await page.keyboard.press("Escape");
  await expect(openAiPicker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toBeFocused();

  const tabPicker = await openConversationModelPicker(page, "picker-openai-chat");
  await tabOutOfPicker(page, tabPicker);

  let geminiPicker = await openConversationModelPicker(page, "picker-google-chat");
  await geminiPicker.getByRole("button", { name: "Google Gemini" }).click();
  await expect(geminiPicker.getByRole("button", { name: /^推理强度 / })).toBeEnabled();
  await geminiPicker.getByRole("button", { name: /^推理强度 / }).click();
  const budget = geminiPicker.getByRole("spinbutton", { name: "自定义推理预算" });
  await budget.fill("12000");
  await budget.press("ArrowUp");
  await budget.press("Tab");
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-google-chat")).runtime?.reasoning).toBe(12001);
  await expect(geminiPicker).toBeHidden();

  geminiPicker = await openConversationModelPicker(page, "picker-google-chat");
  await geminiPicker.getByRole("button", { name: /^推理强度 / }).click();
  const reopenedBudget = geminiPicker.getByRole("spinbutton", { name: "自定义推理预算" });
  await reopenedBudget.fill("13000");
  await reopenedBudget.press("Enter");
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-google-chat")).runtime?.reasoning).toBe(13000);

  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-desktop-light.png"), fullPage: false });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "返回应用" }).click();
  const darkPicker = await openConversationModelPicker(page, "picker-google-chat");
  await darkPicker.getByRole("button", { name: /^推理强度 / }).click();
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-desktop-dark.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("零可用连接显示恢复空状态并进入既有 AI 连接设置", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await clearConversationModelConnections(page);
  await page.reload();

  await page.getByRole("button", { name: "新对话" }).first().click();
  await page.getByRole("button", { name: "选择模型" }).click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await picker.getByRole("button", { name: /^模型 / }).hover();
  await expect(picker.getByRole("region", { name: "尚未配置 AI 连接" })).toContainText("配置 AI 服务后即可选择模型。");
  await expect(picker.getByRole("button", { name: "管理 AI 连接" })).toHaveCount(0);
  await picker.getByRole("button", { name: "前往设置" }).click();
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("聊天模型菜单只展示目录模型，不提供手动模型或空高级入口", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "picker-custom", label: "E2E Custom", provider: "custom", apiFormat: "chat_completions" },
  ], [
    { id: "picker-custom-chat", title: "目录模型边界", connectionId: "picker-custom", modelId: "legacy-manual-model" },
  ]);
  await page.reload();

  const picker = await openConversationModelPicker(page, "picker-custom-chat");
  await expect(picker.getByRole("button", { name: "高级", exact: true })).toHaveCount(0);
  await expect(picker.getByRole("textbox", { name: "手动模型 ID" })).toHaveCount(0);
  await picker.getByRole("button", { name: "Local / Custom OpenAI compatible" }).click();
  await expect(picker.getByRole("textbox", { name: "手动模型 ID" })).toHaveCount(0);
  await expect(picker.getByRole("radio", { name: "legacy-manual-model" })).toHaveCount(0);
  await expect.poll(async () => (await readConversationModelSelection(page, "picker-custom-chat")).modelId).toBe("legacy-manual-model");
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
  await expect(picker.getByRole("radio", { name: /^glm-5\.2-custom/ })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: /^推理强度 / })).toBeDisabled();
  await expect(picker.getByRole("button", { name: /^速度 / })).toBeDisabled();
  await expect.poll(async () => (await readConversationModelSelection(page, "unknown-glm-chat")).modelId).toBe("glm-5.2-custom");
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
  picker = await openConversationModelPicker(page, "state-chat-b");
  await picker.getByRole("button", { name: "OpenAI" }).click();
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
  picker = await openConversationModelPicker(page, "state-chat-b");
  await picker.getByRole("button", { name: "OpenAI" }).click();
  await expect(picker.getByRole("radio", { name: /gpt-5\.6-terra/ })).toBeChecked();
  expect((await readConversationModelSelection(page, "state-chat-b")).modelId).toBe("gpt-5.6-terra");

  await page.reload();
  await page.locator('[data-conversation-id="state-chat-b"] .conversation-tree-chat-label').click();
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("gpt-5.6-terra");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
