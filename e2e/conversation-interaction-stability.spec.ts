import { expect, test, type Page } from "@playwright/test";
import {
  enableConversationModelDirectoryRequest,
  readConversationModelSelection,
  seedConversationModelFixtures,
} from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function loadReviewConversation(page: Page): Promise<void> {
  await page.goto("/?ui-review=1");
  await page.getByRole("button", { name: "新对话" }).first().click();
  await page.locator(".sample-scenario-trigger").click();
  await page.getByLabel("选择当前页面审查场景").selectOption("conversation-normal");
  await page.getByRole("button", { name: "载入本页" }).click();
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible({ timeout: 80_000 });
  await page.reload();
  await page.getByRole("button", { name: "必要条件与充分条件", exact: true }).click();
  await expect(page.locator('[data-conversation-layer="workspace"]')).toBeVisible();
}

type WorkspaceGeometry = Record<"sidebar" | "boundary" | "main" | "header" | "title" | "reading" | "composer", { x: number; y: number; width: number; height: number }>;

async function readWorkspaceGeometry(page: Page): Promise<WorkspaceGeometry> {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`缺少几何节点：${selector}`);
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    return {
      sidebar: rect(".chrome-sidebar"),
      boundary: rect(".chrome-sidebar-boundary"),
      main: rect('[data-conversation-layer="workspace"]'),
      header: rect('[data-conversation-layer="thread-header"]'),
      title: rect('[data-conversation-layer="thread-header"] h1'),
      reading: rect('[data-conversation-layer="reading-column"]'),
      composer: rect('[data-conversation-layer="composer-card"]'),
    };
  });
}

test("Topic Preview 离开、点击、失焦和交互菜单打开均不会残留", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadReviewConversation(page);

  const topics = page.getByRole("navigation", { name: "对话主题目录" });
  const firstTopic = topics.getByRole("button").first();
  const preview = page.locator(".conversation-topic-preview");
  const header = page.locator(".conversation-thread-header");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await firstTopic.hover();
    await page.waitForTimeout(40);
    await header.hover({ position: { x: 8, y: 8 } });
    await page.waitForTimeout(220);
    await expect(preview).toHaveCount(0);
  }

  await firstTopic.hover();
  await expect(preview).toBeVisible();
  await firstTopic.click();
  await expect(preview).toHaveCount(0);

  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "选择模型" }).focus();
  await firstTopic.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await expect(firstTopic).toBeFocused();
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "选择模型" }).focus();
  await expect(preview).toHaveCount(0);

  await header.hover({ position: { x: 8, y: 8 } });
  await firstTopic.hover();
  await expect(preview).toBeVisible();
  const addTrigger = page.getByRole("button", { name: "添加文件等内容" });
  await addTrigger.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("menu", { name: "添加与工具" })).toBeVisible();
  await page.keyboard.press("Escape");

  await header.hover({ position: { x: 8, y: 8 } });
  await firstTopic.hover();
  await expect(preview).toBeVisible();
  const modelTrigger = page.getByRole("button", { name: "选择模型" });
  await modelTrigger.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "选择对话模型" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("ThreadHeader 使用 MainWorkspace 坐标且 Sidebar 状态层级互不混淆", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await loadReviewConversation(page);

  const project = page.locator('[data-project-selected="true"]');
  const activeConversation = page.locator('[data-conversation-active="true"]');
  const activeConversationButton = activeConversation.locator(".conversation-tree-chat-label");
  await expect(project).toBeVisible();
  await expect(activeConversation).toBeVisible();
  await expect(activeConversationButton).toHaveAttribute("aria-current", "page");
  expect(await activeConversationButton.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.keyboard.press("Tab");
  expect(await page.locator(":focus").evaluate((element) => element.matches(":focus-visible"))).toBe(true);

  const expanded = await readWorkspaceGeometry(page);
  expect(expanded.header.width).toBeGreaterThan(expanded.main.width - 2);
  expect(expanded.title.x - expanded.main.x).toBeLessThanOrEqual(32);
  expect(expanded.reading.x - expanded.title.x).toBeGreaterThan(100);
  expect(Math.abs((expanded.composer.x + expanded.composer.width / 2) - (expanded.main.x + expanded.main.width / 2))).toBeLessThanOrEqual(6);

  let collapsed: WorkspaceGeometry | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByRole("button", { name: "收起侧边栏" }).click();
    await page.waitForTimeout(220);
    const currentCollapsed = await readWorkspaceGeometry(page);
    collapsed ??= currentCollapsed;
    expect(currentCollapsed.sidebar.width).toBeLessThanOrEqual(1);
    expect(currentCollapsed.boundary.width).toBeLessThanOrEqual(1);
    expect(currentCollapsed.main.x).toBeLessThanOrEqual(2);
    expect(currentCollapsed.main.width).toBeGreaterThanOrEqual(1532);
    expect(currentCollapsed.header.width).toBeGreaterThan(currentCollapsed.main.width - 2);
    expect(currentCollapsed.title.x - currentCollapsed.main.x).toBeLessThanOrEqual(32);
    expect(currentCollapsed.reading.x - currentCollapsed.title.x).toBeGreaterThan(200);
    expect(Math.abs((currentCollapsed.composer.x + currentCollapsed.composer.width / 2) - (currentCollapsed.main.x + currentCollapsed.main.width / 2))).toBeLessThanOrEqual(6);

    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await page.waitForTimeout(220);
    const currentExpanded = await readWorkspaceGeometry(page);
    expect(currentExpanded.sidebar.width).toBeGreaterThan(240);
    expect(currentExpanded.title.x - currentExpanded.main.x).toBeLessThanOrEqual(32);
  }
  expect(collapsed).toBeDefined();
  expect(collapsed!.header.width).toBeGreaterThan(collapsed!.reading.width + 300);

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("桌面运行行与厂商 hover 保持独立级联 surface、原子模型列表且不转移焦点", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "stable-minimax", label: "稳定 MiniMax", provider: "minimax", apiFormat: "anthropic_messages" },
    { id: "stable-deepseek", label: "稳定 DeepSeek", provider: "deepseek", apiFormat: "chat_completions" },
    { id: "stable-google", label: "稳定 Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [
    { id: "stable-chat", title: "模型选择稳定性", connectionId: "stable-minimax", modelId: "MiniMax-M3" },
  ]);
  await page.reload();
  await page.locator('[data-conversation-id="stable-chat"] .conversation-tree-chat-label').click();

  await page.getByRole("button", { name: "选择模型" }).click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  const modelControl = picker.getByRole("button", { name: /^模型 / });
  await modelControl.hover();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");

  const reasoningControl = picker.getByRole("button", { name: /^推理强度 / });
  const speedControl = picker.getByRole("button", { name: /^速度 / });
  const rootSurface = picker.locator('[data-model-picker-surface="root"]');
  const providerSurface = picker.locator('[data-model-picker-surface="provider"]');
  const modelSurface = picker.locator('[data-model-picker-surface="model"]');
  const runtimeSurface = picker.locator('[data-model-picker-surface="runtime"]');
  const controlRows = [modelControl, reasoningControl, speedControl, reasoningControl, modelControl];
  const controlRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  await modelControl.focus();
  for (const [index, row] of controlRows.entries()) {
    await row.hover();
    await expect(picker).toHaveAttribute("data-model-picker-view", index === 0 || index === 4 ? "providers" : index === 2 ? "speed" : "reasoning");
    await expect(modelControl).toBeFocused();
    const rect = await picker.boundingBox();
    if (!rect) throw new Error("模型选择器没有可见边界");
    controlRects.push(rect);
    const rootRect = await rootSurface.boundingBox();
    if (!rootRect) throw new Error("缺少 root surface");
    expect(rootRect.width).toBeGreaterThanOrEqual(260);
    expect(rootRect.width).toBeLessThanOrEqual(300);
    if (index === 0 || index === 4) {
      await expect(providerSurface).toBeVisible();
      await expect(modelSurface).toHaveCount(0);
      await expect(runtimeSurface).toHaveCount(0);
    } else {
      await expect(providerSurface).toHaveCount(0);
      await expect(modelSurface).toHaveCount(0);
      await expect(runtimeSurface).toBeVisible();
    }
  }
  const controlInitial = controlRects[0];
  for (const rect of controlRects.slice(1)) {
    expect(Math.abs(rect.x - controlInitial.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.y - controlInitial.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.width - controlInitial.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.height - controlInitial.height)).toBeLessThanOrEqual(1);
  }

  const providerInitial = await providerSurface.boundingBox();
  expect(providerInitial?.width ?? 0).toBeGreaterThanOrEqual(220);
  expect(providerInitial?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(260);

  await reasoningControl.focus();
  await expect(reasoningControl).toBeFocused();
  await expect(picker).toHaveAttribute("data-model-picker-view", "reasoning");
  await reasoningControl.press("ArrowRight");
  await expect(picker.getByRole("radio", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(reasoningControl).toBeFocused();
  await page.mouse.move(0, 0);
  await modelControl.hover();
  await expect(reasoningControl).toBeFocused();

  const providerRows = [
    { row: picker.getByRole("button", { name: "MiniMax", exact: true }), model: /MiniMax-M3/, absent: /gemini-|deepseek-v/ },
    { row: picker.getByRole("button", { name: "Google Gemini", exact: true }), model: /gemini-3\.5-flash/, absent: /MiniMax-|deepseek-v/ },
    { row: picker.getByRole("button", { name: "DeepSeek", exact: true }), model: /deepseek-v4-flash/, absent: /MiniMax-|gemini-/ },
    { row: picker.getByRole("button", { name: "MiniMax", exact: true }), model: /MiniMax-M3/, absent: /gemini-|deepseek-v/ },
  ];
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const { row, model, absent } of providerRows) {
    await row.hover();
    await expect(row).toHaveAttribute("data-provider-active", "true");
    await expect(providerSurface).toBeVisible();
    await expect(modelSurface).toBeVisible();
    const modelRect = await modelSurface.boundingBox();
    expect(modelRect?.width ?? 0).toBeGreaterThanOrEqual(300);
    expect(modelRect?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(460);
    await expect(picker.getByRole("radio", { name: model }).first()).toBeVisible();
    await expect(picker.getByRole("radio", { name: absent })).toHaveCount(0);
    await expect(reasoningControl).toBeFocused();
    const rect = await picker.boundingBox();
    if (!rect) throw new Error("模型选择器没有可见边界");
    rects.push(rect);
  }
  const initial = rects[0];
  for (const rect of rects.slice(1)) {
    expect(Math.abs(rect.x - initial.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.y - initial.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.width - initial.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rect.height - initial.height)).toBeLessThanOrEqual(1);
  }

  const gemini = providerRows[1].row;
  await gemini.focus();
  await expect(gemini).toBeFocused();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await gemini.press("ArrowRight");
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await expect(picker.getByRole("searchbox", { name: "搜索模型" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(picker.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await expect(picker.getByRole("button", { name: "Google Gemini", exact: true })).toBeFocused();

  await gemini.press("ArrowRight");
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await expect(picker.getByRole("searchbox", { name: "搜索模型" })).toBeFocused();
  await page.keyboard.press("Tab");
  const selectedModel = picker.getByRole("radio").first();
  await selectedModel.locator("xpath=..").click();
  await expect.poll(async () => (await readConversationModelSelection(page, "stable-chat")).modelId).toMatch(/^gemini-/);

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("迟到的旧厂商目录结果不会覆盖当前厂商模型", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  let markGoogleRequested: (() => void) | undefined;
  let releaseGoogle: (() => void) | undefined;
  const googleRequested = new Promise<void>((resolve) => { markGoogleRequested = resolve; });
  const googleRelease = new Promise<void>((resolve) => { releaseGoogle = resolve; });
  await page.route("**/api/ai/models", async (route) => {
    const input = route.request().postDataJSON() as { provider?: string };
    if (input.provider === "google") {
      markGoogleRequested?.();
      await googleRelease;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          complete: true,
          fetchedAt: "2026-08-28T00:00:00.000Z",
          models: [{
            id: "gemini-stale-directory",
            label: "Gemini stale directory",
            purposes: ["text"],
            capabilities: ["text", "streaming"],
            status: "active",
            source: "official_api",
            capabilitySource: "provider",
            supportsStreaming: true,
            supportsStructuredOutput: false,
            updatedAt: "2026-08-28T00:00:00.000Z",
          }],
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], complete: true, fetchedAt: "2026-08-28T00:00:00.000Z" }) });
  });

  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "stale-google", label: "Stale Gemini", provider: "google", apiFormat: "google_generate_content" },
    { id: "stale-deepseek", label: "Current DeepSeek", provider: "deepseek", apiFormat: "chat_completions" },
  ], [
    { id: "stale-chat", title: "异步目录隔离", connectionId: "stale-google", modelId: "gemini-3.5-flash" },
  ]);
  await enableConversationModelDirectoryRequest(page, "stale-google");
  await page.reload();
  await page.locator('[data-conversation-id="stale-chat"] .conversation-tree-chat-label').click();
  await page.getByRole("button", { name: "选择模型" }).click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  await picker.getByRole("button", { name: /^模型 / }).hover();
  await googleRequested;

  const deepSeek = picker.getByRole("button", { name: "DeepSeek", exact: true });
  await deepSeek.hover();
  await expect(deepSeek).toHaveAttribute("data-provider-active", "true");
  await expect(picker.getByRole("radio", { name: /deepseek-v4-flash/ })).toBeVisible();
  await expect(picker.getByRole("radio", { name: /gemini-/ })).toHaveCount(0);

  releaseGoogle?.();
  await page.waitForTimeout(250);
  await expect(deepSeek).toHaveAttribute("data-provider-active", "true");
  await expect(picker.getByRole("radio", { name: /deepseek-v4-flash/ })).toBeVisible();
  await expect(picker.getByRole("radio", { name: /gemini-stale-directory/ })).toHaveCount(0);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
