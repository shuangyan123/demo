import { expect, test } from "@playwright/test";
import { configureCustomTextConnection, setCustomDefaultTextModel } from "./helpers/configure-custom-ai";
import { startMockAiProvider } from "./helpers/mock-ai-provider";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test.setTimeout(60_000);

/**
 * 验证新消息按“用户、必要工具、AI”归入同一轮次，内部流水线只进入详情。
 */
test("对话链按轮次稳定显示用户消息和 AI 回答", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const provider = await startMockAiProvider({ response: "这是同一轮次的回答" });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await configureCustomTextConnection(page, {
      label: "E2E 轮次连接",
      baseUrl: provider.baseUrl,
      model: "turn-model",
    });
    await expect(page.getByRole("status")).toContainText("配置已保存");
    await setCustomDefaultTextModel(page, "E2E 轮次连接", "turn-model");
    await page.getByRole("button", { name: "返回应用" }).click();
    await page.getByRole("button", { name: "新对话", exact: true }).click();

    const input = page.getByRole("textbox", { name: "对话输入" });
    await input.fill("这是同一轮次的问题");
    await input.press("Enter");

    const turn = page.locator(".conversation-turn").last();
    await expect(turn).toContainText("这是同一轮次的问题");
    await expect(turn).toContainText("这是同一轮次的回答");
    const orderedText = await turn.locator(":scope > *").allTextContents();
    expect(orderedText.findIndex((text) => text.includes("问题"))).toBeLessThan(orderedText.findIndex((text) => text.includes("回答")));
    const details = turn.locator("details.conversation-turn-details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.getByText("详情", { exact: true })).toBeVisible();

    await page.reload();
    await page.locator(".conversation-tree-chat-label").filter({ hasText: "这是同一轮次的问题" }).click();
    const restoredTurn = page.locator(".conversation-turn").last();
    await expect(restoredTurn).toContainText("这是同一轮次的问题");
    await expect(restoredTurn).toContainText("这是同一轮次的回答");
    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});
