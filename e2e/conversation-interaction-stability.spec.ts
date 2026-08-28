import { expect, test, type Page } from "@playwright/test";
import {
  readConversationModelSelection,
  seedConversationModelFixtures,
} from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function loadReviewConversation(page: Page): Promise<void> {
  await page.goto("/?ui-review=1");
  await page.getByRole("button", { name: "新对话" }).first().click();
  await page.locator(".sample-scenario-trigger").click();
  await page.getByLabel("选择当前页面审查场景").selectOption("conversation-normal");
  await page.getByRole("button", { name: "载入本页" }).click();
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible({ timeout: 80_000 });
  await page.reload();
  await page.getByRole("button", { name: "必要条件与充分条件", exact: true }).click();
}

test("Topic Preview 离开、点击、失焦和交互菜单打开均不会残留", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await loadReviewConversation(page);

  const topics = page.getByRole("navigation", { name: "对话主题目录" });
  const firstTopic = topics.getByRole("button").first();
  const preview = page.locator(".conversation-topic-preview");
  const header = page.locator(".conversation-thread-header");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await firstTopic.hover();
    await page.waitForTimeout(40);
    await header.hover({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(220);
    await expect(preview).toHaveCount(0);
  }

  await firstTopic.hover();
  await expect(preview).toBeVisible();
  await firstTopic.click();
  await expect(preview).toHaveCount(0);

  await firstTopic.focus();
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "选择模型" }).focus();
  await expect(preview).toHaveCount(0);

  await firstTopic.hover();
  await expect(preview).toBeVisible();
  const addTrigger = page.getByRole("button", { name: "添加文件等内容" });
  await addTrigger.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "添加与工具" })).toBeVisible();
  await page.keyboard.press("Escape");

  await firstTopic.hover();
  await expect(preview).toBeVisible();
  const modelTrigger = page.getByRole("button", { name: "选择模型" });
  await modelTrigger.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "选择对话模型" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("桌面模型厂商 hover 使用固定双栏外框且不转移焦点", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "stable-openai", label: "稳定 OpenAI", provider: "openai", apiFormat: "responses" },
    { id: "stable-google", label: "稳定 Gemini", provider: "google", apiFormat: "google_generate_content" },
    { id: "stable-zhipu", label: "稳定 GLM", provider: "zhipu", apiFormat: "chat_completions" },
  ], [
    { id: "stable-chat", title: "模型选择稳定性", connectionId: "stable-openai", modelId: "gpt-5.5" },
  ]);
  await page.reload();
  await page.locator('[data-conversation-id="stable-chat"] .conversation-tree-chat-label').click();

  const picker = page.getByRole("button", { name: "选择模型" }).locator("..")
    .getByRole("dialog", { name: "选择对话模型" });
  await page.getByRole("button", { name: "选择模型" }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await picker.getByRole("button", { name: "模型", exact: true }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");

  const providerRows = [
    picker.getByRole("button", { name: "OpenAI", exact: true }),
    picker.getByRole("button", { name: "Google Gemini", exact: true }),
    picker.getByRole("button", { name: "GLM / 智谱", exact: true }),
    picker.getByRole("button", { name: "OpenAI", exact: true }),
  ];
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const row of providerRows) {
    await row.hover();
    await expect(row).toHaveAttribute("data-provider-active", "true");
    const rect = await picker.boundingBox();
    if (!rect) throw new Error("模型选择器没有可见边界");
    rects.push(rect);
  }
  const initial = rects[0];
  for (const rect of rects.slice(1)) {
    expect(Math.abs(rect.x - initial.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.y - initial.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.width - initial.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.height - initial.height)).toBeLessThanOrEqual(1);
  }

  const gemini = providerRows[1];
  await gemini.focus();
  await expect(gemini).toBeFocused();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await gemini.press("ArrowRight");
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await expect(picker.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await expect(picker.getByRole("button", { name: "Google Gemini", exact: true })).toBeFocused();

  await gemini.click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  const selectedModel = picker.getByRole("radio").first();
  await selectedModel.click();
  await expect.poll(async () => (await readConversationModelSelection(page, "stable-chat")).modelId).not.toBe("gpt-5.5");

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
