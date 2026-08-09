import { expect, test, type Locator, type Page } from "@playwright/test";
import { configureCustomTextConnection, setCustomDefaultTextModel } from "./helpers/configure-custom-ai";
import { replaceLearningFacts } from "./helpers/learning-loop-fixtures";
import { startMockAiProvider, type MockAiRequest } from "./helpers/mock-ai-provider";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-09T08:00:00.000Z"));
});

function mockLearningLoopResponse(request: MockAiRequest): string {
  const payload = JSON.stringify(request.body);
  if (payload.includes("tutoring_reply")) {
    return JSON.stringify({
      teacherMessage: "先判断条件关系，再提交新的确定性微测。",
      boardNotes: ["必要条件", "充分条件"],
      detectedProblem: "条件关系混淆",
      studentAction: "完成微测",
      nextQuestion: "哪项是必要条件？",
      confidence: 0.99,
      frameDescription: "",
      microQuiz: [{ prompt: "必要条件判断", options: ["正确选项", "错误选项", "无关选项"], correctOptionIndex: 0, explanation: "以题干条件为准。" }],
    });
  }
  if (payload.includes("最终评分")) {
    return JSON.stringify({
      totalScore: 82,
      dimensions: [{ name: "内容", score: 82, maxScore: 100, comment: "结构完整。" }],
      strengths: ["结构完整"], problems: [], suggestions: ["继续补充细节"], evidence: ["本地文字稿"],
    });
  }
  return JSON.stringify({ reply: "请开始作答。", nextStage: "answering", shouldEvaluate: false });
}

async function configureMockTextConnection(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await configureCustomTextConnection(page, { label: "Learning Loop Mock", baseUrl, model: "learning-loop-model" });
  await setCustomDefaultTextModel(page, "Learning Loop Mock", "learning-loop-model");
  await page.getByRole("button", { name: "返回应用" }).click();
}

async function ensureDetailsOpen(summary: Locator): Promise<void> {
  if (!(await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open))) await summary.click();
}

async function openDashboard(page: Page): Promise<void> {
  const sidebar = page.locator(".chrome-sidebar:visible");
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "公考" }).first());
  await ensureDetailsOpen(sidebar.locator("summary").filter({ hasText: "模块" }).first());
  await sidebar.getByRole("button", { name: "总览", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
}


async function tabUntilFocused(page: Page, target: Locator, maximumTabs = 40): Promise<void> {
  let enteredTabOrder = false;
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({ tagName: document.activeElement?.tagName, isBody: document.activeElement === document.body }));
    if (focus.isBody && !enteredTabOrder) continue;
    expect(focus.isBody, `进入 Tab 顺序后，第 ${index + 1} 次 Tab 不应把焦点丢失到 body`).toBe(false);
    enteredTabOrder = true;
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`未能在 ${maximumTabs} 次 Tab 内到达目标控件`);
}

test("grouped review 通过真实复盘逐项缩小，并在 reload 后保持完成状态", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  const past = "2026-08-01T08:00:00.000Z";
  await replaceLearningFacts(page, {
    mistakes: [
      { id: "loop-mistake-a", board: "判断推理", source: "E2E", stem: "Learning Loop 到期错题 A", answer: "A", explanation: "验证部分完成", reasons: ["条件关系混淆"], tags: [], mastery: 1, nextReviewAt: "2026-08-01", createdAt: past, updatedAt: past },
      { id: "loop-mistake-b", board: "资料分析", source: "E2E", stem: "Learning Loop 到期错题 B", answer: "B", explanation: "验证全部完成", reasons: ["单位换算"], tags: [], mastery: 2, nextReviewAt: "2026-08-01", createdAt: past, updatedAt: past },
    ],
    attempts: [{ id: "loop-attempt", mistakeId: "loop-mistake-a", result: "wrong", confidence: 2, reviewedAt: past }],
    knowledgeEntries: [{ id: "future-knowledge", category: "常识判断", title: "未来稳定知识", summary: "尚未到期", content: "未来稳定知识正文", tags: [], source: "E2E", favorite: false, mastery: 5, nextReviewAt: "2099-01-01", reviewCount: 2, createdAt: past, updatedAt: past }],
    knowledgeAttempts: [{ id: "future-knowledge-attempt", knowledgeId: "future-knowledge", result: "correct", confidence: 4, reviewedAt: past }],
    interviewPracticePlans: [{ id: "loop-interview-plan", title: "结构化面试复练", type: "structured", questionIds: ["question-1"], targetSessionCount: 3, completedSessionCount: 1, nextPracticeAt: "2026-08-01T08:00:00.000Z", status: "active", reason: "保持结构表达", createdAt: past, updatedAt: past }],
  });
  await page.reload();

  const mistakeAction = page.locator('[data-learning-action="review_mistakes"]');
  await expect(mistakeAction).toContainText("复盘 2 道到期错题");
  await expect(mistakeAction).toContainText("1 道最近答错");
  await expect(page.locator('[data-learning-action="practice_interview"]')).toContainText("完成到期面试训练");
  await expect(page.getByText("未来稳定知识", { exact: true })).toHaveCount(0);

  await mistakeAction.getByText("为什么推荐？", { exact: true }).click();
  await expect(mistakeAction.getByRole("list", { name: "本地证据来源" })).toContainText("错题记录");
  await expect(mistakeAction.getByRole("list", { name: "本地证据来源" })).toContainText("复盘结果");
  await expect(mistakeAction).not.toContainText("loop-mistake");

  await mistakeAction.getByRole("button", { name: "开始复盘" }).click();
  await expect(page.getByRole("heading", { name: "Learning Loop 到期错题 A" })).toBeVisible();
  await page.getByRole("button", { name: "会做" }).click();
  await expect(page.getByText("复盘记录已保存")).toBeVisible();

  await openDashboard(page);
  await expect(mistakeAction).toContainText("复盘 1 道到期错题");
  await expect(mistakeAction).toContainText("完成条件：提交复盘结果后");
  await mistakeAction.getByRole("button", { name: "开始复盘" }).click();
  await expect(page.getByRole("heading", { name: "Learning Loop 到期错题 B" })).toBeVisible();
  await page.getByRole("button", { name: "会做" }).click();
  await openDashboard(page);
  await expect(page.locator('[data-learning-action="review_mistakes"]')).toHaveCount(0);
  await expect(page.locator('[data-learning-action="practice_interview"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-learning-action="review_mistakes"]')).toHaveCount(0);
});

test("grouped knowledge 通过真实训练逐项缩小并最终消失", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const past = "2026-08-01T08:00:00.000Z";
  const entry = (id: string, title: string) => ({ id, category: "常识判断", title, summary: "闭卷回想", content: "知识正文", tags: [], source: "E2E", favorite: false, mastery: 2, nextReviewAt: "2026-08-01", reviewCount: 0, createdAt: past, updatedAt: past });
  await replaceLearningFacts(page, { knowledgeEntries: [entry("loop-k1", "知识闭环一"), entry("loop-k2", "知识闭环二")] });
  await page.reload();

  const action = page.locator('[data-learning-action="review_knowledge"]');
  await expect(action).toContainText("训练 2 个到期知识点");
  await action.getByRole("button", { name: "进入训练" }).click();
  await expect(page.locator("main").getByText("知识闭环一", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "会了" }).click();
  await openDashboard(page);
  await expect(action).toContainText("训练 1 个到期知识点");
  await action.getByRole("button", { name: "进入训练" }).click();
  await expect(page.locator("main").getByText("知识闭环二", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "会了" }).click();
  await openDashboard(page);
  await expect(page.locator('[data-learning-action="review_knowledge"]')).toHaveCount(0);
});

test("tutoring 只有真实新微测会把 P2 转换为 P4", async ({ page }) => {
  test.setTimeout(90_000);
  const provider = await startMockAiProvider({ response: mockLearningLoopResponse });
  try {
    await page.goto("/");
    await configureMockTextConnection(page, provider.baseUrl);
    await ensureDetailsOpen(page.locator("summary").filter({ hasText: "面试与辅导" }).first());
    await page.getByRole("button", { name: "开始对话辅导" }).click();
    const input = page.getByRole("textbox", { name: "对话输入" });
    await input.fill("请给我一次条件关系微测");
    await input.press("Enter");
    let micro = page.getByRole("region", { name: "本轮微测" }).filter({
      has: page.getByRole("button", { name: "提交微测并安排复练" }),
    }).last();
    await micro.getByLabel("错误选项").check();
    await micro.getByRole("button", { name: "提交微测并安排复练" }).click();
    await expect(page.getByRole("region", { name: "本轮微测" }).filter({ hasText: "0/1" }).last()).toBeVisible();

    await openDashboard(page);
    const action = page.locator('[data-learning-action="retry_tutoring"]');
    await expect(action).toContainText("重试未通过的辅导微测");

    await page.locator("[data-conversation-id]").first().locator(".conversation-tree-chat-label").click();
    micro = page.getByRole("region", { name: "本轮微测" }).filter({
      has: page.getByRole("button", { name: "重新微测" }),
    }).last();
    await micro.getByRole("button", { name: "重新微测" }).click();
    micro = page.getByRole("region", { name: "本轮微测" }).filter({
      has: page.getByRole("button", { name: "提交微测并安排复练" }),
    }).last();
    await micro.getByLabel("正确选项").check();
    await micro.getByRole("button", { name: "提交微测并安排复练" }).click();
    await expect(page.getByRole("region", { name: "本轮微测" }).filter({ hasText: "1/1" }).last()).toBeVisible();

    await openDashboard(page);
    await expect(action).toContainText("继续辅导计划");
    await expect(action).not.toContainText("重试未通过的辅导微测");
    await page.reload();
    await expect(page.locator('[data-learning-action="retry_tutoring"]')).toContainText("继续辅导计划");
  } finally {
    await provider.stop();
  }
});

test("interview 只有真实评分持久化会把到期计划推进为 P4", async ({ page }) => {
  test.setTimeout(90_000);
  const provider = await startMockAiProvider({ response: mockLearningLoopResponse });
  try {
    await page.goto("/");
    await configureMockTextConnection(page, provider.baseUrl);
    const past = "2026-08-01T08:00:00.000Z";
    await replaceLearningFacts(page, {
      interviewQuestions: [{ id: "loop-question", type: "structured", title: "闭环面试题", prompt: "请说明处理步骤", material: "", source: "E2E", tags: [], difficulty: "medium", favorite: false, practiceCount: 0, expectedDurationSec: 180, createdAt: past, updatedAt: past }],
      interviewPracticePlans: [{ id: "loop-plan", title: "闭环面试计划", type: "structured", questionIds: ["loop-question"], targetSessionCount: 2, completedSessionCount: 0, nextPracticeAt: past, status: "active", reason: "验证评分推进", createdAt: past, updatedAt: past }],
    });
    await page.reload();

    const action = page.locator('[data-learning-action="practice_interview"]');
    await expect(action).toContainText("完成到期面试训练");
    await action.getByRole("button", { name: "进入面试" }).click();
    await page.getByRole("tab", { name: /训练计划/ }).click();
    await page.getByRole("button", { name: "开始下一场" }).click();
    await expect(page.getByRole("heading", { name: "闭环面试题" })).toBeVisible();
    await page.getByRole("textbox", { name: "本轮文字稿" }).fill("我会先核验事实，再说明处理步骤。");
    await page.getByRole("button", { name: "结束", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "结束本次面试？" });
    await dialog.getByRole("button", { name: "生成部分复盘" }).click();
    await expect(page.getByRole("heading", { name: /复盘结果 · 82\/100/ })).toBeVisible();

    await openDashboard(page);
    await expect(action).toContainText("继续面试训练计划");
    await expect(action).toContainText("已完成 1/2");
    await page.reload();
    await expect(page.locator('[data-learning-action="practice_interview"]')).toContainText("继续面试训练计划");
  } finally {
    await provider.stop();
  }
});

test("空学习档案不会制造推荐", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await replaceLearningFacts(page, {});
  await page.reload();
  await expect(page.getByText("暂无足够学习记录形成今日推荐。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-learning-action]")).toHaveCount(0);
});

test("未到期与未提交证据分别呈现准确边界状态", async ({ page }) => {
  const past = "2026-08-01T08:00:00.000Z";
  await page.goto("/");
  await replaceLearningFacts(page, {
    knowledgeEntries: [{ id: "future-only", category: "常识判断", title: "尚未到期知识", summary: "", content: "", tags: [], source: "E2E", favorite: false, mastery: 5, nextReviewAt: "2099-01-01", reviewCount: 1, createdAt: past, updatedAt: past }],
  });
  await page.reload();
  await expect(page.getByText("当前暂无到期学习任务", { exact: true })).toBeVisible();
  await expect(page.locator("[data-learning-action]")).toHaveCount(0);

  await replaceLearningFacts(page, {
    tutoringTurns: [{
      id: "unsubmitted-assessment",
      sessionId: "unsubmitted-session",
      speaker: "ai_tutor",
      content: "等待用户提交微测",
      confidence: 0.99,
      microAssessment: { questions: [{ id: "pending-question", prompt: "请选择", options: ["A", "B"], correctOptionIndex: 0, explanation: "" }] },
      createdAt: past,
    }],
  });
  await page.reload();
  await expect(page.getByText("有学习记录，但尚缺少已提交评测证据。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-learning-action]")).toHaveCount(0);
});

test("键盘可展开推荐依据并进入具体复盘目标", async ({ page }) => {
  const past = "2026-08-01T08:00:00.000Z";
  await page.goto("/");
  await replaceLearningFacts(page, {
    mistakes: [{ id: "keyboard-review", board: "判断推理", source: "E2E", stem: "键盘可达的到期错题", answer: "A", explanation: "", reasons: ["条件关系"], tags: [], mastery: 2, nextReviewAt: "2026-08-01", createdAt: past, updatedAt: past }],
  });
  await page.reload();

  const action = page.locator('[data-learning-action="review_mistakes"]');
  const disclosure = action.getByText("为什么推荐？", { exact: true });
  await tabUntilFocused(page, disclosure);
  const disclosureFocus = await disclosure.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(disclosureFocus.outlineStyle).not.toBe("none");
  expect(disclosureFocus.outlineWidth).not.toBe("0px");
  await page.keyboard.press("Enter");
  await expect(action.locator("details")).toHaveAttribute("open", "");

  const cta = action.getByRole("button", { name: "开始复盘" });
  await tabUntilFocused(page, cta, 8);
  await expect(cta).toBeFocused();
  await expect(cta).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "键盘可达的到期错题" })).toBeVisible();
});

test("同一 tutoring session 的失败微测与 future auto plan 只显示一个 P2 action", async ({ page }) => {
  await page.goto("/");
  const completedAt = "2026-08-08T08:00:00.000Z";
  await replaceLearningFacts(page, {
    tutoringSessions: [{ id: "dedup-session", mode: "upload", topic: "条件关系", goal: "完成微测复练", status: "completed", turnCount: 1, startedAt: completedAt, completedAt, createdAt: completedAt, updatedAt: completedAt }],
    tutoringTurns: [{
      id: "dedup-failed-turn",
      sessionId: "dedup-session",
      speaker: "ai_tutor",
      content: "完成随堂微测",
      microAssessment: {
        questions: [{ id: "dedup-question", prompt: "必要条件判断", options: ["A", "B"], correctOptionIndex: 0, explanation: "" }],
        selections: [1],
        correctCount: 0,
        completedAt,
      },
      createdAt: completedAt,
    }],
    tutoringPlans: [{
      id: "auto:dedup-session",
      title: "条件关系 · 间隔复练",
      objective: "巩固条件关系",
      linkedKnowledgeIds: [],
      linkedMistakeIds: [],
      nextTask: "重新完成必要条件微测",
      nextPracticeAt: "2099-08-12T08:00:00.000Z",
      status: "active",
      createdAt: completedAt,
      updatedAt: completedAt,
    }],
  });
  await page.reload();

  const tutoringActions = page.locator('[data-learning-action="retry_tutoring"]');
  await expect(tutoringActions).toHaveCount(1);
  await expect(tutoringActions).toContainText("重试未通过的辅导微测");
  await expect(tutoringActions).not.toContainText("继续辅导计划");
});
