import { expect, test, type Locator, type Page } from "@playwright/test";
import path from "node:path";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

async function ensureOpen(summary: Locator) {
  if (!await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await summary.click();
}

async function openLearningInsights(page: Page) {
  const sidebar = page.locator(".chrome-sidebar:visible");
  await ensureOpen(sidebar.locator("summary").filter({ hasText: "公考" }).first());
  await ensureOpen(sidebar.locator("summary").filter({ hasText: "模块" }).first());
  await sidebar.getByRole("button", { name: "学习数据" }).click();
  await page.getByRole("button", { name: "薄弱分析", exact: true }).click();
}

async function loadCurrentScenario(page: Page, scenarioId: string) {
  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("combobox", { name: "选择当前页面审查场景" }).selectOption(scenarioId);
  await page.getByRole("button", { name: "载入本页" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
}

function collectExternalRequests(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") requests.push(request.url());
  });
  return requests;
}

test("五个 UI 审查场景通过真实页面载入、持久化并阻止外联", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const externalRequests = collectExternalRequests(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/?ui-review=1");

  await openLearningInsights(page);
  await loadCurrentScenario(page, "library-insights-dense");
  await openLearningInsights(page);
  await expect(page.getByText("7 天移动平均", { exact: true })).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(6);

  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "插件" }).click();
  await loadCurrentScenario(page, "plugins-directory-dense");
  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "插件" }).click();
  await expect(page.getByRole("heading", { name: "插件市场" })).toBeVisible();
  await expect(page.getByText("申论结构教练").first()).toBeVisible();
  await expect(page.getByText("专注纸张").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("plugin-marketplace-1536.png"), fullPage: false });

  await page.reload();
  await page.getByRole("button", { name: "粉笔导入" }).first().click();
  await loadCurrentScenario(page, "import-console-mixed");
  await page.getByRole("button", { name: "粉笔导入" }).first().click();
  await expect(page.getByRole("button", { name: /有问题 4|有问题 5/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /草稿详情/ })).toBeVisible();
  await page.screenshot({ path: path.join(process.cwd(), "docs/design/ui-review-four-pages/import-console-1536.png"), fullPage: false });

  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await loadCurrentScenario(page, "settings-ai-connections-dense");
  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await expect(page.getByRole("region", { name: "已保存连接" }).getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("combobox", { name: "默认语音连接" })).toContainText("openai-prod");
  await page.screenshot({ path: path.join(process.cwd(), "docs/design/ui-review-four-pages/ai-connections-1536.png"), fullPage: false });
  await page.locator(".sample-scenario-trigger").click();
  await page.screenshot({ path: path.join(process.cwd(), "docs/design/ui-review-four-pages/settings-review-launcher-1536.png"), fullPage: false });
  await page.locator(".sample-scenario-trigger").click();

  await page.locator(".sample-scenario-trigger").click();
  await page.getByRole("combobox", { name: "选择当前页面审查场景" }).selectOption("settings-ai-credential-recovery");
  await page.getByRole("button", { name: "载入本页" }).click();
  await page.locator(".chrome-sidebar:visible").getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await expect(page.getByRole("button", { name: "测试" })).toBeDisabled();
  await page.getByRole("button", { name: "重新输入密钥" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "凭据需要重新输入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "测试连接" })).toBeDisabled();

  await page.reload();
  await expect(page.locator(".sample-scenario-trigger")).toBeVisible();
  expect(externalRequests).toEqual([]);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
