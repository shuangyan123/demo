import { expect, test, type Page } from "@playwright/test";
import { seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function seedConversationAttachments(page: Page, conversationId: string, count: number): Promise<void> {
  await page.evaluate(async ({ conversationId: id, count: attachmentCount }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("review_workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("aiConversationAttachments", "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      const timestamp = new Date().toISOString();
      const store = transaction.objectStore("aiConversationAttachments");
      for (let index = 0; index < attachmentCount; index += 1) {
        store.put({
          id: `context-attachment-${index}`,
          conversationId: id,
          kind: "file",
          label: `学习资料 ${index + 1}.md`,
          summary: `用于上下文滚动验收的本地资料摘要 ${index + 1}，不包含原始文件正文。`,
          mimeType: "text/markdown",
          sizeBytes: 128 + index,
          createdAt: timestamp,
        });
      }
    };
  }), { conversationId, count });
}

async function waitForLayoutTransition(page: Page): Promise<void> {
  await page.waitForTimeout(240);
}

test("SummaryPopover 与 ContextPanel 在桌面保持独立且使用 push layout", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();

  const summaryTrigger = page.getByRole("button", { name: "查看当前工作区摘要" });
  const contextToggle = page.getByRole("button", { name: "显示上下文面板" });
  await expect(summaryTrigger).toBeVisible();
  await expect(contextToggle).toBeVisible();

  await summaryTrigger.click();
  const summary = page.locator('[data-summary-popover-surface="true"]');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("当前分区");
  await expect(summary).toContainText("总览");
  await page.mouse.click(480, 360);
  await expect(summary).toBeHidden();

  await summaryTrigger.click();
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
  await expect(summaryTrigger).toBeFocused();

  await summaryTrigger.focus();
  await page.keyboard.press("Tab");
  await expect(contextToggle).toBeFocused();
  await expect(contextToggle).toHaveCSS("outline-style", "solid");

  await contextToggle.click();
  const panel = page.locator('[data-context-panel="true"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-context-panel-empty="true"]')).toBeVisible();
  await waitForLayoutTransition(page);
  const desktopGeometry = await page.evaluate(() => {
    const layout = document.querySelector<HTMLElement>(".chrome-layout");
    const frame = document.querySelector<HTMLElement>(".chrome-content-frame");
    const panelElement = document.querySelector<HTMLElement>("[data-context-panel='true']");
    if (!layout || !frame || !panelElement) throw new Error("缺少 ContextPanel 桌面布局节点");
    return {
      columns: getComputedStyle(layout).gridTemplateColumns,
      contentRight: frame.getBoundingClientRect().right,
      panelLeft: panelElement.getBoundingClientRect().left,
      panelWidth: panelElement.getBoundingClientRect().width,
      panelPosition: getComputedStyle(panelElement).position,
    };
  });
  expect(desktopGeometry.panelPosition).toBe("relative");
  expect(desktopGeometry.panelWidth).toBeGreaterThan(300);
  expect(desktopGeometry.panelLeft).toBeGreaterThanOrEqual(desktopGeometry.contentRight - 1);
  expect(desktopGeometry.columns.split(" ").length).toBe(4);
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath("workspace-context-panel-desktop.png"), fullPage: false });

  await page.setViewportSize({ width: 1280, height: 720 });
  await waitForLayoutTransition(page);
  await expect(panel).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const narrowPanelWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
  expect(narrowPanelWidth).toBeGreaterThan(240);
  await panel.getByRole("button", { name: "关闭上下文面板" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(contextToggle).toBeFocused();

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("Conversation registration、摘要、长资料滚动和 model picker 共存", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "context-openai", label: "上下文 OpenAI", provider: "openai", apiFormat: "responses" },
    { id: "context-google", label: "上下文 Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [
    { id: "context-chat", title: "上下文工作台验收", connectionId: "context-openai", modelId: "gpt-5.5" },
  ]);
  await seedConversationAttachments(page, "context-chat", 18);
  await page.reload();

  await page.locator('[data-conversation-id="context-chat"] .conversation-tree-chat-label').click();
  const contextToggle = page.getByRole("button", { name: "显示上下文面板" });
  await contextToggle.click();
  const panel = page.locator('[data-context-panel="true"]');
  await expect(panel).toHaveAttribute("data-context-panel-content-id", "conversation");
  await expect(panel.locator('[data-context-panel-slot="conversation"]')).toBeVisible();
  await expect(panel.locator('[data-context-panel-slot="conversation"] .workspace-context-section-heading')).toContainText("18");
  const scrollMetrics = await panel.locator('[data-context-panel-body="true"]').evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

  const summaryTrigger = page.getByRole("button", { name: "查看当前工作区摘要" });
  await summaryTrigger.click();
  const summary = page.locator('[data-summary-popover-surface="true"]');
  await expect(summary).toContainText("上下文工作台验收");
  await expect(summary).toContainText("gpt-5.5");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
  await expect(panel).toBeVisible();

  const modelTrigger = page.getByRole("button", { name: "选择模型" });
  await modelTrigger.click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  await expect(picker).toBeVisible();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "关闭上下文面板" }).click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(contextToggle).toBeFocused();
  await modelTrigger.click();
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  await contextToggle.click();
  await waitForLayoutTransition(page);
  const conversationGeometry = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".chrome-content-frame");
    const reading = document.querySelector<HTMLElement>(".conversation-reading-column");
    const composer = document.querySelector<HTMLElement>(".conversation-composer");
    const panelElement = document.querySelector<HTMLElement>("[data-context-panel='true']");
    if (!frame || !reading || !composer || !panelElement) throw new Error("缺少对话中心布局节点");
    const center = (rect: DOMRect) => (rect.left + rect.right) / 2;
    return {
      availableCenter: center(frame.getBoundingClientRect()),
      readingCenter: center(reading.getBoundingClientRect()),
      composerCenter: center(composer.getBoundingClientRect()),
      panelLeft: panelElement.getBoundingClientRect().left,
      contentRight: frame.getBoundingClientRect().right,
    };
  });
  expect(Math.abs(conversationGeometry.readingCenter - conversationGeometry.availableCenter)).toBeLessThanOrEqual(1);
  expect(Math.abs(conversationGeometry.composerCenter - conversationGeometry.availableCenter)).toBeLessThanOrEqual(1);
  expect(conversationGeometry.contentRight).toBeLessThanOrEqual(conversationGeometry.panelLeft + 1);
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: testInfo.outputPath("workspace-context-conversation-desktop.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
