import { expect, test, type Locator, type Page } from "@playwright/test";
import { configureCustomTextConnection, setCustomDefaultTextModel } from "./helpers/configure-custom-ai";
import { startMockAiProvider, type MockAiRequest } from "./helpers/mock-ai-provider";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

function mockLearningResponse(request: MockAiRequest): string {
  const payload = JSON.stringify(request.body);
  if (payload.includes("tutoring_reply")) {
    return JSON.stringify({
      teacherMessage: "先统一单位，再用现期量除以一加增长率。",
      boardNotes: ["识别现期量", "统一增长率单位", "代入基期量公式"],
      detectedProblem: "基期量公式与增长量公式混淆",
      studentAction: "口述一次公式并完成微测",
      nextQuestion: "基期量公式中的分母是什么？",
      confidence: 0.92,
      frameDescription: "",
      microQuiz: [{ prompt: "基期量应如何计算？", options: ["现期量÷(1+增长率)", "现期量×增长率", "现期量-增长率"], correctOptionIndex: 0, explanation: "基期量等于现期量除以一加增长率。" }],
    });
  }
  if (payload.includes("最终评分")) {
    return JSON.stringify({
      totalScore: 82,
      dimensions: [{ name: "内容", score: 82, maxScore: 100, comment: "能够回应群众诉求并给出处理步骤。" }],
      strengths: ["结构完整"],
      problems: ["措施还可更具体"],
      suggestions: ["补充现场分流与后续反馈机制"],
      evidence: ["先安抚情绪，再核验材料并提供补正清单"],
    });
  }
  return JSON.stringify({ reply: "请开始作答，注意先回应情绪，再说明处理步骤。", nextStage: "answering", shouldEvaluate: false });
}

async function ensureDetailsOpen(summary: Locator) {
  if (!(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open))) await summary.click();
}

async function openDesktopModule(page: Page, name: string) {
  const sidebar = page.locator(".chrome-sidebar:visible");
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "公考" }).first());
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "模块" }).first());
  await sidebar.getByRole("button", { name }).click();
}

test("P1 辅导对话完成讲解与微测，面试按真实阶段进入复盘", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  const provider = await startMockAiProvider({ response: mockLearningResponse });
  try {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).first().click();
    await page.getByRole("button", { name: "AI 连接" }).click();
    await configureCustomTextConnection(page, { label: "P1 学习 Mock", baseUrl: provider.baseUrl, model: "p1-learning-model" });
    await setCustomDefaultTextModel(page, "P1 学习 Mock", "p1-learning-model");
    await page.getByRole("button", { name: "返回应用" }).click();

    await ensureDetailsOpen(page.locator("summary").filter({ hasText: "面试与辅导" }).first());
    await page.getByRole("button", { name: "开始对话辅导" }).click();
    await expect(page.getByRole("button", { name: "实时辅导" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("本轮目标")).toBeVisible();
    const input = page.getByRole("textbox", { name: "对话输入" });
    await input.fill("我总把基期量公式和增长量公式混淆。");
    await input.press("Enter");
    await expect(page.getByText("先统一单位，再用现期量除以一加增长率。")).toBeVisible();
    const micro = page.getByRole("region", { name: "本轮微测" });
    await micro.getByLabel("现期量÷(1+增长率)").check();
    await micro.getByRole("button", { name: "提交微测并安排复练" }).click();
    await expect(micro.getByText("1/1")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("p1-tutoring-desktop.png"), fullPage: false });
    await page.evaluate(() => { document.body.dataset.theme = "dark"; });
    await page.screenshot({ path: testInfo.outputPath("p1-tutoring-desktop-dark.png"), fullPage: false });
    await page.evaluate(() => { document.body.dataset.theme = "light"; });

    await openDesktopModule(page, "面试训练");
    await page.getByRole("tab", { name: /题库/ }).click();
    await page.getByRole("button", { name: "载入三类示例题" }).click();
    await page.getByRole("button", { name: "开始模拟" }).first().click();
    await expect(page.getByRole("heading", { name: /窗口服务中的群众情绪处理/ })).toBeVisible();
    await expect(page.getByText("请开始作答，注意先回应情绪")).toBeVisible();
    await page.getByRole("textbox", { name: "本轮文字稿" }).fill("我会先安抚群众情绪，再核验材料并提供补正清单。");
    await page.getByRole("button", { name: "提交并继续" }).click();
    await page.getByRole("button", { name: "结束并复盘" }).click();
    await expect(page.getByRole("heading", { name: /复盘结果 · 82\/100/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("p1-interview-desktop.png"), fullPage: false });
    await page.evaluate(() => { document.body.dataset.theme = "dark"; });
    await page.screenshot({ path: testInfo.outputPath("p1-interview-desktop-dark.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    const interviewInsightTrigger = page.getByRole("button", { name: /本题要点/ });
    await interviewInsightTrigger.click();
    await page.screenshot({ path: testInfo.outputPath("p1-interview-mobile-dark.png"), fullPage: false });
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.body.dataset.theme = "light"; });
    await interviewInsightTrigger.click();
    await page.screenshot({ path: testInfo.outputPath("p1-interview-mobile.png"), fullPage: false });
    await page.keyboard.press("Escape");

    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(runtimeErrors);
  } finally {
    await provider.stop();
  }
});
