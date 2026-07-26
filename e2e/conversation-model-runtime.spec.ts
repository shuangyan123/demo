import { expect, test, type Page } from "@playwright/test";
import { startMockAiProvider } from "./helpers/mock-ai-provider";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 从真实 review_workspace 复读会话运行值与脱敏运行步骤。 */
async function readRuntimeState(page: Page) {
  return page.evaluate(async () => new Promise<{ runtime?: { reasoning?: string | number; speed?: string }; stepTexts: string[] }>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["aiConversations", "aiConversationRunSteps"], "readonly");
      const conversationsRequest = transaction.objectStore("aiConversations").getAll();
      const stepsRequest = transaction.objectStore("aiConversationRunSteps").getAll();
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        const conversation = conversationsRequest.result.at(-1);
        resolve({ runtime: conversation?.selectedRuntimeValues, stepTexts: stepsRequest.result.map((step) => String(step.text ?? "")) });
      };
    };
  }));
}

test("模型菜单即时保存推理与速度，并把归一化值映射到真实请求", async ({ page }) => {
  test.setTimeout(60_000);
  const provider = await startMockAiProvider({
    protocol: "openai_responses",
    models: ["gpt-5.5", "gpt-5.6-sol"],
    actualSpeed: "priority",
    response: "运行选项已应用\n\n**重点**\n\n<script>window.__aiInjected = true</script>",
    streamCompletionDelayMs: 2000,
  });
  const runtimeErrors = collectRuntimeErrors(page);

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await page.getByRole("combobox", { name: "厂商" }).click();
    await page.getByRole("option", { name: "OpenAI", exact: true }).click();
    await page.getByText("高级设置", { exact: true }).click();
    await page.getByLabel("连接名称").fill("E2E OpenAI");
    await page.getByLabel("Base URL").fill(provider.baseUrl);
    await page.getByLabel("API Key").fill("fixture-key");
    await page.getByRole("button", { name: "获取模型" }).click();
    await expect(page.getByRole("combobox", { name: "测试模型 ID" })).toContainText("gpt-5.5");
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByRole("status")).toContainText("连接成功");
    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(page.getByRole("status")).toContainText("配置已保存");
    await page.getByRole("button", { name: "设为默认" }).click();
    await expect(page.getByRole("status")).toContainText("已设为默认");

    await page.getByRole("button", { name: "返回应用" }).click();
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await expect(page.getByRole("button", { name: "选择模型" })).toContainText("gpt-5.5");
    await page.getByRole("textbox", { name: "对话输入" }).fill("先建立持久化会话");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("运行选项已应用").last()).toBeVisible();
    await expect(page.locator(".conversation-assistant-markdown strong").last()).toHaveText("重点");
    await expect(page.getByText("**重点**", { exact: true })).toHaveCount(0);
    await expect(page.locator(".conversation-assistant-markdown script")).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & { __aiInjected?: boolean }).__aiInjected)).toBeUndefined();
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    await expect(page.locator("[data-conversation-composer]")).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "对话输入" })).toHaveValue("先建立持久化会话");
    await expect(page.getByRole("textbox", { name: "对话输入" })).toHaveValue("");

    const trigger = page.getByRole("button", { name: "选择模型" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "选择对话模型" });
    await dialog.getByRole("button", { name: "OpenAI" }).click();
    await dialog.getByRole("radio", { name: /gpt-5\.6-sol/ }).locator("xpath=..").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /推理/ })).toHaveCount(0);
    await dialog.getByRole("radio", { name: /gpt-5\.5/ }).locator("xpath=..").click();
    const reasoningTrigger = page.getByRole("button", { name: /调整推理强度，当前 medium/ });
    await expect(reasoningTrigger).toBeVisible();
    await reasoningTrigger.click();
    await expect(dialog).toBeHidden();
    const reasoningSlider = page.getByRole("slider", { name: "推理档位" });
    await reasoningSlider.fill("3");
    await reasoningSlider.dispatchEvent("pointerup");
    await expect(page.getByRole("button", { name: /调整推理强度，当前 high/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await trigger.click();
    await dialog.getByRole("button", { name: "OpenAI" }).click();
    await dialog.getByRole("button", { name: /速度/ }).click();
    await dialog.getByRole("radio", { name: /^优先/ }).locator("xpath=..").click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.getByRole("textbox", { name: "对话输入" }).fill("验证运行参数请求体");
    await page.getByRole("textbox", { name: "对话输入" }).press("Enter");
    await expect(page.getByText("运行选项已应用").last()).toBeVisible();
    await expect(trigger).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "对话输入" })).toHaveValue("");
    const state = await readRuntimeState(page);
    expect(state.runtime).toEqual({ reasoning: "high", speed: "priority" });
    expect(state.stepTexts.some((text) => text.includes("速度 priority / 实际 priority"))).toBe(true);

    const generationRequests = provider.requests.filter((request) => request.method === "POST" && request.url === "/v1/responses");
    const body = generationRequests.at(-1)?.body as { reasoning?: unknown; service_tier?: string };
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.service_tier).toBe("priority");

    await page.reload();
    const restored = await readRuntimeState(page);
    expect(restored.runtime).toEqual({ reasoning: "high", speed: "priority" });
    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});
