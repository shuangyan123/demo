import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/layout-assertions";
import { l6Mistake, l6ReviewAttempt, l6ReviewEvent, openL6Nav, seedL6 } from "./helpers/recall-l6-fixtures";

test("L6 移动端学习证据面板可展开且无横向溢出", async ({ page }) => {
  const mistake = l6Mistake("mobile-insight");
  const attempt = l6ReviewAttempt("mobile-attempt", mistake.id, "wrong", "2026-09-13");
  await seedL6(page, {
    mistakes: [mistake],
    attempts: [attempt],
    learningEvents: [l6ReviewEvent(attempt, { selfConfidence: 5, selfConfidenceProtocol: "pre_feedback_1_5_v1" })],
  });
  await openL6Nav(page, "错题库", true);
  await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
  const panel = page.getByRole("region", { name: "学习证据", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("自信度记录 1/1 次");
  await panel.getByText("查看学习证据明细", { exact: true }).click();
  await expect(panel).toContainText("来源尝试 mobile-attempt");
  await expectNoHorizontalOverflow(page);
  const box = await panel.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
});

test("L6 移动端复盘自评控件可触摸并在反馈后冻结", async ({ page }) => {
  const mistake = l6Mistake("mobile-review");
  await seedL6(page, { mistakes: [mistake] });
  await openL6Nav(page, "错题库", true);
  await page.getByRole("button", { name: /L6 错题 mobile-review.*判断推理/ }).click();
  await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
  const confidence = page.getByRole("radio", { name: "3 · 一般" });
  await confidence.check();
  await page.getByRole("button", { name: "查看答案", exact: true }).click();
  await expect(confidence).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});
