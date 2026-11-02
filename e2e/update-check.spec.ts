import { expect, test, type Page } from "@playwright/test";
import { readMockUpdate } from "../app/server/updates/mock-source";
import { REVIEW_WORKSPACE_VERSION } from "../app/config/app-metadata";

async function openUpdates(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "诊断", exact: true }).click();
  return page.getByRole("region", { name: "版本与更新", exact: true });
}
test("version is visible without checking; explicit keyboard action reads the real local mock endpoint", async ({ page }) => {
  let requests = 0, downloads = 0;
  page.on("request", request => { if (request.url().includes("/api/updates/")) requests++; });
  page.on("download", () => { downloads++; });
  const panel = await openUpdates(page);
  await expect(panel).toContainText(`当前应用版本：${REVIEW_WORKSPACE_VERSION}`);
  await expect(panel).toContainText("不代表正式发布");
  expect(requests).toBe(0);
  await panel.getByRole("button", { name: "检查模拟更新" }).focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByLabel("版本检查状态")).toContainText("模拟源有可用新版本");
  await expect(panel).toContainText("模拟源版本：0.3.2");
  await expect(panel).toContainText("改进本地学习体验");
  expect(requests).toBe(1); expect(downloads).toBe(0);
  await expect(panel.getByRole("button", { name: /下载|安装/ })).toHaveCount(0);
});
for (const [scenario, message] of [["current", "与模拟源版本一致"], ["older", "不提供降级"],
  ["incompatible", "不兼容"], ["invalid", "格式或版本无效"], ["failure", "版本查询失败"], [undefined, "模拟更新源未启用"]] as const) {
  test(`mock state ${scenario ?? "disabled"} is explicit and leaves navigation available`, async ({ page }) => {
    const fixture = readMockUpdate(scenario);
    await page.route("**/api/updates/mock", route => route.fulfill({ status: fixture.status, body: fixture.source, contentType: "application/json" }));
    const panel = await openUpdates(page);
    await panel.getByRole("button", { name: "检查模拟更新" }).click();
    await expect(panel.getByLabel("版本检查状态")).toContainText(message);
    await expect(panel.getByRole("button", { name: "检查模拟更新" })).toBeEnabled();
    await page.getByRole("button", { name: "外观", exact: true }).click();
    await expect(panel).toHaveCount(0);
  });
}
test("pending check disables duplicate actions and renders release notes as text", async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route("**/api/updates/mock", async route => {
    calls++; await waiting;
    const metadata = JSON.parse(readMockUpdate("available").source);
    metadata.releaseNotes = '<img src="bad" onerror="window.mockExecuted=true">';
    await route.fulfill({ body: JSON.stringify(metadata), contentType: "application/json" });
  });
  const panel = await openUpdates(page);
  await panel.getByRole("button", { name: "检查模拟更新" }).click();
  await expect(panel.getByRole("button", { name: "检查中…" })).toBeDisabled();
  await expect(panel.getByLabel("版本检查状态")).toContainText("正在查询");
  release();
  await expect(panel).toContainText('<img src="bad"');
  await expect(panel.locator("img")).toHaveCount(0); expect(calls).toBe(1);
});
test("timeout is bounded and a later manual check can succeed", async ({ page }) => {
  await page.route("**/api/updates/mock", () => {});
  const panel = await openUpdates(page);
  await panel.getByRole("button", { name: "检查模拟更新" }).click();
  await expect(panel.getByLabel("版本检查状态")).toContainText("查询失败或超时", { timeout: 8000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await panel.getByRole("button", { name: "检查模拟更新" }).click();
  await expect(panel.getByLabel("版本检查状态")).toContainText("模拟源有可用新版本");
});
