import { expect, test, type Page } from "@playwright/test";
import { startMockAiProvider, type MockAiProvider } from "./helpers/mock-ai-provider";
import { openConnectionEditor } from "./helpers/configure-custom-ai";
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
  await (await openConnectionEditor(page)).click();
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

async function seedCompactionHistory(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["aiConversations", "aiConversationMessages"], "readwrite");
      const conversations = transaction.objectStore("aiConversations").getAll();
      conversations.onsuccess = () => {
        const conversation = conversations.result.at(-1);
        const store = transaction.objectStore("aiConversationMessages");
        const base = Date.now() - 60_000;
        for (let index = 0; index < 14; index += 1) store.put({
          id: `compaction-message-${index}`,
          conversationId: conversation.id,
          turnId: `compaction-turn-${Math.floor(index / 2)}`,
          sequence: index % 2 ? 2 : 0,
          role: index % 2 ? "assistant" : "user",
          content: `旧消息 ${index}：${"需要保留的背景事实与约束。".repeat(35)}`,
          attachmentIds: [],
          createdAt: new Date(base + index * 1_000).toISOString(),
        });
        conversation.messageCount = 16;
        transaction.objectStore("aiConversations").put(conversation);
        transaction.oncomplete = () => resolve(conversation.id);
      };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
}

async function readCompaction(page: Page, conversationId: string) {
  return page.evaluate((id) => new Promise<{ summary?: string; sourceMessageCount?: number }>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const record = request.result.transaction("aiConversations", "readonly").objectStore("aiConversations").get(id);
      record.onsuccess = () => resolve(record.result?.contextCompaction ?? {});
      record.onerror = () => reject(record.error);
    };
  }), conversationId);
}

test("上下文压缩经 mock provider 持久化并进入下一轮真实请求", async ({ page }) => {
  test.setTimeout(60_000);
  let returnCompaction = false;
  const provider = await startMockAiProvider({
    protocol: "chat_completions",
    models: ["deepseek-v4-pro"],
    response: () => returnCompaction
      ? JSON.stringify({ goals: ["继续完成用户目标"], facts: ["已确认背景事实"], constraints: ["保持跨厂商可审计"], decisions: [], openItems: ["完成下一轮"], references: [] })
      : "压缩后的下一轮回答",
  });
  try {
    await openConnections(page);
    await createConnection(page, { providerLabel: "DeepSeek", connectionLabel: "E2E Compaction", modelId: "deepseek-v4-pro", mock: provider });
    await page.getByRole("button", { name: "返回应用" }).click();
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await page.getByRole("textbox", { name: "对话输入" }).fill("建立压缩测试会话");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("压缩后的下一轮回答").last()).toBeVisible();
    const conversationId = await seedCompactionHistory(page);
    await page.reload();
    await page.getByRole("button", { name: "建立压缩测试会话", exact: true }).click();

    const summary = page.locator('summary[aria-label="查看对话上下文用量"]');
    await summary.click();
    returnCompaction = true;
    await page.getByRole("button", { name: "压缩上下文" }).click();
    await expect.poll(async () => (await readCompaction(page, conversationId)).summary, { timeout: 15_000 }).toContain("继续完成用户目标");
    await page.reload();
    await page.getByRole("button", { name: "建立压缩测试会话", exact: true }).click();
    const compacted = await readCompaction(page, conversationId);
    expect(compacted.summary).toContain("继续完成用户目标");
    expect(compacted.sourceMessageCount).toBeGreaterThan(0);

    returnCompaction = false;
    const requestCount = provider.requests.filter((request) => request.method === "POST" && request.url === "/v1/chat/completions").length;
    await page.getByRole("textbox", { name: "对话输入" }).fill("继续下一轮");
    await page.getByRole("button", { name: "发送" }).click();
    await expect.poll(() => provider.requests.filter((request) => request.method === "POST" && request.url === "/v1/chat/completions").length).toBeGreaterThan(requestCount);
    await expect(page.getByText("压缩后的下一轮回答").last()).toBeVisible();
    const body = provider.requests.filter((request) => request.method === "POST" && request.url === "/v1/chat/completions").at(-1)?.body as { messages?: Array<{ content?: string }> };
    const sent = JSON.stringify(body.messages);
    expect(sent).toContain("继续完成用户目标");
    expect(sent).not.toContain("旧消息 0");
  } finally {
    await provider.stop();
  }
});
