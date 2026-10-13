import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { waitForWorkspaceViewReady } from "./helpers/workspace-readiness";

test("P2 桌面已安排与设置在浅色和深色模式下保持主从布局", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");

  await page.getByRole("button", { name: "已安排" }).first().click();
  const scheduledHeading = page.getByRole("heading", { name: "已安排", exact: true });
  await waitForWorkspaceViewReady(scheduledHeading);
  const scheduledTopOffset = await scheduledHeading.evaluate((heading) => {
    const main = heading.closest("main");
    return main ? heading.getBoundingClientRect().top - main.getBoundingClientRect().top : -1;
  });
  expect(scheduledTopOffset).toBeGreaterThanOrEqual(15);
  expect(scheduledTopOffset).toBeLessThanOrEqual(17);
  await expect(page.getByText("运行收件箱", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建任务", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p2-scheduled-desktop-1536x1024.png"), fullPage: false });

  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p2-settings-desktop-1536x1024.png"), fullPage: false });

  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "AI 连接" }).click();
  await page.screenshot({ path: testInfo.outputPath("p2-settings-desktop-dark-1536x1024.png"), fullPage: false });
  await page.getByRole("button", { name: "返回应用" }).click();
  await page.getByRole("button", { name: "已安排" }).first().click();
  await waitForWorkspaceViewReady(scheduledHeading);
  await page.screenshot({ path: testInfo.outputPath("p2-scheduled-desktop-dark-1536x1024.png"), fullPage: false });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
