import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("移动 UI 审查对话主题使用可锁定焦点的底部抽屉且页面无横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/?ui-review=1");
  const appNavigation = page.getByRole("dialog", { name: "应用导航" });
  if (!(await appNavigation.isVisible())) await page.getByRole("button", { name: "展开侧边栏" }).click();
  await appNavigation.getByRole("button", { name: "新对话" }).click();
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await appNavigation.locator(".sample-scenario-trigger").click();
  await appNavigation.getByLabel("选择当前页面审查场景").selectOption("conversation-normal");
  await appNavigation.getByRole("button", { name: "载入本页" }).click();
  await page.reload();
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await appNavigation.getByRole("button", { name: "必要条件与充分条件", exact: true }).click();

  const trigger = page.getByRole("button", { name: "主题 6" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "主题目录" });
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("v0.2.2-conversation-topics-mobile.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
