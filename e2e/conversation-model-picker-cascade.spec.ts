import { expect, test, type Locator, type Page } from "@playwright/test";
import { readConversationModelSelection, seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

type CascadeProvider = "google" | "deepseek" | "minimax";

type DirectoryModel = {
  id: string;
  label: string;
  purposes: ["text"];
  capabilities: ["text", "streaming"];
  status: "active";
  source: "official_api";
  capabilitySource: "provider";
  supportsStreaming: true;
  supportsStructuredOutput: false;
  generationProtocol?: "google_generate_content";
  updatedAt: string;
};

function directoryModel(provider: CascadeProvider, id: string, label: string): DirectoryModel {
  return {
    id,
    label,
    purposes: ["text"],
    capabilities: ["text", "streaming"],
    status: "active",
    source: "official_api",
    capabilitySource: "provider",
    supportsStreaming: true,
    supportsStructuredOutput: false,
    ...(provider === "google" ? { generationProtocol: "google_generate_content" as const } : {}),
    updatedAt: "2026-08-29T00:00:00.000Z",
  };
}

async function openPicker(page: Page, conversationId: string): Promise<Locator> {
  await page.locator(`[data-conversation-id="${conversationId}"] .conversation-tree-chat-label`).click();
  await page.getByRole("button", { name: "选择模型" }).click();
  return page.getByRole("dialog", { name: "选择对话模型" });
}

async function expectRecallMarkInsideHeader(page: Page): Promise<void> {
  const geometry = await page.locator(".chrome-topbar").evaluate((header) => {
    const safeArea = header.querySelector<HTMLElement>(".chrome-topbar-safe-area");
    const mark = header.querySelector<HTMLImageElement>('img[alt="Recall"]');
    if (!safeArea || !mark) throw new Error("Recall 标记缺少可测量的 header 几何");
    const headerRect = header.getBoundingClientRect();
    const safeAreaRect = safeArea.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    return {
      header: { top: headerRect.top, bottom: headerRect.bottom, left: headerRect.left, right: headerRect.right },
      safeArea: { top: safeAreaRect.top, bottom: safeAreaRect.bottom, left: safeAreaRect.left, right: safeAreaRect.right },
      mark: { top: markRect.top, bottom: markRect.bottom, left: markRect.left, right: markRect.right, width: markRect.width, height: markRect.height },
      headerOverflow: getComputedStyle(header).overflow,
      safeAreaOverflow: getComputedStyle(safeArea).overflow,
    };
  });
  expect(geometry.mark.width).toBe(28);
  expect(geometry.mark.height).toBe(28);
  for (const boundary of [geometry.header, geometry.safeArea]) {
    expect(geometry.mark.top).toBeGreaterThanOrEqual(boundary.top);
    expect(geometry.mark.bottom).toBeLessThanOrEqual(boundary.bottom);
    expect(geometry.mark.left).toBeGreaterThanOrEqual(boundary.left);
    expect(geometry.mark.right).toBeLessThanOrEqual(boundary.right);
  }
}

async function movePointer(page: Page, from: Locator, to: Locator): Promise<void> {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error("级联指针测试缺少起点或终点边界");
  const targetX = toBox.x + Math.min(20, toBox.width / 2);
  const fromY = fromBox.y + fromBox.height / 2;
  const targetY = toBox.y + toBox.height / 2;
  // 先沿父子 surface 的水平通道离开当前层，再在目标 surface 内垂直移动，
  // 避免跨层对角线意外穿过 root 的其它 control row（例如推理强度）触发另一条级联。
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromY);
  await page.mouse.move(targetX, fromY);
  await page.mouse.move(targetX, targetY, { steps: 8 });
}

async function waitForPickerLayerAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLElement>("[data-model-picker-surface]"))
    .flatMap((surface) => surface.getAnimations())
    .every((animation) => animation.playState === "finished"));
  // Chromium 151 can report the animation finished one frame before the composed transform settles.
  await page.waitForTimeout(150);
}

async function seedModelCache(page: Page, connectionId: string, provider: CascadeProvider, models: DirectoryModel[]): Promise<void> {
  await page.evaluate(({ connectionId, provider, models }) => {
    const baseUrl = provider === "minimax" ? "http://127.0.0.1:9/anthropic" : "http://127.0.0.1:9/v1";
    localStorage.setItem(
      `review_provider_models_v4:${connectionId}:${provider}:${baseUrl}`,
      JSON.stringify({ complete: true, fetchedAt: "2026-08-29T00:00:00.000Z", models }),
    );
  }, { connectionId, provider, models });
}

async function providerLabels(picker: Locator): Promise<string[]> {
  return picker.locator('[data-model-picker-surface="provider"] [data-picker-focus-key^="provider:"]').evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
}

async function providerOrder(picker: Locator): Promise<string[]> {
  return picker.locator('[data-model-picker-surface="provider"] [data-picker-focus-key^="provider:"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-picker-focus-key") ?? ""));
}

async function visibleModelRowCount(results: Locator): Promise<number> {
  return results.evaluate((element) => {
    const resultsRect = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll<HTMLElement>("[data-model-picker-row]"))
      .filter((row) => {
        const rowRect = row.getBoundingClientRect();
        return rowRect.top >= resultsRect.top - 1 && rowRect.bottom <= resultsRect.bottom + 1;
      })
      .length;
  });
}

async function assertPinnedModelSearch({
  page,
  picker,
  model,
  providerRow,
  providerOrderSnapshot,
  query,
  expectedModel,
  fullCount,
}: {
  page: Page;
  picker: Locator;
  model: Locator;
  providerRow: Locator;
  providerOrderSnapshot: string[];
  query: string;
  expectedModel: string | RegExp;
  fullCount: number;
}): Promise<void> {
  const search = model.getByRole("searchbox", { name: "搜索模型" });
  await movePointer(page, providerRow, search);
  await search.click();
  await expect(search).toBeFocused();
  await expect(model).toBeVisible();
  // Keep focus in the search field while the pointer leaves the whole cascade.
  await page.mouse.move(100, 100);
  await page.waitForTimeout(300);
  await search.pressSequentially(query.slice(0, 1));
  await expect(model).toBeVisible();
  await expect(search).toBeFocused();
  await expect(providerRow).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
  if (query.length > 1) await search.pressSequentially(query.slice(1));
  await expect(model.getByRole("radio", { name: expectedModel }).first()).toBeVisible();
  await expect(model).toBeVisible();
  await expect(search).toBeFocused();
  await expect(providerRow).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
  await search.fill("");
  await expect(model.getByRole("radio")).toHaveCount(fullCount);
  await expect(model).toBeVisible();
  await expect(search).toBeFocused();
  await expect(providerRow).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
}

test("桌面模型级联保持独立几何、长目录仅滚模型层且切换原子", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });

  const geminiModels = [
    directoryModel("google", "gemini-3.5-flash", "Gemini 3.5 Flash"),
    directoryModel("google", "gemini-cascade-long-01", "Deep Research Max Preview (April 2026 extended evaluation build with an intentionally long canonical display label for overflow QA)"),
    ...Array.from({ length: 39 }, (_, index) => directoryModel("google", `gemini-cascade-${String(index + 2).padStart(2, "0")}`, `Gemini Cascade Preview ${index + 2}`)),
    directoryModel("google", "gemini-cascade-last", "Gemini 2.5 Computer Use Preview — Long Context — Final Model"),
  ];
  const deepSeekModels = [
    directoryModel("deepseek", "deepseek-cascade-1", "DeepSeek Cascade One"),
    directoryModel("deepseek", "deepseek-cascade-2", "DeepSeek Cascade Two"),
  ];

  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "cascade-google", label: "级联 Gemini", provider: "google", apiFormat: "google_generate_content" },
    { id: "cascade-deepseek", label: "级联 DeepSeek", provider: "deepseek", apiFormat: "chat_completions" },
  ], [
    { id: "cascade-chat", title: "级联长模型目录", connectionId: "cascade-google", modelId: "gemini-3.5-flash" },
  ]);
  await seedModelCache(page, "cascade-google", "google", geminiModels);
  await seedModelCache(page, "cascade-deepseek", "deepseek", deepSeekModels);
  await page.reload();

  await expectRecallMarkInsideHeader(page);
  const picker = await openPicker(page, "cascade-chat");
  const root = picker.locator('[data-model-picker-surface="root"]');
  const provider = picker.locator('[data-model-picker-surface="provider"]');
  const model = picker.locator('[data-model-picker-surface="model"]');
  const runtime = picker.locator('[data-model-picker-surface="runtime"]');
  await expect(root).toBeVisible();
  await expect(provider).toHaveCount(0);
  await expect(model).toHaveCount(0);
  const modelControl = picker.getByRole("button", { name: /^模型 / });
  await modelControl.hover();
  await expect(provider).toBeVisible();
  await waitForPickerLayerAnimations(page);
  const sessionProviderOrder = await providerOrder(picker);

  const rootBefore = await root.boundingBox();
  const providerBefore = await provider.boundingBox();
  expect(rootBefore?.width ?? 0).toBeGreaterThanOrEqual(260);
  expect(rootBefore?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(300);
  expect(providerBefore?.width ?? 0).toBeGreaterThanOrEqual(220);
  expect(providerBefore?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(260);

  const google = picker.getByRole("button", { name: "Google Gemini", exact: true });
  await movePointer(page, modelControl, google);
  await expect(model).toBeVisible();
  await expect(model.getByRole("radio", { name: /Final Model/ })).toBeVisible();
  expect(await providerOrder(picker)).toEqual(sessionProviderOrder);
  await waitForPickerLayerAnimations(page);
  const rootWithModel = await root.boundingBox();
  const providerWithModel = await provider.boundingBox();
  const modelWithModel = await model.boundingBox();
  expect(modelWithModel?.width ?? 0).toBeGreaterThanOrEqual(420);
  expect(modelWithModel?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(460);
  expect(Math.abs((rootWithModel?.x ?? 0) - (rootBefore?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((rootWithModel?.y ?? 0) - (rootBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerWithModel?.x ?? 0) - (providerBefore?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerWithModel?.y ?? 0) - (providerBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  const longModelHeight = modelWithModel?.height ?? 0;
  const surfacePresentation = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-model-picker-surface]')].map((surface) => {
    const style = getComputedStyle(surface);
    return { surface: surface.dataset.modelPickerSurface, background: style.backgroundColor, opacity: style.opacity, transform: style.transform };
  }));
  expect(surfacePresentation).toEqual(expect.arrayContaining([
    expect.objectContaining({ surface: "root", opacity: "1", transform: "none" }),
    expect.objectContaining({ surface: "provider", opacity: "1", transform: "none" }),
    expect.objectContaining({ surface: "model", opacity: "1", transform: "none" }),
  ]));
  for (const surface of surfacePresentation) expect(surface.background).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-desktop-model.png"), fullPage: false });

  const scrollMetrics = await page.evaluate(() => {
    const read = (surface: string) => {
      const element = document.querySelector<HTMLElement>(`[data-model-picker-surface="${surface}"]`);
      if (!element) throw new Error(`缺少 ${surface} surface`);
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
      };
    };
    const results = document.querySelector<HTMLElement>('[data-model-picker-results="true"]');
    if (!results) throw new Error("缺少模型结果滚动层");
    const resultsStyle = getComputedStyle(results);
    return {
      root: read("root"),
      provider: read("provider"),
      model: read("model"),
      results: {
        clientHeight: results.clientHeight,
        scrollHeight: results.scrollHeight,
        scrollTop: results.scrollTop,
        maxHeight: resultsStyle.maxHeight,
        overflowY: resultsStyle.overflowY,
      },
    };
  });
  expect(scrollMetrics.root.scrollHeight).toBe(scrollMetrics.root.clientHeight);
  expect(scrollMetrics.provider.scrollHeight).toBe(scrollMetrics.provider.clientHeight);
  expect(scrollMetrics.model.scrollTop).toBe(0);
  expect(scrollMetrics.model.overflowY).toBe("hidden");
  expect(scrollMetrics.model.maxHeight).not.toBe("none");
  expect(scrollMetrics.results.scrollHeight).toBeGreaterThan(scrollMetrics.results.clientHeight);
  expect(scrollMetrics.results.maxHeight).not.toBe("none");
  expect(scrollMetrics.results.overflowY).toBe("auto");
  const results = model.locator('[data-model-picker-results="true"]');
  expect(await visibleModelRowCount(results)).toBeLessThanOrEqual(5);

  const modelPanelHeader = model.locator('[data-model-picker-sticky-header="true"]');
  const modelPanelHeaderBeforeScroll = await modelPanelHeader.boundingBox();
  const modelSurfaceBeforeScroll = await model.boundingBox();
  await expect(model.getByRole("searchbox", { name: "搜索模型" })).toBeVisible();

  const longModel = model.getByRole("radio", { name: /Deep Research Max Preview/ });
  const longModelMetrics = await longModel.locator("xpath=..").evaluate((label) => {
    const name = label.querySelector("strong");
    if (!name) throw new Error("长模型行缺少名称节点");
    return {
      textOverflow: name.scrollWidth > name.clientWidth + 1,
      grid: getComputedStyle(label.querySelector(".radioRow") ?? label).gridTemplateColumns,
    };
  });
  expect(longModelMetrics.textOverflow).toBe(true);
  await longModel.focus();
  await page.waitForTimeout(500);
  await expect(page.locator('body > [role="tooltip"]')).toContainText("完整模型名称：Deep Research Max Preview");

  await results.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(async () => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const bottomModel = model.getByRole("radio", { name: /Final Model/ });
  await expect(bottomModel).toBeVisible();
  const bottomBox = await bottomModel.locator("xpath=..").boundingBox();
  const resultsBox = await results.boundingBox();
  const modelPanelHeaderAfterScroll = await modelPanelHeader.boundingBox();
  const modelSurfaceAfterScroll = await model.boundingBox();
  expect((bottomBox?.y ?? 0) + (bottomBox?.height ?? 0)).toBeLessThanOrEqual((resultsBox?.y ?? 0) + (resultsBox?.height ?? Number.POSITIVE_INFINITY) + 1);
  expect(Math.abs((modelPanelHeaderAfterScroll?.y ?? 0) - (modelPanelHeaderBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((modelSurfaceAfterScroll?.x ?? 0) - (modelSurfaceBeforeScroll?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((modelSurfaceAfterScroll?.y ?? 0) - (modelSurfaceBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);

  const rootBeforeSwitch = await root.boundingBox();
  const providerBeforeSwitch = await provider.boundingBox();
  const deepSeek = picker.getByRole("button", { name: "DeepSeek", exact: true });
  await movePointer(page, google, deepSeek);
  await expect(deepSeek).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(sessionProviderOrder);
  await expect(model.getByRole("radio", { name: /DeepSeek Cascade One/ })).toBeVisible();
  await expect(model.getByRole("radio", { name: /Gemini Cascade Preview/ })).toHaveCount(0);
  const shortModelMetrics = await model.evaluate((element) => {
    const results = element.querySelector<HTMLElement>('[data-model-picker-results="true"]');
    if (!results) throw new Error("缺少短目录结果层");
    return {
      height: element.getBoundingClientRect().height,
      resultsHeight: results.getBoundingClientRect().height,
      resultsClientHeight: results.clientHeight,
      resultsScrollHeight: results.scrollHeight,
    };
  });
  expect(shortModelMetrics.height).toBeLessThan(longModelHeight);
  expect(shortModelMetrics.resultsScrollHeight).toBe(shortModelMetrics.resultsClientHeight);
  expect(shortModelMetrics.resultsHeight).toBeGreaterThan(0);
  expect(await visibleModelRowCount(results)).toBeLessThanOrEqual(5);
  const shortModelBox = await model.boundingBox();
  expect(Math.abs((shortModelBox?.y ?? 0) - (modelSurfaceBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  await expect.poll(async () => model.evaluate((element) => element.scrollTop)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-deepseek-short.png"), fullPage: false });
  const rootAfterSwitch = await root.boundingBox();
  const providerAfterSwitch = await provider.boundingBox();
  expect(Math.abs((rootAfterSwitch?.x ?? 0) - (rootBeforeSwitch?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((rootAfterSwitch?.y ?? 0) - (rootBeforeSwitch?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerAfterSwitch?.x ?? 0) - (providerBeforeSwitch?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerAfterSwitch?.y ?? 0) - (providerBeforeSwitch?.y ?? 0))).toBeLessThanOrEqual(1);

  await movePointer(page, deepSeek, google);
  await expect(model.getByRole("radio", { name: /Gemini 3\.5 Flash/ })).toBeVisible();
  expect(await providerOrder(picker)).toEqual(sessionProviderOrder);
  await expect.poll(async () => model.locator('[data-model-picker-results="true"]').evaluate((element) => element.scrollTop)).toBe(0);

  await modelControl.hover();
  await expect(runtime).toHaveCount(0);
  await picker.getByRole("button", { name: /^推理强度 / }).hover();
  await expect(provider).toHaveCount(0);
  await expect(model).toHaveCount(0);
  await expect(runtime).toBeVisible();
  await modelControl.hover();
  await expect(provider).toBeVisible();
  await expect(runtime).toHaveCount(0);

  await expectNoFrameworkOverlay(page);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-desktop.png"), fullPage: false });
  expectNoRuntimeErrors(runtimeErrors);
});

test("provider 到 concrete model 的提交先关闭级联，再应用 selected-first 顺序", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "stability-google", label: "稳定 Gemini", provider: "google", apiFormat: "google_generate_content" },
    { id: "stability-deepseek", label: "稳定 DeepSeek", provider: "deepseek", apiFormat: "chat_completions" },
    { id: "stability-minimax", label: "稳定 MiniMax", provider: "minimax", apiFormat: "anthropic_messages" },
  ], [
    { id: "stability-chat", title: "级联选择稳定性", connectionId: "stability-google", modelId: "gemini-3.5-flash" },
  ]);
  await seedModelCache(page, "stability-google", "google", [directoryModel("google", "gemini-3.5-flash", "Gemini 3.5 Flash")]);
  await seedModelCache(page, "stability-deepseek", "deepseek", [directoryModel("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash")]);
  await seedModelCache(page, "stability-minimax", "minimax", [
    directoryModel("minimax", "MiniMax-M3", "MiniMax-M3"),
    ...Array.from({ length: 5 }, (_, index) => directoryModel("minimax", `minimax-medium-${index + 1}`, `MiniMax Medium ${index + 1}`)),
  ]);
  await page.reload();
  await expectRecallMarkInsideHeader(page);

  let picker = await openPicker(page, "stability-chat");
  const root = picker.locator('[data-model-picker-surface="root"]');
  const provider = picker.locator('[data-model-picker-surface="provider"]');
  const model = picker.locator('[data-model-picker-surface="model"]');
  const modelControl = picker.getByRole("button", { name: /^模型 / });
  await modelControl.hover();
  await expect(provider).toBeVisible();
  await waitForPickerLayerAnimations(page);
  const initialOrder = await providerLabels(picker);
  expect(initialOrder).toEqual(["Google Gemini", "DeepSeek", "MiniMax"]);
  const initialDomOrder = await providerOrder(picker);
  const rootBefore = await root.boundingBox();
  const providerBefore = await provider.boundingBox();

  const minimax = provider.getByRole("button", { name: "MiniMax", exact: true });
  await movePointer(page, modelControl, minimax);
  await expect(minimax).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(initialDomOrder);
  const minimaxModel = model.getByRole("radio", { name: "MiniMax-M3", exact: true });
  await expect(minimaxModel).toBeVisible();
  expect(await model.getByRole("radio").count()).toBeGreaterThanOrEqual(6);
  await expect(model.getByRole("radio", { name: "MiniMax Medium 5", exact: true })).toBeVisible();
  expect(await providerOrder(picker)).toEqual(initialDomOrder);
  const minimaxBox = await model.boundingBox();
  const minimaxMetrics = await model.evaluate((element) => {
    const results = element.querySelector<HTMLElement>('[data-model-picker-results="true"]');
    if (!results) throw new Error("缺少 MiniMax 结果层");
    return {
      height: element.getBoundingClientRect().height,
      resultsClientHeight: results.clientHeight,
      resultsScrollHeight: results.scrollHeight,
    };
  });
  expect(minimaxBox?.width ?? 0).toBeGreaterThanOrEqual(420);
  expect(minimaxBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(460);
  expect(minimaxMetrics.height).toBeLessThan(480);
  expect(minimaxMetrics.resultsScrollHeight).toBeGreaterThan(minimaxMetrics.resultsClientHeight);
  const minimaxProviderBox = await minimax.boundingBox();
  expect(minimaxBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((minimaxProviderBox?.y ?? 0) + (minimaxProviderBox?.height ?? 0) + 1);
  expect((minimaxBox?.y ?? 0) + (minimaxBox?.height ?? 0)).toBeGreaterThanOrEqual((minimaxProviderBox?.y ?? Number.POSITIVE_INFINITY) - 1);
  expect(await visibleModelRowCount(model.locator('[data-model-picker-results="true"]'))).toBeLessThanOrEqual(5);
  await waitForPickerLayerAnimations(page);
  const rootWithModel = await root.boundingBox();
  const providerWithModel = await provider.boundingBox();
  expect(Math.abs((rootWithModel?.x ?? 0) - (rootBefore?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((rootWithModel?.y ?? 0) - (rootBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerWithModel?.x ?? 0) - (providerBefore?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerWithModel?.y ?? 0) - (providerBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-stability-1280-model.png"), fullPage: false });
  await movePointer(page, minimax, minimaxModel.locator("xpath=.."));
  await minimaxModel.locator("xpath=..").click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toBeFocused();
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("MiniMax-M3");
  await expect.poll(async () => (await readConversationModelSelection(page, "stability-chat")).modelId).toBe("MiniMax-M3");
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-stability-1280-selected.png"), fullPage: false });

  picker = await openPicker(page, "stability-chat");
  const reopenedProvider = picker.locator('[data-model-picker-surface="provider"]');
  const reopenedModel = picker.locator('[data-model-picker-surface="model"]');
  const reopenedModelControl = picker.getByRole("button", { name: /^模型 / });
  await expect(reopenedProvider).toHaveCount(0);
  await reopenedModelControl.hover();
  await expect(reopenedProvider).toBeVisible();
  expect(await providerLabels(picker)).toEqual(["MiniMax", "DeepSeek", "Google Gemini"]);
  const reopenedDomOrder = await providerOrder(picker);
  const deepSeek = reopenedProvider.getByRole("button", { name: "DeepSeek", exact: true });
  await movePointer(page, reopenedModelControl, deepSeek);
  expect(await providerOrder(picker)).toEqual(reopenedDomOrder);
  const deepSeekModel = reopenedModel.getByRole("radio", { name: "DeepSeek V4 Flash", exact: true });
  await expect(deepSeekModel).toBeVisible();
  await deepSeekModel.locator("xpath=..").click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("deepseek-v4-flash");
  await expect.poll(async () => (await readConversationModelSelection(page, "stability-chat")).modelId).toBe("deepseek-v4-flash");

  picker = await openPicker(page, "stability-chat");
  const rapidProvider = picker.locator('[data-model-picker-surface="provider"]');
  const rapidModel = picker.locator('[data-model-picker-surface="model"]');
  const rapidModelControl = picker.getByRole("button", { name: /^模型 / });
  await expect(rapidProvider).toHaveCount(0);
  await rapidModelControl.hover();
  await expect(rapidProvider).toBeVisible();
  const rapidInitialOrder = await providerOrder(picker);
  let previousProvider = rapidModelControl;
  for (const providerName of ["MiniMax", "DeepSeek", "Google Gemini", "MiniMax"]) {
    const nextProvider = rapidProvider.getByRole("button", { name: providerName, exact: true });
    await movePointer(page, previousProvider, nextProvider);
    await expect(nextProvider).toHaveAttribute("data-provider-active", "true");
    await expect(rapidModel).toBeVisible();
    expect(await providerOrder(picker)).toEqual(rapidInitialOrder);
    previousProvider = nextProvider;
  }
  expect(await providerOrder(picker)).toEqual(rapidInitialOrder);
  const rapidMiniMax = rapidProvider.getByRole("button", { name: "MiniMax", exact: true });
  await rapidMiniMax.focus();
  await page.keyboard.press("ArrowUp");
  await expect(rapidProvider.getByRole("button", { name: "Google Gemini", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rapidMiniMax).toBeFocused();
  expect(await providerOrder(picker)).toEqual(rapidInitialOrder);
  await rapidMiniMax.click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await rapidModel.getByRole("button", { name: "返回厂商" }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  expect(await providerOrder(picker)).toEqual(rapidInitialOrder);
  await movePointer(page, rapidModelControl, rapidMiniMax);
  const rapidModelOption = rapidModel.getByRole("radio", { name: "MiniMax-M3", exact: true });
  await expect(rapidModelOption).toBeVisible();
  await movePointer(page, previousProvider, rapidModelOption.locator("xpath=.."));
  await rapidModelOption.locator("xpath=..").click();
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await readConversationModelSelection(page, "stability-chat")).modelId).toBe("MiniMax-M3");

  picker = await openPicker(page, "stability-chat");
  const escapeProvider = picker.locator('[data-model-picker-surface="provider"]');
  const escapeModel = picker.locator('[data-model-picker-surface="model"]');
  const escapeControl = picker.getByRole("button", { name: /^模型 / });
  const escapeDeepSeek = escapeProvider.getByRole("button", { name: "DeepSeek", exact: true });
  await escapeControl.hover();
  await expect(escapeProvider).toBeVisible();
  await movePointer(page, escapeControl, escapeDeepSeek);
  await expect(escapeModel.getByRole("radio", { name: "DeepSeek V4 Flash", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await expect(escapeModel).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  expect(await page.locator('[data-model-picker-surface]').count()).toBe(0);

  picker = await openPicker(page, "stability-chat");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toBeFocused();

  picker = await openPicker(page, "stability-chat");
  const outsideProvider = picker.locator('[data-model-picker-surface="provider"]');
  const outsideModel = picker.locator('[data-model-picker-surface="model"]');
  const outsideControl = picker.getByRole("button", { name: /^模型 / });
  const outsideGoogle = outsideProvider.getByRole("button", { name: "Google Gemini", exact: true });
  await outsideControl.hover();
  await expect(outsideProvider).toBeVisible();
  await movePointer(page, outsideControl, outsideGoogle);
  const outsideGoogleModel = outsideModel.getByRole("radio", { name: "Gemini 3.5 Flash", exact: true });
  await expect(outsideGoogleModel).toBeVisible();
  await movePointer(page, outsideGoogle, outsideGoogleModel.locator("xpath=.."));
  await outsideGoogleModel.locator("xpath=..").click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "选择模型" })).toContainText("gemini-3.5-flash");
  await expect.poll(async () => (await readConversationModelSelection(page, "stability-chat")).modelId).toBe("gemini-3.5-flash");

  picker = await openPicker(page, "stability-chat");
  const outsideCloseProvider = picker.locator('[data-model-picker-surface="provider"]');
  const outsideCloseModel = picker.locator('[data-model-picker-surface="model"]');
  const outsideCloseControl = picker.getByRole("button", { name: /^模型 / });
  const outsideCloseDeepSeek = outsideCloseProvider.getByRole("button", { name: "DeepSeek", exact: true });
  await outsideCloseControl.hover();
  await expect(outsideCloseProvider).toBeVisible();
  await movePointer(page, outsideCloseControl, outsideCloseDeepSeek);
  await expect(outsideCloseModel.getByRole("radio", { name: "DeepSeek V4 Flash", exact: true })).toBeVisible();
  await page.mouse.click(1000, 120);
  await expect(picker).toBeHidden();

  await expectRecallMarkInsideHeader(page);
  await expectNoFrameworkOverlay(page);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-stability-1280.png"), fullPage: false });
  expectNoRuntimeErrors(runtimeErrors);
});

test("模型搜索只过滤当前厂商，结果层键盘导航和提交保持稳定", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  const searchModels = [
    directoryModel("google", "gemini-3.5-flash", "Gemini 3.5 Flash"),
    directoryModel("google", "google-highspeed-alpha", "Highspeed Preview Alpha"),
    directoryModel("google", "google-highspeed-beta", "Highspeed Preview Beta"),
    ...Array.from({ length: 37 }, (_, index) => directoryModel("google", `google-highspeed-${String(index + 1).padStart(2, "0")}`, `Highspeed Preview ${index + 1}`)),
    directoryModel("google", "google-canonical-needle", "Visible Alias"),
  ];
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "search-google", label: "搜索 Gemini", provider: "google", apiFormat: "google_generate_content" },
    { id: "search-deepseek", label: "搜索 DeepSeek", provider: "deepseek", apiFormat: "chat_completions" },
  ], [
    { id: "search-chat", title: "模型搜索验收", connectionId: "search-google", modelId: "gemini-3.5-flash" },
  ]);
  await seedModelCache(page, "search-google", "google", searchModels);
  await seedModelCache(page, "search-deepseek", "deepseek", [directoryModel("deepseek", "deepseek-search-fallback", "DeepSeek Search Fallback")]);
  await page.reload();
  await expectRecallMarkInsideHeader(page);

  let picker = await openPicker(page, "search-chat");
  const root = picker.locator('[data-model-picker-surface="root"]');
  const provider = picker.locator('[data-model-picker-surface="provider"]');
  const modelControl = picker.getByRole("button", { name: /^模型 / });
  await modelControl.hover();
  const google = provider.getByRole("button", { name: "Google Gemini", exact: true });
  await google.click();
  let model = picker.locator('[data-model-picker-surface="model"]');
  await expect(model).toBeVisible();
  const results = model.locator('[data-model-picker-results="true"]');
  const stickyHeader = model.locator('[data-model-picker-sticky-header="true"]');
  const searchInput = model.getByRole("searchbox", { name: "搜索模型" });
  await searchInput.focus();
  await expect(searchInput).toBeFocused();
  const initialOrder = await providerOrder(picker);
  const rootBeforeSearch = await root.boundingBox();
  const providerBeforeSearch = await provider.boundingBox();
  const modelBeforeSearch = await model.boundingBox();
  expect(modelBeforeSearch?.width ?? 0).toBeGreaterThanOrEqual(420);
  expect(modelBeforeSearch?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(460);
  const initialResultCount = await model.getByRole("radio").count();
  expect(initialResultCount).toBeGreaterThanOrEqual(searchModels.length);

  await searchInput.fill("  hIgHsPeEd  ");
  const multiMatches = model.getByRole("radio");
  await expect(multiMatches).toHaveCount(39);
  expect(await multiMatches.evaluateAll((items) => items.map((item) => item.getAttribute("data-model-id")))).toEqual(searchModels.slice(1, 40).map((item) => item.id));
  expect(await providerOrder(picker)).toEqual(initialOrder);
  for (const [actual, expected] of [[root, rootBeforeSearch], [provider, providerBeforeSearch], [model, modelBeforeSearch]] as const) {
    const box = await actual.boundingBox();
    expect(Math.abs((box?.x ?? 0) - (expected?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((box?.y ?? 0) - (expected?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((box?.width ?? 0) - (expected?.width ?? 0))).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-search-multiple.png"), fullPage: false });

  await searchInput.fill(" canonical-NEEDLE ");
  await expect(model.getByRole("radio")).toHaveCount(1);
  await expect(model.getByRole("radio", { name: "Visible Alias", exact: true })).toBeVisible();
  await expect(stickyHeader).toBeVisible();
  const oneMatchBox = await model.boundingBox();
  expect(Math.abs((oneMatchBox?.x ?? 0) - (modelBeforeSearch?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((oneMatchBox?.y ?? 0) - (modelBeforeSearch?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(oneMatchBox?.height ?? 0).toBeLessThan(modelBeforeSearch?.height ?? Number.POSITIVE_INFINITY);
  expect(await results.evaluate((element) => element.scrollHeight)).toBe(await results.evaluate((element) => element.clientHeight));
  expect(await providerOrder(picker)).toEqual(initialOrder);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-search-one.png"), fullPage: false });

  await searchInput.fill("not-a-real-model");
  await expect(model.getByRole("status")).toHaveText("未找到匹配模型");
  await expect(model.getByRole("radio")).toHaveCount(0);
  const noMatchBox = await model.boundingBox();
  expect(Math.abs((noMatchBox?.x ?? 0) - (modelBeforeSearch?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((noMatchBox?.y ?? 0) - (modelBeforeSearch?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((noMatchBox?.width ?? 0) - (modelBeforeSearch?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(noMatchBox?.height ?? 0).toBeLessThan(modelBeforeSearch?.height ?? Number.POSITIVE_INFINITY);
  expect(await results.evaluate((element) => element.scrollHeight)).toBe(await results.evaluate((element) => element.clientHeight));
  expect(await providerOrder(picker)).toEqual(initialOrder);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-search-none.png"), fullPage: false });

  await searchInput.fill("");
  await expect(model.getByRole("radio")).toHaveCount(initialResultCount);
  await expect(model.getByRole("radio", { name: "Gemini 3.5 Flash", exact: true })).toBeVisible();
  expect(await providerOrder(picker)).toEqual(initialOrder);

  await searchInput.fill("highspeed");
  const filtered = model.getByRole("radio");
  await expect(filtered).toHaveCount(39);
  await results.evaluate((element) => { element.scrollTop = 0; });
  await filtered.first().focus();
  await filtered.first().press("ArrowDown");
  await expect(filtered.nth(1)).toBeFocused();
  await filtered.nth(1).press("ArrowUp");
  await expect(filtered.first()).toBeFocused();
  for (let index = 0; index < 30; index += 1) await page.keyboard.press("ArrowDown");
  await expect.poll(async () => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const focusedFilteredId = await page.evaluate(() => document.activeElement?.getAttribute("data-model-id"));
  expect(focusedFilteredId).toBeTruthy();
  expect(await providerOrder(picker)).toEqual(initialOrder);

  await searchInput.press("Escape");
  await expect(searchInput).toHaveValue("");
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await searchInput.press("Escape");
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await expect(model).toHaveCount(0);
  expect(await providerOrder(picker)).toEqual(initialOrder);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();

  picker = await openPicker(page, "search-chat");
  const reopenedProvider = picker.locator('[data-model-picker-surface="provider"]');
  const reopenedControl = picker.getByRole("button", { name: /^模型 / });
  await reopenedControl.hover();
  await reopenedProvider.getByRole("button", { name: "Google Gemini", exact: true }).click();
  model = picker.locator('[data-model-picker-surface="model"]');
  const reopenedSearch = model.getByRole("searchbox", { name: "搜索模型" });
  await reopenedSearch.fill("canonical-needle");
  const enterTarget = model.getByRole("radio", { name: "Visible Alias", exact: true });
  await enterTarget.focus();
  await enterTarget.press("Enter");
  await expect(picker).toBeHidden();
  await expect(page.locator('[data-model-picker-surface]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "选择模型" })).toBeFocused();
  await expect.poll(async () => (await readConversationModelSelection(page, "search-chat")).modelId).toBe("google-canonical-needle");
  await expectNoFrameworkOverlay(page);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-search-committed.png"), fullPage: false });
  expectNoRuntimeErrors(runtimeErrors);
});

test("模型搜索焦点拥有级联生命周期并保持真实过滤结果", async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const geminiModels = [
    directoryModel("google", "gemini-3.5-flash", "Gemini 3.5 Flash"),
    ...Array.from({ length: 7 }, (_, index) => directoryModel("google", `gemini-search-long-${index + 1}`, `Gemini Search Long ${index + 1}`)),
  ];
  const deepSeekModels = [
    directoryModel("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash"),
    directoryModel("deepseek", "deepseek-search-brief", "DeepSeek Search Brief"),
  ];
  const miniMaxModels = [
    directoryModel("minimax", "MiniMax-M3", "MiniMax-M3"),
    directoryModel("minimax", "MiniMax-M2.7", "MiniMax-M2.7"),
    ...Array.from({ length: 4 }, (_, index) => directoryModel("minimax", `minimax-search-${index + 1}`, `MiniMax Search ${index + 1}`)),
  ];

  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "focus-google", label: "焦点 Gemini", provider: "google", apiFormat: "google_generate_content" },
    { id: "focus-deepseek", label: "焦点 DeepSeek", provider: "deepseek", apiFormat: "chat_completions" },
    { id: "focus-minimax", label: "焦点 MiniMax", provider: "minimax", apiFormat: "anthropic_messages" },
  ], [
    { id: "focus-chat", title: "模型搜索焦点生命周期", connectionId: "focus-google", modelId: "gemini-3.5-flash" },
  ]);
  await seedModelCache(page, "focus-google", "google", geminiModels);
  await seedModelCache(page, "focus-deepseek", "deepseek", deepSeekModels);
  await seedModelCache(page, "focus-minimax", "minimax", miniMaxModels);
  await page.reload();

  const picker = await openPicker(page, "focus-chat");
  const provider = picker.locator('[data-model-picker-surface="provider"]');
  const model = picker.locator('[data-model-picker-surface="model"]');
  const modelControl = picker.getByRole("button", { name: /^模型 / });
  await modelControl.hover();
  await expect(provider).toBeVisible();
  const providerOrderSnapshot = await providerOrder(picker);
  const previewProvider = async (name: string): Promise<Locator> => {
    await modelControl.hover();
    await expect(provider).toBeVisible();
    const row = provider.getByRole("button", { name, exact: true });
    await movePointer(page, modelControl, row);
    await expect(row).toHaveAttribute("data-provider-active", "true");
    await expect(model).toBeVisible();
    const modelBox = await model.boundingBox();
    const providerBox = await row.boundingBox();
    expect(modelBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan((providerBox?.y ?? 0) + (providerBox?.height ?? 0));
    expect((modelBox?.y ?? 0) + (modelBox?.height ?? 0)).toBeGreaterThan(providerBox?.y ?? Number.POSITIVE_INFINITY);
    expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
    return row;
  };

  const miniMax = await previewProvider("MiniMax");
  const miniMaxFullCount = await model.getByRole("radio").count();
  expect(miniMaxFullCount).toBeGreaterThan(5);
  await assertPinnedModelSearch({
    page,
    picker,
    model,
    providerRow: miniMax,
    providerOrderSnapshot,
    query: "M3",
    expectedModel: "MiniMax-M3",
    fullCount: miniMaxFullCount,
  });

  const deepSeek = await previewProvider("DeepSeek");
  const deepSeekFullCount = await model.getByRole("radio").count();
  expect(deepSeekFullCount).toBeLessThanOrEqual(5);
  await assertPinnedModelSearch({
    page,
    picker,
    model,
    providerRow: deepSeek,
    providerOrderSnapshot,
    query: "flash",
    expectedModel: "DeepSeek V4 Flash",
    fullCount: deepSeekFullCount,
  });

  const google = await previewProvider("Google Gemini");
  const geminiFullCount = await model.getByRole("radio").count();
  expect(geminiFullCount).toBeGreaterThan(5);
  await assertPinnedModelSearch({
    page,
    picker,
    model,
    providerRow: google,
    providerOrderSnapshot,
    query: "long-3",
    expectedModel: "Gemini Search Long 3",
    fullCount: geminiFullCount,
  });

  const results = model.locator('[data-model-picker-results="true"]');
  await results.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(async () => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(model).toBeVisible();
  await expect(google).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);

  const search = model.getByRole("searchbox", { name: "搜索模型" });
  await search.click();
  await search.fill("not-a-real-model");
  await expect(model).toBeVisible();
  await expect(model.getByRole("status")).toHaveText("未找到匹配模型");
  await expect(google).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(model).toBeVisible();
  await expect(google).toHaveAttribute("data-provider-active", "true");
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
  await search.press("Escape");
  await expect(model).toHaveCount(0);
  await expect(provider).toBeVisible();
  expect(await providerOrder(picker)).toEqual(providerOrderSnapshot);
  expectNoRuntimeErrors(runtimeErrors);
});
