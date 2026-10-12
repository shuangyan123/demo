import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function readReviewConversations(page: import("@playwright/test").Page) {
  return page.evaluate(() => new Promise<Array<{ id: string; projectId: string; title: string }>>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("aiConversations", "readonly");
      const records = transaction.objectStore("aiConversations").getAll();
      records.onsuccess = () => resolve(records.result.map(({ id, projectId, title }) => ({ id, projectId, title })));
      records.onerror = () => reject(records.error);
    };
  }));
}

test("UI 审查对话数据提供主题目录、阅读保护和跳到最新消息", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
      nativeScrollIntoView.call(this, options);
      return { unexpectedCleanup: true };
    };
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/?ui-review=1");
  await page.getByRole("button", { name: "新对话" }).first().click();

  await page.locator(".sample-scenario-trigger").click();
  await page.getByLabel("选择当前页面审查场景").selectOption("conversation-normal");
  await page.getByRole("button", { name: "载入本页" }).click();
  await expect.poll(() => readReviewConversations(page), { timeout: 80_000 }).toContainEqual(expect.objectContaining({
    id: "ui-review:conversation-normal:conversation",
    projectId: "civil-service",
  }));
  await page.reload();
  await page.getByRole("button", { name: "必要条件与充分条件", exact: true }).click();

  const topics = page.getByRole("navigation", { name: "对话主题目录" });
  await expect(topics).toBeVisible();
  await expect(topics.getByRole("button")).toHaveCount(6);
  await expect(topics.locator("button.is-latest")).toHaveCount(1);
  await expect(topics.getByRole("button").last()).toHaveClass(/is-latest/);
  await topics.getByRole("button").first().hover();
  const topicPreview = page.locator('body > .conversation-topic-preview[role="tooltip"]');
  await expect(topicPreview).toBeVisible();
  await expect(topicPreview).toContainText("先记住：有它未必行");
  await page.screenshot({ path: testInfo.outputPath("conversation-topic-preview-desktop.png"), fullPage: false });
  const contextTrigger = page.getByRole("button", { name: /查看对话上下文用量/ });
  await expect(contextTrigger).toBeVisible();
  await contextTrigger.focus();
  const contextDialog = page.getByRole("tooltip", { name: "背景信息窗口" });
  await expect(contextDialog).toBeVisible();
  await expect(page.locator('body > [role="tooltip"][aria-label="背景信息窗口"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("conversation-context-budget-desktop.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(contextDialog).toBeHidden();
  await expect(contextTrigger).toBeFocused();
  await topics.getByRole("button", { name: /必要条件的常见题型陷阱/ }).click();

  const messageList = page.locator('[data-scroll-owner="conversation-canvas"]');
  await messageList.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  const jump = page.getByRole("button", { name: "跳到最新消息" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toBeHidden();

  await page.screenshot({ path: testInfo.outputPath("v0.2.2-conversation-topics-desktop.png"), fullPage: false });
  await expect(page.getByText("工作台暂时无法显示")).toHaveCount(0);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("完整 UI 审查数据刷新后保留且可以精准清理", async ({ page }, testInfo) => {
  await page.goto("/?ui-review=1");
  const launcher = page.locator(".sample-scenario-trigger");
  const installedCount = launcher.locator("em");
  await launcher.click();
  const installAll = page.getByRole("button", { name: "载入完整数据", exact: true });
  await expect(installAll).toBeEnabled();
  const previousWorkspace = await page.getByRole("main").elementHandle();
  const previousInstallButton = await installAll.elementHandle();
  if (!previousWorkspace || !previousInstallButton) throw new Error("安装前的工作台与按钮必须存在");

  const busyTransition = await test.step("观察实际 busy 转换，不以已可见的 launcher 代表安装完成", async () => {
    // 在 click 前观察原生 disabled 属性，快速安装也不会漏掉真实的 busy 阶段。
    const observation = await previousInstallButton.evaluateHandle((element) => {
      const button = element as HTMLButtonElement;
      const state = { entered: false, connected: false, at: 0 };
      const observer = new MutationObserver(() => {
        if (!button.disabled) return;
        state.entered = true;
        state.connected = button.isConnected;
        state.at = performance.now();
        observer.disconnect();
      });
      observer.observe(button, { attributes: true, attributeFilter: ["disabled"] });
      return { state, disconnect: () => observer.disconnect() };
    });
    try {
      await installAll.click();
      await expect.poll(() => observation.evaluate(({ state }) => state.entered)).toBe(true);
      const state = await observation.evaluate(({ state }) => state);
      expect(state.connected).toBe(true);
      return state;
    } finally {
      await observation.evaluate(({ disconnect }) => disconnect());
      await observation.dispose();
      await previousInstallButton.dispose();
    }
  });

  // installAll 完成后 controllerKey 有意换代；等待旧 main 脱离，再读取新工作台。
  await expect.poll(() => previousWorkspace.evaluate((element) => element.isConnected), { timeout: 15_000 }).toBe(false);
  const remountObservedAt = await page.evaluate(() => performance.now());
  await previousWorkspace.dispose();
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "学习详情", exact: true })).toBeVisible();
  await expect(installedCount).toHaveText(/^[1-9]\d*$/);
  const count = await installedCount.innerText();
  const fixtureConversation = expect.objectContaining({ id: "ui-review:conversation-normal:conversation", projectId: "civil-service" });
  await expect.poll(() => readReviewConversations(page)).toContainEqual(fixtureConversation);
  await launcher.click();
  const reviewDialog = page.getByRole("dialog", { name: "UI 审查数据", exact: true });
  await expect(reviewDialog.getByRole("button", { name: "载入完整数据", exact: true })).toBeEnabled();
  await expect(reviewDialog).toContainText(`已安装 ${count} 条，可精准清理`);
  await reviewDialog.getByRole("button", { name: "关闭 UI 审查数据", exact: true }).click();
  const readyAt = await page.evaluate(() => performance.now());
  const readyWorkspace = await page.getByRole("main").elementHandle();
  if (!readyWorkspace) throw new Error("安装后的工作台必须已就绪");

  const disclosure = page.locator("details.dashboard-disclosure").filter({ hasText: "六大板块" });
  const disclosureClickAt = await page.evaluate(() => performance.now());
  await disclosure.locator("summary").click();
  await expect(page.getByText("今日队列", { exact: true })).toBeVisible();
  await expect(page.getByText("薄弱板块", { exact: true })).toBeVisible();
  await expect(disclosure).toHaveAttribute("open", "");
  const workspaceStillConnected = await readyWorkspace.evaluate((element) => element.isConnected);
  expect(workspaceStillConnected).toBe(true);
  await readyWorkspace.dispose();

  await page.reload();
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible({ timeout: 15_000 });
  await expect(installedCount).toHaveText(count);
  await expect.poll(() => readReviewConversations(page)).toContainEqual(fixtureConversation);
  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("button", { name: "删除审查数据" }).click();
  await expect(page.getByRole("button", { name: "删除审查数据" })).toBeHidden();
  await expect.poll(() => readReviewConversations(page)).toEqual([]);
  await expect(installedCount).toHaveCount(0);
  await testInfo.attach("ui-review-install-readiness", {
    body: Buffer.from(JSON.stringify({ busyTransition, remountObservedAt, readyAt, disclosureClickAt, count, workspaceStillConnected, reloadPersisted: true, cleanupVerified: true })),
    contentType: "application/json",
  });
});
