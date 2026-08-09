import { expect, test, type Page } from "@playwright/test";
import { replaceLearningFacts } from "./helpers/learning-loop-fixtures";
import { expectNoHorizontalOverflow } from "./helpers/layout-assertions";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

const past = "2026-08-01T08:00:00.000Z";

async function seedMobileRecommendations(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await replaceLearningFacts(page, {
    mistakes: [
      { id: "mobile-review-due", board: "判断推理", source: "E2E", stem: "移动端需要复盘的超长条件关系错题", answer: "A", explanation: "", reasons: ["充分条件与必要条件关系混淆"], tags: [], mastery: 1, nextReviewAt: "2026-08-01", createdAt: past, updatedAt: past },
      { id: "mobile-review-pattern", board: "资料分析", source: "E2E", stem: "移动端重复错因的第二道独立证据", answer: "B", explanation: "", reasons: ["充分条件与必要条件关系混淆"], tags: [], mastery: 2, nextReviewAt: "2099-01-01", createdAt: past, updatedAt: past },
    ],
    attempts: [{ id: "mobile-attempt", mistakeId: "mobile-review-due", result: "wrong", confidence: 2, reviewedAt: past }],
    knowledgeEntries: [{ id: "mobile-knowledge-due", category: "常识判断", title: "移动端需要训练的超长知识资料标题", summary: "闭卷回想", content: "知识正文", tags: [], source: "E2E", favorite: false, mastery: 2, nextReviewAt: "2026-08-01", reviewCount: 0, createdAt: past, updatedAt: past }],
    interviewPracticePlans: [{ id: "mobile-interview-plan", title: "移动端结构化面试表达训练计划", type: "structured", questionIds: ["mobile-question"], targetSessionCount: 3, completedSessionCount: 0, nextPracticeAt: past, status: "active", reason: "验证移动端模块导航", createdAt: past, updatedAt: past }],
  });
}

test("移动端推荐可读、依据可展开且 Review 与 Knowledge CTA 可用", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await seedMobileRecommendations(page);
  await page.reload();

  const section = page.getByRole("region", { name: "今日学习", exact: true });
  await expect(section).toBeVisible();
  const cards = section.locator("[data-learning-action]");
  await expect(cards).toHaveCount(4);
  await expectNoHorizontalOverflow(page);

  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    await expect(card.getByRole("heading", { level: 3 })).toBeVisible();
    await expect(card.getByText(/^完成条件：/)).toBeVisible();
    await expect(card.getByRole("button")).toBeVisible();
    const size = await card.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
  }

  const reviewAction = section.locator('[data-learning-action="review_mistakes"]').filter({ hasText: "复盘 1 道到期错题" });
  await reviewAction.getByText("为什么推荐？", { exact: true }).click();
  await expect(reviewAction.locator("details")).toHaveAttribute("open", "");
  await expect(reviewAction.getByText("到期错题复盘；最近答错或不确定会在同级中提前。", { exact: true })).toBeVisible();
  const evidence = reviewAction.getByRole("list", { name: "本地证据来源" });
  await expect(evidence).toContainText("错题记录");
  await expect(evidence).toContainText("复盘结果");
  await expect(reviewAction).not.toContainText(/mobile-review|mobile-attempt|P[1-4]/);
  await expectNoHorizontalOverflow(page);
  const disclosureAndCta = await reviewAction.evaluate((element) => {
    const details = element.querySelector("details")!.getBoundingClientRect();
    const button = element.querySelector("button")!.getBoundingClientRect();
    return { detailsBottom: details.bottom, buttonTop: button.top };
  });
  expect(disclosureAndCta.buttonTop).toBeGreaterThanOrEqual(disclosureAndCta.detailsBottom - 1);

  await reviewAction.getByRole("button", { name: "开始复盘" }).click();
  await expect(page.getByRole("heading", { name: "移动端需要复盘的超长条件关系错题" })).toBeVisible();

  await page.goto("/");
  const knowledgeAction = page.locator('[data-learning-action="review_knowledge"]');
  await knowledgeAction.getByRole("button", { name: "进入训练" }).click();
  await expect(page.locator("main").getByText("移动端需要训练的超长知识资料标题", { exact: true }).first()).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("360×800 窄屏保持文本换行、CTA 可达且无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await seedMobileRecommendations(page);
  await page.reload();

  const section = page.getByRole("region", { name: "今日学习", exact: true });
  const cards = section.locator("[data-learning-action]");
  await expect(cards).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  for (let index = 0; index < await cards.count(); index += 1) {
    const card = cards.nth(index);
    await card.getByRole("button").scrollIntoViewIfNeeded();
    await expect(card.getByRole("button")).toBeVisible();
    const textFit = await card.evaluate((element) => [...element.querySelectorAll<HTMLElement>("h3, p, li")].every((item) => item.scrollWidth <= item.clientWidth + 1));
    expect(textFit).toBe(true);
  }
});
