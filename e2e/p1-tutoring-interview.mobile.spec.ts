import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("P1 移动辅导信息抽屉锁定焦点、恢复焦点且页面无横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  const learningDetails = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "面试与辅导" }) }).first();
  if (!(await learningDetails.evaluate((element) => (element as HTMLDetailsElement).open))) await learningDetails.locator("summary").click();
  await page.getByRole("button", { name: "开始对话辅导" }).click();

  const trigger = page.getByRole("button", { name: /本轮进度/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: /本轮进度/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("本轮目标")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("p1-tutoring-mobile.png"), fullPage: false });
  await page.evaluate(() => { document.body.dataset.theme = "dark"; });
  await page.screenshot({ path: testInfo.outputPath("p1-tutoring-mobile-dark.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
