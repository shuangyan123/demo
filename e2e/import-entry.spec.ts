import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function countStore(page: import("@playwright/test").Page, storeName: string): Promise<number> {
  return page.evaluate((name) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction(name, "readonly");
      const countRequest = transaction.objectStore(name).count();
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    };
  }), storeName);
}

test("粉笔实验直连以进度同步异常草稿，确认前不写错题库", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.route("**/api/import/fenbi/validate", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ valid: true }) }));
  await page.route("**/api/import/fenbi/sync", (route) => route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    body: [
      { type: "stage", stage: "questions" },
      { type: "progress", completed: 1, total: 1 },
      { type: "drafts", drafts: [{ id: "fenbi-draft-e2e", sourceId: "fenbi-question-e2e", selected: true, needsReview: true, issues: ["missing_answer"], board: "判断推理", source: "粉笔账户同步", stem: "E2E 粉笔同步异常题干", options: ["A. 选项"], answer: "", myAnswer: "B", explanation: "待补充", reasons: [], tags: ["粉笔同步"], mastery: 2, confidence: 0.9 }] },
      { type: "done", parsed: 1, duplicates: 0, pending: 1 },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "粉笔导入" }).first().click();
  await page.getByRole("button", { name: "配置粉笔 Cookie" }).click();
  await page.getByRole("textbox", { name: "粉笔 Cookie" }).fill("session=e2e-cookie-secret");
  await page.getByRole("button", { name: "保存并验证" }).click();
  await expect(page.getByText(/已连接 · sess\.\.\.cret/)).toBeVisible();
  await page.getByRole("button", { name: "同步错题" }).click();

  await expect(page.locator("strong", { hasText: "E2E 粉笔同步异常题干" }).first()).toBeVisible();
  expect(await countStore(page, "mistakes")).toBe(0);
  expect(await countStore(page, "importDrafts")).toBe(1);
  await page.getByRole("button", { name: "确认入库" }).click();
  await expect(page.getByRole("button", { name: "撤销本批" })).toBeVisible();
  expect(await countStore(page, "mistakes")).toBe(1);
  await page.getByRole("button", { name: "撤销本批" }).click();
  expect(await countStore(page, "mistakes")).toBe(0);
  expect(await countStore(page, "importDrafts")).toBe(1);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("知识库可手动新增资料并立即展示", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.getByRole("region", { name: "公考学习链路" }).getByRole("button", { name: /知识沉淀/ }).click();
  await expect(page.getByRole("heading", { name: "知识库", exact: true })).toBeVisible();

  const knowledgeForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存到知识库" }) });
  await knowledgeForm.getByLabel("标题").fill("E2E 知识资料标题");
  await knowledgeForm.getByLabel("摘要").fill("用于端到端测试的知识摘要");
  await knowledgeForm.getByLabel("标签").fill("e2e,资料");
  await knowledgeForm.getByLabel("来源").fill("E2E 手动新增");
  await knowledgeForm.getByLabel("正文").fill("这是一段用于端到端测试的知识资料正文。");
  await knowledgeForm.getByRole("button", { name: "保存到知识库" }).click();

  await expect(page.getByText("知识条目已保存")).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E 知识资料标题/ }).first()).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("手动录入可保存错题并在错题库中展示", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  await page.goto("/");
  await expect(page).toHaveTitle("错题复盘");
  await page.locator(".dashboard-configuration-health > summary").click();
  await page.locator(".dashboard-configuration-health").getByRole("button", { name: "手动录入" }).click();

  const entryForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存错题" }) });
  await entryForm.getByLabel("板块").selectOption("资料分析");
  await entryForm.getByLabel("来源").fill("E2E 手动录入");
  await entryForm.getByLabel("标签").fill("e2e,错题");
  await entryForm.getByLabel("初始掌握度").selectOption("2");
  await entryForm.getByLabel("题干").fill("E2E 手动录入题干：资料分析增长率判断。");
  await entryForm.getByLabel("答案").fill("B");
  await entryForm.getByLabel("错因").fill("公式混淆");
  await entryForm.getByLabel("解析").fill("先判断基期，再比较增长率。");
  await entryForm.getByRole("button", { name: "保存错题" }).click();

  await expect(page.getByText("错题已保存到 IndexedDB")).toBeVisible();
  const learningRow = page.getByRole("button", { name: /E2E 手动录入题干：资料分析增长率判断。/ });
  await expect(page.getByRole("heading", { name: "学习数据" })).toBeVisible();
  await expect(learningRow).toBeVisible();
  await learningRow.click();
  await page.getByRole("button", { name: "在新对话中继续" }).click();
  await expect(page.locator(".conversation-context-bar").getByText("错题库", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "对话输入" })).toHaveValue("请分析我的错误思路，并给出一步一步的正确解法。");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /摄像头/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /屏幕共享/ })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
