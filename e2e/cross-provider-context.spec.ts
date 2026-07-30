import { expect, test, type Page } from "@playwright/test";
import { startMockAiProvider, type MockAiProvider } from "./helpers/mock-ai-provider";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 打开设置中的 AI 连接分区。 */
async function openConnections(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
}

/** 通过真实设置表单创建并测试一条连接，避免直接向 IndexedDB 注入测试状态。 */
async function createConnection(page: Page, input: {
  providerLabel: string;
  connectionLabel: string;
  modelId: string;
  mock: MockAiProvider;
}): Promise<void> {
  await page.getByRole("combobox", { name: "厂商" }).click();
  await page.getByRole("option", { name: input.providerLabel, exact: true }).click();
  const connectionName = page.getByLabel("连接名称");
  if (!(await connectionName.isVisible())) await page.getByText("高级设置", { exact: true }).click();
  await connectionName.fill(input.connectionLabel);
  await page.getByLabel("Base URL").fill(input.mock.baseUrl);
  await page.getByLabel("API Key").fill(`${input.connectionLabel}-key`);
  await page.getByRole("button", { name: "获取模型" }).click();
  const modelSelect = page.getByRole("combobox", { name: "测试模型 ID" });
  await modelSelect.click();
  await page.getByRole("option", { name: input.modelId, exact: true }).click();
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByRole("status")).toContainText("连接成功", { timeout: 15_000 });
  await page.getByRole("button", { name: "保存连接" }).click();
  await expect(page.getByRole("status")).toContainText("配置已保存");
}

test("切换 Google 到 DeepSeek 后继续发送本地可见历史", async ({ page }) => {
  const google = await startMockAiProvider({
    protocol: "google_generate_content",
    models: ["gemini-2.5-flash"],
    response: (request) => {
      const body = request.body as { structuredOutput?: unknown };
      return body.structuredOutput ? JSON.stringify({ memories: [] }) : "第一轮回答";
    },
  });
  const deepseek = await startMockAiProvider({
    protocol: "chat_completions",
    models: ["deepseek-v4-pro"],
    response: "第二轮回答",
  });
  const runtimeErrors = collectRuntimeErrors(page);
  try {
    await openConnections(page);
    await createConnection(page, {
      providerLabel: "Google Gemini",
      connectionLabel: "E2E Google",
      modelId: "gemini-2.5-flash",
      mock: google,
    });
    await page.getByRole("button", { name: "新建" }).click();
    await createConnection(page, {
      providerLabel: "DeepSeek",
      connectionLabel: "E2E DeepSeek",
      modelId: "deepseek-v4-pro",
      mock: deepseek,
    });

    await page.getByRole("button", { name: "返回应用" }).click();
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await page.getByRole("textbox", { name: "对话输入" }).fill("第一轮问题");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("第一轮回答").last()).toBeVisible();

    await page.getByRole("button", { name: "选择模型" }).click();
    const picker = page.getByRole("dialog", { name: "选择对话模型" });
    await picker.getByRole("button", { name: "DeepSeek", exact: true }).click();
    await picker.getByText("deepseek-v4-pro", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "选择模型" })).toContainText("deepseek-v4-pro");

    await page.getByRole("textbox", { name: "对话输入" }).fill("第二轮问题");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("第二轮回答").last()).toBeVisible();

    const request = deepseek.requests.findLast((item) => item.method === "POST" && item.url === "/v1/chat/completions");
    const body = request?.body as { messages?: Array<{ role?: string; content?: string }> };
    expect(body.messages?.map((message) => [message.role, message.content])).toEqual([
      ["user", "第一轮问题"],
      ["assistant", "第一轮回答"],
      ["user", "第二轮问题"],
    ]);
    await expect(page.getByText("工具链", { exact: true })).toHaveCount(0);
    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await google.stop();
    await deepseek.stop();
  }
});
