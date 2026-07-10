import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { configureCustomTextConnection } from "./helpers/configure-custom-ai";
import { startMockAiProvider, type MockAiProvider, type MockAiRequest } from "./helpers/mock-ai-provider";

const proposalTitle = "E2E 知识演进提案";

type KnowledgeEvolutionRequest = {
  candidates?: Array<{ id: string }>;
  sources?: Array<{ id: string; type: string; title: string }>;
};

function messageContent(request: MockAiRequest, role: "system" | "user"): string {
  const body = request.body as { messages?: Array<{ role: string; content: string }> };
  return body.messages?.find((message) => message.role === role)?.content ?? "";
}

function knowledgePayloadFromRequest(provider: MockAiProvider, index: number): KnowledgeEvolutionRequest {
  return JSON.parse(messageContent(provider.requests[index]!, "user")) as KnowledgeEvolutionRequest;
}

function proposalResponse(request: MockAiRequest): string {
  const payload = JSON.parse(messageContent(request, "user")) as KnowledgeEvolutionRequest;
  const sourceId = payload.sources?.[0]?.id ?? "mistake:e2e-source";
  return JSON.stringify([
    {
      mode: "create",
      sourceIds: [sourceId],
      category: "常识判断",
      title: proposalTitle,
      summary: "从错题记录归纳出的端到端知识点。",
      content: "遇到资料分析增长率判断时，先明确基期和现期，再比较口径。",
      tags: ["e2e", "知识演进"],
      proposedLinks: ["增长率判断"],
      reason: "错题解析暴露出增长率判断步骤混淆。",
      confidence: 0.82,
    },
  ]);
}

test("知识演进已安排任务可通过 mock JSON 生成待确认提案", async ({ page }) => {
  const provider = await startMockAiProvider({ response: proposalResponse });
  const runtimeErrors = collectRuntimeErrors(page);

  try {
    await page.goto("/");
    await expect(page).toHaveTitle("错题复盘");

    await page.getByRole("button", { name: "手动录入" }).first().click();
    const entryForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存错题" }) });
    await entryForm.getByLabel("板块").selectOption("资料分析");
    await entryForm.getByLabel("来源").fill("E2E 知识演进数据");
    await entryForm.getByLabel("标签").fill("e2e,增长率");
    await entryForm.getByLabel("初始掌握度").selectOption("2");
    await entryForm.getByLabel("题干").fill("E2E 知识演进错题：资料分析增长率判断。");
    await entryForm.getByLabel("答案").fill("B");
    await entryForm.getByLabel("错因").fill("增长率口径混淆");
    await entryForm.getByLabel("解析").fill("先判断基期与现期，再比较增长率口径。");
    await entryForm.getByRole("button", { name: "保存错题" }).click();
    await expect(page.getByText("错题已保存到 IndexedDB")).toBeVisible();

    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await configureCustomTextConnection(page, { label: "E2E 知识演进 Mock", baseUrl: provider.baseUrl, model: "mock-json-model" });
    await expect(page.getByRole("status")).toContainText("配置已保存");
    await page.getByLabel("默认文本").selectOption({ label: "E2E 知识演进 Mock" });
    await expect(page.getByRole("status")).toContainText("默认文本已更新");

    await page.goto("/");
    await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
    await expect(page.getByRole("heading", { name: "已安排", exact: true })).toBeVisible();
    await page.getByLabel("模板").selectOption("knowledge_evolution");
    await page.getByLabel("名称").fill("E2E 知识演进闭环");
    await page.getByRole("checkbox", { name: "知识库" }).uncheck();
    await page.getByRole("checkbox", { name: "面试" }).uncheck();
    await page.getByRole("checkbox", { name: "辅导" }).uncheck();

    await page.getByRole("button", { name: "预览读取范围" }).click();
    const previewPanel = page.getByRole("region", { name: "已安排读取范围预览" });
    await expect(previewPanel).toBeVisible();
    await expect(previewPanel.getByText("错题", { exact: true })).toBeVisible();
    await expect(previewPanel.getByText("资料分析 · E2E 知识演进错题")).toBeVisible();
    await expect(previewPanel.getByText("知识库")).toHaveCount(0);

    await page.getByRole("button", { name: "试运行", exact: true }).click();
    await expect(page.getByText("试运行结果", { exact: true })).toBeVisible();
    await expect(page.getByText("试运行生成 1 条知识演进提案。确认前不会修改知识库或 Vault。")).toBeVisible();
    await expect(page.getByText(proposalTitle)).toHaveCount(0);
    await expect.poll(() => provider.requests.length).toBe(1);

    const trialSystem = messageContent(provider.requests[0]!, "system");
    const trialPayload = knowledgePayloadFromRequest(provider, 0);
    expect(trialSystem).toContain("长期学习记录");
    expect(trialPayload.sources?.map((source) => source.type)).toEqual(["mistake"]);
    expect(trialPayload.sources?.[0]?.id).toMatch(/^mistake:/);
    expect(trialPayload.candidates ?? []).toHaveLength(0);
    expect(JSON.stringify(trialPayload)).not.toContain("knowledge:");
    expect(JSON.stringify(trialPayload)).not.toContain("interview:");
    expect(JSON.stringify(trialPayload)).not.toContain("tutoring:");

    await page.getByRole("button", { name: "创建已安排" }).click();
    const taskCard = page.locator("article").filter({ hasText: "E2E 知识演进闭环" }).first();
    await expect(taskCard).toBeVisible();
    await taskCard.getByRole("button", { name: "立即运行" }).click();
    await expect.poll(() => provider.requests.length).toBe(2);

    const inbox = page.locator("section").filter({ hasText: "运行收件箱" }).first();
    await expect(inbox.getByText("已生成 1 条知识演进提案。确认前不会修改知识库或 Vault。")).toBeVisible();
    await inbox.getByRole("button", { name: "查看详情" }).first().click();
    await expect(inbox.getByText("触发方式：手动")).toBeVisible();
    await expect(inbox.getByText("读取摘要")).toBeVisible();
    await expect(inbox.getByText("提案引用：1 条")).toBeVisible();

    const runPayload = knowledgePayloadFromRequest(provider, 1);
    expect(runPayload.sources?.map((source) => source.type)).toEqual(["mistake"]);
    expect(runPayload.candidates ?? []).toHaveLength(0);

    await page.goto("/");
    await page.locator("section").filter({ has: page.getByRole("heading", { name: "配置健康" }) }).first().getByRole("button", { name: "连接 Obsidian" }).click();
    await expect(page.getByRole("heading", { name: "知识演进提案" })).toBeVisible();
    await expect(page.getByText(proposalTitle)).toBeVisible();
    await expect(page.getByText("错题解析暴露出增长率判断步骤混淆。")).toBeVisible();
    await expect(page.getByText("确认写入")).toBeVisible();

    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});
