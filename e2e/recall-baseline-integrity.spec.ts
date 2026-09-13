import { expect, test, type Page } from "@playwright/test";
import { replaceLearningFacts } from "./helpers/learning-loop-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

const personal = {
  id: "integrity-personal", board: "判断推理", source: "personal", stem: "个人完整性证据题", answer: "A", explanation: "", reasons: ["审题"], tags: [], mastery: 2,
  nextReviewAt: "2026-09-12", createdAt: "2026-09-12", updatedAt: "2026-09-12",
};
const personalAttempt = { id: "integrity-personal-attempt", mistakeId: personal.id, result: "correct", confidence: 2, reviewedAt: "2026-09-12" };

async function openInsights(page: Page) {
  const sidebar = page.locator(".chrome-sidebar:visible");
  for (const label of ["公考", "学习"]) {
    const summary = sidebar.locator("summary").filter({ hasText: label }).first();
    await expect(summary).toBeVisible();
    if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
  }
  await sidebar.getByRole("button", { name: "错题库", exact: true }).click();
  await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "薄弱分析", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "时间范围" }).selectOption("all");
}
async function seedPersonal(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-13T04:00:00Z"));
  await page.goto("/?ui-review=1");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await replaceLearningFacts(page, { mistakes: [personal], attempts: [personalAttempt] });
  await page.reload();
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
}
async function readRecords(page: Page) {
  return page.evaluate(() => new Promise<{ mistakes: Array<{ id: string }>; attempts: Array<{ id: string; reviewedAt: string }> }>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["mistakes", "attempts"]);
      const mistakes = transaction.objectStore("mistakes").getAll();
      const attempts = transaction.objectStore("attempts").getAll();
      transaction.oncomplete = () => { resolve({ mistakes: mistakes.result, attempts: attempts.result }); db.close(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
}

test("personal insight displays only personal evidence", async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await seedPersonal(page); await openInsights(page);
  await expect(page).toHaveTitle("Recall");
  const summary = page.getByRole("region", { name: "学习效果摘要" });
  await expect(summary).toContainText("1 次");
  await expect(summary).toContainText("答对 1 · 不确定 0 · 答错 0");
  await expect(page.getByText(/个人完整性证据题/)).toBeVisible();
  await expectNoFrameworkOverlay(page); expectNoRuntimeErrors(errors);
  await page.screenshot({ path: testInfo.outputPath("personal.png"), fullPage: false });
});

test("dense UI review isolates analytics across install reload and cleanup without changing personal facts", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = collectRuntimeErrors(page);
  const external: string[] = [];
  page.on("request", (request) => { if (!["127.0.0.1", "localhost"].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  await seedPersonal(page); await openInsights(page);
  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("combobox", { name: "选择当前页面审查场景" }).selectOption("library-insights-dense");
  await page.getByRole("button", { name: "载入本页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await openInsights(page);
  const records = await readRecords(page);
  // 密集场景包含五条未来几分钟的记录；未来证据仍遵守既有排除规则。
  const fixtureAttempts = records.attempts.filter((record) => record.id.startsWith("ui-review:"));
  const cutoff = await page.evaluate(() => Date.now());
  const fixtureCount = fixtureAttempts.filter((record) => Date.parse(record.reviewedAt) <= cutoff).length;
  expect(fixtureAttempts.length - fixtureCount).toBe(5);
  expect(fixtureCount).toBeGreaterThanOrEqual(30);
  await expect(page.getByRole("region", { name: "学习效果摘要" })).toContainText(`${fixtureCount} 次`);
  await expect(page.getByText(/个人完整性证据题/)).toHaveCount(0);
  await expect(page.locator("table tbody tr")).toHaveCount(6);
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible();
  await page.reload(); await openInsights(page);
  await expect(page.getByRole("region", { name: "学习效果摘要" })).toContainText(`${fixtureCount} 次`);
  await page.screenshot({ path: testInfo.outputPath("ui-review-dense.png"), fullPage: false });
  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("button", { name: "删除审查数据", exact: true }).click();
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await openInsights(page);
  await expect(page.getByRole("region", { name: "学习效果摘要" })).toContainText("1 次");
  await expect(page.getByText(/个人完整性证据题/)).toBeVisible();
  expect(await readRecords(page)).toEqual({ mistakes: [personal], attempts: [personalAttempt] });
  expect(external).toEqual([]);
  await expectNoFrameworkOverlay(page); expectNoRuntimeErrors(errors);
});
