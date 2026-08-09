import { expect, test, type Page } from "@playwright/test";

const LEARNING_STORES = [
  "mistakes",
  "attempts",
  "knowledgeEntries",
  "knowledgeAttempts",
  "interviewPracticePlans",
  "interviewSessions",
  "interviewEvaluations",
  "tutoringSessions",
  "tutoringTurns",
  "tutoringPlans",
];

async function replaceLearningFacts(page: Page, records: Record<string, unknown[]>): Promise<void> {
  await page.evaluate(async ({ stores, nextRecords }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const available = stores.filter((store) => database.objectStoreNames.contains(store));
      const transaction = database.transaction(available, "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("学习事实写入事务已中止"));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      try {
        for (const storeName of available) {
          const store = transaction.objectStore(storeName);
          store.clear();
          for (const record of nextRecords[storeName] ?? []) store.put(record);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
  }), { stores: LEARNING_STORES, nextRecords: records });
}

test("本地证据变化会在刷新后重建确定性学习行动队列", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  const past = "2026-08-01T08:00:00.000Z";
  await replaceLearningFacts(page, {
    mistakes: [{ id: "loop-mistake", board: "判断推理", source: "E2E", stem: "Learning Loop 到期错题", answer: "A", explanation: "验证复盘后队列更新", reasons: ["条件关系混淆"], tags: [], mastery: 1, nextReviewAt: "2026-08-01", createdAt: past, updatedAt: past }],
    attempts: [{ id: "loop-attempt", mistakeId: "loop-mistake", result: "wrong", confidence: 2, reviewedAt: past }],
    knowledgeEntries: [{ id: "future-knowledge", category: "常识判断", title: "未来稳定知识", summary: "尚未到期", content: "未来稳定知识正文", tags: [], source: "E2E", favorite: false, mastery: 5, nextReviewAt: "2099-01-01", reviewCount: 2, createdAt: past, updatedAt: past }],
    knowledgeAttempts: [{ id: "future-knowledge-attempt", knowledgeId: "future-knowledge", result: "correct", confidence: 4, reviewedAt: past }],
    interviewPracticePlans: [{ id: "loop-interview-plan", title: "结构化面试复练", type: "structured", questionIds: ["question-1"], targetSessionCount: 3, completedSessionCount: 1, nextPracticeAt: "2026-08-01T08:00:00.000Z", status: "active", reason: "保持结构表达", createdAt: past, updatedAt: past }],
  });
  await page.reload();

  const mistakeAction = page.locator('[data-learning-action="review_mistakes"]');
  await expect(mistakeAction).toContainText("复盘 1 道到期错题");
  await expect(mistakeAction).toContainText("1 道最近答错");
  await expect(page.locator('[data-learning-action="practice_interview"]')).toContainText("完成到期面试训练");
  await expect(page.getByText("未来稳定知识", { exact: true })).toHaveCount(0);

  await mistakeAction.getByText("为什么推荐？", { exact: true }).click();
  await expect(mistakeAction.getByRole("list", { name: "本地证据来源" })).toContainText("错题记录");
  await expect(mistakeAction.getByRole("list", { name: "本地证据来源" })).toContainText("复盘结果");
  await expect(mistakeAction).not.toContainText("loop-mistake");

  await mistakeAction.getByRole("button", { name: "开始复盘" }).click();
  await expect(page.getByRole("heading", { name: "Learning Loop 到期错题" })).toBeVisible();
  await page.getByRole("button", { name: "会做" }).click();
  await expect(page.getByText("复盘记录已保存")).toBeVisible();

  await page.goto("/");
  await expect(page.locator('[data-learning-action="review_mistakes"]')).toHaveCount(0);
  await expect(page.locator('[data-learning-action="practice_interview"]')).toBeVisible();
});

test("空学习档案不会制造推荐", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await replaceLearningFacts(page, {});
  await page.reload();
  await expect(page.getByText("暂无足够学习记录形成今日推荐。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-learning-action]")).toHaveCount(0);
});
