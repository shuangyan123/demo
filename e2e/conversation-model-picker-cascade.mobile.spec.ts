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

async function seedModelCache(page: Page, connectionId: string, provider: "google" | "deepseek", models: DirectoryModel[]): Promise<void> {
  await page.evaluate(({ connectionId, provider, models }) => {
    localStorage.setItem(
      `review_provider_models_v4:${connectionId}:${provider}:http://127.0.0.1:9/v1`,
      JSON.stringify({ complete: true, fetchedAt: "2026-08-29T00:00:00.000Z", models }),
    );
  }, { connectionId, provider, models });
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

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
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

test("移动端模型菜单保持 step-in、返回和长模型列表滚动", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileModels = [
    directoryModel("google", "gemini-3.5-flash", "Gemini 3.5 Flash"),
    ...Array.from({ length: 31 }, (_, index) => directoryModel("google", `gemini-mobile-cascade-${index + 1}`, `Gemini Mobile Cascade ${index + 1}`)),
  ];
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "mobile-cascade-google", label: "移动级联 Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [
    { id: "mobile-cascade-chat", title: "移动长模型目录", connectionId: "mobile-cascade-google", modelId: "gemini-3.5-flash" },
  ]);
  await seedModelCache(page, "mobile-cascade-google", "google", mobileModels);
  await page.reload();
  await expectRecallMarkInsideHeader(page);
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await drawer.getByRole("button", { name: "移动长模型目录", exact: true }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "选择模型" }).click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  const modelControl = picker.getByRole("button", { name: /^模型 / });
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await modelControl.click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  const provider = picker.locator('[data-model-picker-surface="provider"]');
  const model = picker.locator('[data-model-picker-surface="model"]');
  await expect(provider).toBeVisible();
  await expect(model).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await provider.getByRole("button", { name: "Google Gemini", exact: true }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await expect(model).toBeVisible();
  await expect(model.getByRole("radio", { name: /Gemini Mobile Cascade 31/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-cascade-mobile-model.png"), fullPage: false });
  const stickyHeader = model.locator('[data-model-picker-sticky-header="true"]');
  const results = model.locator('[data-model-picker-results="true"]');
  await expect(stickyHeader).toBeVisible();
  await expect(model.getByRole("searchbox", { name: "搜索模型" })).toBeVisible();
  const modelMetrics = await model.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  const resultMetrics = await results.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }));
  expect(modelMetrics.scrollHeight).toBe(modelMetrics.clientHeight);
  expect(resultMetrics.scrollHeight).toBeGreaterThan(resultMetrics.clientHeight);
  expect(resultMetrics.overflowY).toBe("auto");
  expect(await visibleModelRowCount(results)).toBeLessThanOrEqual(5);
  const stickyBeforeScroll = await stickyHeader.boundingBox();
  const modelBeforeScroll = await model.boundingBox();
  await expectNoDocumentHorizontalOverflow(page);
  await results.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(async () => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const stickyAfterScroll = await stickyHeader.boundingBox();
  const modelAfterScroll = await model.boundingBox();
  expect(Math.abs((stickyAfterScroll?.y ?? 0) - (stickyBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((modelAfterScroll?.y ?? 0) - (modelBeforeScroll?.y ?? 0))).toBeLessThanOrEqual(1);
  await model.getByRole("button", { name: "返回厂商" }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await expect(model).toBeHidden();
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  expectNoRuntimeErrors(runtimeErrors);
});
