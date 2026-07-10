import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { startMockAiProvider, type MockAiProvider } from "./helpers/mock-ai-provider";

function userPayloadFromRequest(provider: MockAiProvider, index: number) {
  const body = provider.requests[index]?.body as { messages?: Array<{ role: string; content: string }> };
  const userMessage = body.messages?.find((message) => message.role === "user")?.content ?? "";
  return JSON.parse(userMessage) as { task?: string; context?: Record<string, unknown> };
}

test("已安排使用默认文本连接时可完成试运行和成功运行详情", async ({ page }) => {
  const provider = await startMockAiProvider();
  const runtimeErrors = collectRuntimeErrors(page);

  try {
    await page.goto("/");
    await expect(page).toHaveTitle("错题复盘");

    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
    await page.getByRole("button", { name: /本地部署 \/ 自定义连接/ }).click();

    await page.getByLabel("连接名称").fill("E2E Mock 文本连接");
    await page.getByLabel("Base URL").fill(provider.baseUrl);
    await page.getByRole("textbox", { name: "手动模型 ID" }).fill("mock-text-model");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByRole("status")).toContainText("配置已保存");
    await page.getByLabel("默认文本").selectOption({ label: "E2E Mock 文本连接" });
    await expect(page.getByRole("status")).toContainText("默认文本已更新");

    await page.goto("/");
    await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
    await expect(page.getByRole("heading", { name: "已安排", exact: true })).toBeVisible();
    await page.getByLabel("模板").selectOption("custom");
    await page.getByLabel("名称").fill("AI 成功态回归");
    await page.getByLabel("提示词").fill("请只基于面试和辅导数据生成一段成功态回归结果。");
    await page.getByRole("checkbox", { name: "面试" }).check();
    await page.getByRole("checkbox", { name: "辅导" }).check();

    await page.getByRole("button", { name: "预览读取范围" }).click();
    const previewPanel = page.getByRole("region", { name: "已安排读取范围预览" });
    await expect(previewPanel).toBeVisible();
    await expect(previewPanel.getByText("面试")).toBeVisible();
    await expect(previewPanel.getByText("辅导")).toBeVisible();

    await page.getByRole("button", { name: "试运行", exact: true }).click();
    await expect(page.getByText("试运行结果", { exact: true })).toBeVisible();
    await expect(page.getByText("## Mock 自动化结果")).toBeVisible();
    await expect(page.locator("section").filter({ hasText: "运行收件箱" }).getByText("收件箱为空")).toBeVisible();
    await expect.poll(() => provider.requests.length).toBe(1);

    const trialPayload = userPayloadFromRequest(provider, 0);
    expect(trialPayload.task).toContain("面试和辅导数据");
    expect(Object.keys(trialPayload.context ?? {}).sort()).toEqual(["interview", "tutoring"]);

    await page.getByRole("button", { name: "创建已安排" }).click();
    const taskCard = page.locator("article").filter({ hasText: "AI 成功态回归" }).first();
    await expect(taskCard).toBeVisible();
    await taskCard.getByRole("button", { name: "立即运行" }).click();
    await expect.poll(() => provider.requests.length).toBe(2);

    const inbox = page.locator("section").filter({ hasText: "运行收件箱" }).first();
    await expect(inbox.getByText("## Mock 自动化结果")).toBeVisible();
    await inbox.getByRole("button", { name: "查看详情" }).first().click();
    await expect(inbox.getByText("触发方式：手动")).toBeVisible();
    await expect(inbox.getByText("读取摘要")).toBeVisible();
    await expect(inbox.getByText("上下文规模：约")).toBeVisible();
    await expect(inbox.getByText("提案引用：0 条")).toBeVisible();

    const runPayload = userPayloadFromRequest(provider, 1);
    expect(runPayload.task).toContain("面试和辅导数据");
    expect(Object.keys(runPayload.context ?? {}).sort()).toEqual(["interview", "tutoring"]);

    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});
