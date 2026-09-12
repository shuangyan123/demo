import { expect, test, type Page } from "@playwright/test";
import { replaceLearningFacts } from "./learning-loop-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./runtime-errors";
import { expectNoHorizontalOverflow } from "./layout-assertions";

const past = "2026-08-01";
function mistake(n: number, nextReviewAt = past) {
  return { id: `u2-m${n}`, board: "判断推理", source: "U2 E2E", stem: `U2 错题 ${n}`, answer: "A", explanation: "条件关系", reasons: [], tags: [], mastery: n, nextReviewAt, createdAt: past, updatedAt: past };
}
function knowledge(n: number, nextReviewAt = past) {
  return { id: `u2-k${n}`, category: "常识判断", title: `U2 知识 ${n}`, summary: "主动回忆", content: "知识正文", tags: [], source: "U2 E2E", favorite: true, mastery: n, nextReviewAt, reviewCount: 0, createdAt: past, updatedAt: past };
}
async function seed(page: Page, records: Record<string, unknown[]>) {
  await page.clock.setFixedTime(new Date("2026-09-12T08:00:00Z"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
  await replaceLearningFacts(page, records);
  await page.reload();
  await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
}
async function nav(page: Page, name: string, mobile: boolean) {
  if (mobile) await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  const sidebar = mobile ? page.getByRole("dialog", { name: "应用导航" }) : page.locator(".chrome-sidebar:visible");
  if (!["总览", "已安排"].includes(name)) {
    for (const label of ["公考", "学习"]) {
      const summary = sidebar.locator("summary").filter({ hasText: label }).first();
      await expect(summary).toBeVisible();
      if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
    }
  }
  await sidebar.getByRole("button", { name, exact: true }).click();
  if (mobile) await expect(sidebar).toBeHidden();
}
async function attemptCount(page: Page, storeName: string) {
  return page.evaluate((store) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction(store).objectStore(store).count();
      count.onsuccess = () => { resolve(count.result); db.close(); };
      count.onerror = () => reject(count.error);
    };
  }), storeName);
}
const completion = (page: Page) => page.getByRole("region", { name: "本轮学习完成" });

export function continuitySuite(mobile: boolean) {
  test("错题库逐题提交 → 完成 → 键盘进入知识训练 → 完成返回总览", async ({ page }, testInfo) => {
    const errors = collectRuntimeErrors(page);
    await seed(page, { mistakes: [mistake(1), mistake(2)], knowledgeEntries: [knowledge(1), knowledge(2)] });
    await expect(page).toHaveTitle("Recall");
    await nav(page, "错题库", mobile);
    await page.getByRole("button", { name: /U2 错题 1.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 2", exact: true })).toBeVisible();
    await expect(completion(page)).toHaveCount(0);
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await expect(completion(page)).toContainText("已完成 2 道");
    const primary = completion(page).getByRole("button", { name: "训练 2 个到期知识点", exact: true });
    await expect(primary).toBeVisible();
    expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(completion(page).getByRole("heading", { name: "本轮复盘完成" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS("outline-style", "solid");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("review-completion.png"), fullPage: false });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "会了", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "会了", exact: true }).click();
    await expect(page.getByRole("heading", { name: "第 1 条 / 1", exact: true })).toBeVisible();
    await expect(completion(page)).toHaveCount(0);
    await page.getByRole("button", { name: "会了", exact: true }).click();
    await expect(completion(page)).toContainText("已完成 2 条");
    await expect(completion(page).getByRole("button")).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("knowledge-completion.png"), fullPage: false });
    await completion(page).getByRole("button", { name: "返回总览", exact: true }).click();
    await expect(page.getByRole("heading", { name: "今日学习" })).toBeVisible();
    expect(await attemptCount(page, "attempts")).toBe(2);
    expect(await attemptCount(page, "knowledgeAttempts")).toBe(2);
    await expectNoFrameworkOverlay(page);
    expectNoRuntimeErrors(errors);
  });

  test("知识全部队列每条只提交一次，结束按当前状态进入错题复盘", async ({ page }) => {
    await seed(page, { mistakes: [mistake(1)], knowledgeEntries: [knowledge(1), knowledge(2, "2099-01-01")] });
    await nav(page, "知识训练", mobile);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("button", { name: "会了", exact: true }).click();
    await expect(page.getByRole("heading", { name: "第 1 条 / 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "会了", exact: true }).click();
    await expect(completion(page)).toContainText("已完成 2 条");
    await completion(page).getByRole("button", { name: "复盘 1 道到期错题", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 1", exact: true })).toBeVisible();
    expect(await attemptCount(page, "knowledgeAttempts")).toBe(2);
  });

  test("薄弱分析仅按已有目标进入复盘和知识训练，不为未来资料制造 CTA", async ({ page }) => {
    await seed(page, { mistakes: [mistake(1), mistake(2, "2099-01-01")], knowledgeEntries: [knowledge(1)] });
    await nav(page, "错题库", mobile);
    await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
    const insights = page.getByRole("region", { name: "薄弱分析", exact: true });
    const future = insights.getByRole("article").filter({ hasText: "U2 错题 2" });
    await expect(future.getByRole("button")).toHaveCount(0);
    await insights.getByRole("article").filter({ hasText: "U2 错题 1" }).getByRole("button", { name: "开始复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 1", exact: true })).toBeVisible();
    await nav(page, "错题库", mobile);
    await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
    await insights.getByRole("button", { name: "进入知识训练", exact: true }).click();
    await expect(page.getByRole("button", { name: "会了", exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText("U2 知识 1");
    await expectNoHorizontalOverflow(page);
  });

  test("点选队列后部仍继续剩余题，答错保持真实到期推荐并等待点击", async ({ page }) => {
    await seed(page, { mistakes: [mistake(1), mistake(2)] });
    await nav(page, "错题库", mobile);
    await page.getByRole("button", { name: /U2 错题 2.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "不会", exact: true }).click();
    await expect(completion(page)).toContainText("已完成 2 道");
    await completion(page).getByRole("button", { name: "复盘 1 道到期错题", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 1", exact: true })).toBeVisible();
    expect(await attemptCount(page, "attempts")).toBe(2);
  });

  test("错题库明确选择未到期题时不回退到其他题", async ({ page }) => {
    await seed(page, { mistakes: [mistake(1), mistake(2, "2099-01-01")] });
    await nav(page, "错题库", mobile);
    await page.getByRole("button", { name: /U2 错题 2.*判断推理/ }).click();
    await page.getByRole("button", { name: "开始这道复盘", exact: true }).click();
    await expect(page.getByRole("heading", { name: "U2 错题 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await expect(completion(page)).toContainText("已完成 1 道");
    await expect(completion(page).getByRole("button", { name: "复盘 1 道到期错题", exact: true })).toBeVisible();
  });

  test("已有已安排任务仅提供导航，不创建或执行任务", async ({ page }) => {
    await seed(page, { mistakes: [mistake(1)] });
    await page.evaluate(async () => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("review_workspace");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("automationDefinitions", "readwrite");
        tx.objectStore("automationDefinitions").put({ id: "u2-scheduled", name: "U2 已有任务", templateId: "daily_review", prompt: "已有计划", sourceScopes: ["mistakes"], enabled: true, timeZone: "Asia/Shanghai", schedule: { kind: "daily", time: "20:00" }, nextRunAt: "2099-01-01T12:00:00Z", createdAt: "2026-08-01", updatedAt: "2026-08-01" });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload();
    await nav(page, "错题复盘", mobile);
    await page.getByRole("button", { name: "会做", exact: true }).click();
    await completion(page).getByRole("button", { name: "查看已安排", exact: true }).click();
    await expect(page.getByRole("button", { name: "新建任务", exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText("U2 已有任务");
    expect(await attemptCount(page, "automationDefinitions")).toBe(1);
    expect(await attemptCount(page, "automationRuns")).toBe(0);
  });

  test("重复提交及提交后刷新失败都不会重放写入，手动重读后显示下一步", async ({ page }) => {
    // Dexie 在数据库打开时绑定原生 transaction，故障钩子必须先于应用初始化安装。
    await page.addInitScript(() => {
      const original = IDBDatabase.prototype.transaction;
      let failRead = false;
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        const names = typeof stores === "string" ? [stores] : Array.from(stores);
        if (failRead && mode === "readonly" && names.includes("mistakes")) {
          failRead = false;
          throw new Error("U2 injected refresh failure");
        }
        const tx = original.call(this, stores, mode, options);
        // 在写事务创建时布置下一次只读故障，避免 complete 监听与 Dexie 的微任务顺序竞态。
        if (mode === "readwrite" && names.includes("attempts") && document.documentElement.dataset.u2FailRead === "armed") {
          failRead = true;
          delete document.documentElement.dataset.u2FailRead;
        }
        return tx;
      };
    });
    await seed(page, { mistakes: [mistake(1)], knowledgeEntries: [knowledge(1)] });
    await nav(page, "错题复盘", mobile);
    await expect(page.getByRole("button", { name: "会做", exact: true })).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.u2FailRead = "armed"; });
    await page.getByRole("button", { name: "会做", exact: true }).evaluate((element) => {
      const button = element as HTMLButtonElement;
      button.click();
      button.click();
    });
    await expect(completion(page)).toContainText("暂时无法读取下一步");
    await expect(completion(page).getByRole("button", { name: "训练 1 个到期知识点", exact: true })).toHaveCount(0);
    expect(await attemptCount(page, "attempts")).toBe(1);
    await completion(page).getByRole("button", { name: "重新读取学习状态", exact: true }).click();
    await expect(completion(page).getByRole("button", { name: "训练 1 个到期知识点", exact: true })).toBeVisible();
    expect(await attemptCount(page, "attempts")).toBe(1);
  });
}
