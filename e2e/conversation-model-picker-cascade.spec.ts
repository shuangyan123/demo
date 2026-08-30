import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

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

function directoryModel(provider: "google" | "deepseek", id: string, label: string): DirectoryModel {
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

async function movePointer(page: Page, from: Locator, to: Locator): Promise<void> {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error("级联指针测试缺少起点或终点边界");
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.move(toBox.x + Math.min(20, toBox.width / 2), toBox.y + toBox.height / 2, { steps: 8 });
}

async function seedModelCache(page: Page, connectionId: string, provider: "google" | "deepseek", models: DirectoryModel[]): Promise<void> {
  await page.evaluate(({ connectionId, provider, models }) => {
    localStorage.setItem(
      `review_provider_models_v4:${connectionId}:${provider}:http://127.0.0.1:9/v1`,
      JSON.stringify({ complete: true, fetchedAt: "2026-08-29T00:00:00.000Z", models }),
    );
  }, { connectionId, provider, models });
}

test("桌面模型级联保持独立几何、长目录仅滚模型层且切换原子", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });

  const geminiModels = [
    directoryModel("google", "gemini-3.5-flash", "Gemini 3.5 Flash"),
    directoryModel("google", "gemini-cascade-long-01", "Deep Research Max Preview (April 2026 extended evaluation build)"),
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

  const picker = await openPicker(page, "cascade-chat");
  const root = picker.locator('[data-model-picker-surface="root"]');
  const provider = picker.locator('[data-model-picker-surface="provider"]');
  const model = picker.locator('[data-model-picker-surface="model"]');
  const runtime = picker.locator('[data-model-picker-surface="runtime"]');
  await expect(root).toBeVisible();
  await expect(provider).toBeVisible();
  await expect(model).toHaveCount(0);

  const rootBefore = await root.boundingBox();
  const providerBefore = await provider.boundingBox();
  expect(rootBefore?.width ?? 0).toBeGreaterThanOrEqual(260);
  expect(rootBefore?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(300);
  expect(providerBefore?.width ?? 0).toBeGreaterThanOrEqual(220);
  expect(providerBefore?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(260);

  const modelControl = picker.getByRole("button", { name: /^模型 / });
  const google = picker.getByRole("button", { name: "Google Gemini", exact: true });
  await movePointer(page, modelControl, google);
  await expect(model).toBeVisible();
  await expect(model.getByRole("radio", { name: /Final Model/ })).toBeVisible();
  const rootWithModel = await root.boundingBox();
  const providerWithModel = await provider.boundingBox();
  const modelWithModel = await model.boundingBox();
  expect(modelWithModel?.width ?? 0).toBeGreaterThanOrEqual(300);
  expect(modelWithModel?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(360);
  expect(Math.abs((rootWithModel?.x ?? 0) - (rootBefore?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((rootWithModel?.y ?? 0) - (rootBefore?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerWithModel?.x ?? 0) - (providerBefore?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerWithModel?.y ?? 0) - (providerBefore?.y ?? 0))).toBeLessThanOrEqual(1);

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
      };
    };
    return { root: read("root"), provider: read("provider"), model: read("model") };
  });
  expect(scrollMetrics.root.scrollHeight).toBe(scrollMetrics.root.clientHeight);
  expect(scrollMetrics.provider.scrollHeight).toBe(scrollMetrics.provider.clientHeight);
  expect(scrollMetrics.model.scrollHeight).toBeGreaterThan(scrollMetrics.model.clientHeight);
  expect(scrollMetrics.model.maxHeight).not.toBe("none");

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

  await model.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(async () => model.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const bottomModel = model.getByRole("radio", { name: /Final Model/ });
  await expect(bottomModel).toBeVisible();
  const bottomBox = await bottomModel.locator("xpath=..").boundingBox();
  const modelBox = await model.boundingBox();
  expect((bottomBox?.y ?? 0) + (bottomBox?.height ?? 0)).toBeLessThanOrEqual((modelBox?.y ?? 0) + (modelBox?.height ?? Number.POSITIVE_INFINITY) + 1);

  const rootBeforeSwitch = await root.boundingBox();
  const providerBeforeSwitch = await provider.boundingBox();
  const deepSeek = picker.getByRole("button", { name: "DeepSeek", exact: true });
  await movePointer(page, google, deepSeek);
  await expect(deepSeek).toHaveAttribute("data-provider-active", "true");
  await expect(model.getByRole("radio", { name: /DeepSeek Cascade One/ })).toBeVisible();
  await expect(model.getByRole("radio", { name: /Gemini Cascade Preview/ })).toHaveCount(0);
  await expect.poll(async () => model.evaluate((element) => element.scrollTop)).toBe(0);
  const rootAfterSwitch = await root.boundingBox();
  const providerAfterSwitch = await provider.boundingBox();
  expect(Math.abs((rootAfterSwitch?.x ?? 0) - (rootBeforeSwitch?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((rootAfterSwitch?.y ?? 0) - (rootBeforeSwitch?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerAfterSwitch?.x ?? 0) - (providerBeforeSwitch?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((providerAfterSwitch?.y ?? 0) - (providerBeforeSwitch?.y ?? 0))).toBeLessThanOrEqual(1);

  await movePointer(page, deepSeek, google);
  await expect(model.getByRole("radio", { name: /Gemini 3\.5 Flash/ })).toBeVisible();
  await expect.poll(async () => model.evaluate((element) => element.scrollTop)).toBe(0);

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
