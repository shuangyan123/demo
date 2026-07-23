import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

test("390×844 已安排页签、编辑层和设置分区保持可访问且无横向溢出", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto("/");
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();

  await expect(page.getByRole("tab", { name: "任务" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /收件箱/ }).click();
  await expect(page.getByRole("tab", { name: /收件箱/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "任务" }).click();

  const newTask = page.getByRole("button", { name: "新建任务" });
  await newTask.focus();
  await newTask.click();
  const editor = page.getByRole("dialog", { name: "新建已安排任务" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("任务编辑步骤")).toContainText("基本信息");
  await page.keyboard.press("Escape");
  await expect(editor).toBeHidden();
  await expect(newTask).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("p2-scheduled-mobile-390x844.png"), fullPage: false });

  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("combobox", { name: "设置分区" }).selectOption("configuration");
  await expect(page.getByRole("heading", { name: "AI 连接" })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加连接" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("p2-settings-mobile-390x844.png"), fullPage: false });

  // 深色模式复用真实外观设置，分别记录设置与已安排的移动端验收截图。
  await page.getByRole("combobox", { name: "设置分区" }).selectOption("appearance");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("combobox", { name: "设置分区" }).selectOption("configuration");
  await page.screenshot({ path: testInfo.outputPath("p2-settings-mobile-dark-390x844.png"), fullPage: false });
  await page.getByRole("button", { name: "返回", exact: true }).click();
  const expandSidebar = page.getByRole("button", { name: "展开侧边栏" });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await page.getByLabel("工作台快捷入口").getByRole("button", { name: "已安排" }).click();
  await page.screenshot({ path: testInfo.outputPath("p2-scheduled-mobile-dark-390x844.png"), fullPage: false });

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
