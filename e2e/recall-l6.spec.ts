import { expect, test } from "@playwright/test";
import { l6Knowledge, l6Mistake, l6ReviewAttempt, l6ReviewEvent, openL6Nav, readL6Event, seedL6 } from "./helpers/recall-l6-fixtures";

test.describe("Recall L6 delayed recall and calibration", () => {
  test("错题复盘可选反馈前自评，首次查看后冻结，并原子保存固定协议", async ({ page }) => {
    const mistake = l6Mistake("review-flow");
    await seedL6(page, { mistakes: [mistake] });
    await openL6Nav(page, "错题库");
    await page.getByRole("button", { name: /L6 错题 review-flow.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "L6 错题 review-flow", exact: true })).toBeVisible();
    await expect(page.getByText("L6 错因 review-flow", { exact: true })).toHaveCount(0);

    const confidence = page.getByRole("radio", { name: "5 · 很有把握" });
    await confidence.check();
    await expect(confidence).toBeChecked();
    await page.getByRole("button", { name: "查看答案", exact: true }).click();
    await expect(page.getByText("L6 解析 review-flow", { exact: true })).toBeVisible();
    await expect(confidence).toBeDisabled();
    await expect(page.getByRole("button", { name: "清除自评", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "不会", exact: true }).click();
    await expect(page.getByRole("region", { name: "本轮学习完成" })).toBeVisible();

    const event = await readL6Event(page, "review_attempt", mistake.id);
    expect(event?.selfConfidence).toBe(5);
    expect(event?.selfConfidenceProtocol).toBe("pre_feedback_1_5_v1");
    expect(event?.practiceKind).toBe("standard");
  });

  test("直接提交错题结果允许跳过自信度且不伪造记录", async ({ page }) => {
    const mistake = l6Mistake("review-skip");
    await seedL6(page, { mistakes: [mistake] });
    await openL6Nav(page, "错题库");
    await page.getByRole("button", { name: /L6 错题 review-skip.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("radio", { name: "1 · 完全没把握" })).not.toBeChecked();
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await expect(page.getByRole("region", { name: "本轮学习完成" })).toBeVisible();
    const event = await readL6Event(page, "review_attempt", mistake.id);
    expect(event && "selfConfidence" in event).toBe(false);
    expect(event && "selfConfidenceProtocol" in event).toBe(false);
  });

  test("知识训练在查看资料前隐藏摘要正文，查看后冻结自评并保存", async ({ page }) => {
    const entry = l6Knowledge("knowledge-flow");
    await seedL6(page, { knowledgeEntries: [entry] });
    await openL6Nav(page, "知识训练");
    await expect(page.getByText("L6 知识 knowledge-flow", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("L6 摘要 knowledge-flow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("L6 资料正文 knowledge-flow", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "编辑资料", exact: true })).toBeDisabled();

    const confidence = page.getByRole("radio", { name: "2 · 较没把握" });
    await confidence.check();
    await page.getByRole("button", { name: "查看资料", exact: true }).click();
    await expect(page.getByText("L6 资料正文 knowledge-flow", { exact: true })).toBeVisible();
    await expect(confidence).toBeDisabled();
    await expect(page.getByRole("button", { name: "编辑资料", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "不会", exact: true }).click();
    await expect(page.getByRole("region", { name: "本轮学习完成" })).toBeVisible();

    const event = await readL6Event(page, "knowledge_attempt", entry.id);
    expect(event?.selfConfidence).toBe(2);
    expect(event?.selfConfidenceProtocol).toBe("pre_feedback_1_5_v1");
  });

  test("切换知识训练对象会隔离上一对象的自评", async ({ page }) => {
    const first = l6Knowledge("isolation-a", "2026-09-01");
    const second = l6Knowledge("isolation-b", "2026-09-02");
    await seedL6(page, { knowledgeEntries: [first, second] });
    await openL6Nav(page, "知识训练");
    await expect(page.getByRole("heading", { name: "第 1 条 / 2", exact: true })).toBeVisible();
    const firstConfidence = page.getByRole("radio", { name: "4 · 较有把握" });
    await firstConfidence.check();
    await expect(firstConfidence).toBeChecked();
    await page.getByRole("button", { name: "下一条", exact: true }).click();
    await expect(page.getByRole("heading", { name: "第 2 条 / 2", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "4 · 较有把握" })).not.toBeChecked();
    const secondConfidence = page.getByRole("radio", { name: "2 · 较没把握" });
    await secondConfidence.check();
    await expect(secondConfidence).toBeChecked();
    await page.getByRole("button", { name: "不会", exact: true }).click();
    await expect.poll(async () => (await readL6Event(page, "knowledge_attempt", second.id))?.selfConfidence).toBe(2);
    const event = await readL6Event(page, "knowledge_attempt", second.id);
    expect(event?.selfConfidence).toBe(2);
    expect(event?.selfConfidenceProtocol).toBe("pre_feedback_1_5_v1");
    expect(event?.selfConfidence).not.toBe(4);
  });

  test("切换错题复盘对象会接受新对象的首次自评并持久化", async ({ page }) => {
    const first = l6Mistake("review-isolation-a", "2026-09-01");
    const second = l6Mistake("review-isolation-b", "2026-09-02");
    await seedL6(page, { mistakes: [first, second] });
    await openL6Nav(page, "错题库");
    await page.getByRole("button", { name: /L6 错题 review-isolation-a.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "L6 错题 review-isolation-a", exact: true })).toBeVisible();
    const firstConfidence = page.getByRole("radio", { name: "5 · 很有把握" });
    await firstConfidence.check();
    await expect(firstConfidence).toBeChecked();

    await openL6Nav(page, "错题库");
    await page.getByRole("button", { name: /L6 错题 review-isolation-b.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "L6 错题 review-isolation-b", exact: true })).toBeVisible();
    const secondConfidence = page.getByRole("radio", { name: "2 · 较没把握" });
    await expect(secondConfidence).not.toBeChecked();
    await secondConfidence.check();
    await expect(secondConfidence).toBeChecked();
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await expect.poll(async () => (await readL6Event(page, "review_attempt", second.id))?.selfConfidence).toBe(2);
    const event = await readL6Event(page, "review_attempt", second.id);
    expect(event?.selfConfidence).toBe(2);
    expect(event?.selfConfidenceProtocol).toBe("pre_feedback_1_5_v1");
    expect(event?.selfConfidence).not.toBe(5);
  });

  test("薄弱分析显示描述性 L6 学习证据而不显示旧跨日率", async ({ page }) => {
    const mistake = l6Mistake("insight");
    const previous = l6ReviewAttempt("insight-old", mistake.id, "wrong", "2026-09-12");
    const current = l6ReviewAttempt("insight-current", mistake.id, "correct", "2026-09-14");
    await seedL6(page, {
      mistakes: [mistake],
      attempts: [previous, current],
      learningEvents: [
        l6ReviewEvent(previous, { selfConfidence: 5, selfConfidenceProtocol: "pre_feedback_1_5_v1" }),
        l6ReviewEvent(current, { selfConfidence: 2, selfConfidenceProtocol: "pre_feedback_1_5_v1" }),
      ],
    });
    await openL6Nav(page, "错题库");
    await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
    const panel = page.getByRole("region", { name: "学习证据", exact: true });
    await expect(panel).toContainText("自信度记录 2/2 次");
    await expect(panel).toContainText("跨日自评答对 1/1 个对象日");
    await expect(panel).toContainText("高把握记录中自评答错 1/1 次");
    await expect(panel).toContainText("低把握记录中自评答对 1/1 次");
    await expect(page.getByText("跨日复习通过率", { exact: true })).toHaveCount(0);
    await panel.getByText("查看学习证据明细", { exact: true }).click();
    await expect(panel).toContainText("来源尝试 insight-current");
    await expect(panel).toContainText("协议 pre_feedback_1_5_v1");
  });
});
