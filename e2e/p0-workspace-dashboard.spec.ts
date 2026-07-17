import { expect, test, type Page } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 断言页面根节点没有产生横向滚动。 */
async function expectNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth + 1);
}

test("桌面总览保持唯一主操作、七阶段链路和三个折叠详情区", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.locator(".dashboard-next-action .ui-button-primary")).toHaveCount(1);
  await expect(page.locator(".dashboard-study-flow-list > li")).toHaveCount(7);
  await expect(page.locator(".dashboard-study-flow-path-desktop")).toBeVisible();
  await expect(page.getByText("粉笔文本、文件或截图先进入可确认草稿。")).toHaveCount(0);

  for (const label of ["六大板块", "知识中枢", "面试与辅导"]) {
    const disclosure = page.locator(".dashboard-disclosure").filter({ hasText: label });
    await expect(disclosure).not.toHaveAttribute("open", "");
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await disclosure.locator("summary").click();
    await expect(disclosure).not.toHaveAttribute("open", "");
  }

  await page.locator(".chrome-content").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: testInfo.outputPath("p0-dashboard-desktop.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  await expectNoHorizontalOverflow(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("桌面新对话使用左侧叠层边界且空白提示靠近底部输入框", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "新对话", exact: true }).click();

  await expect(page.getByRole("heading", { name: "从一个问题开始" })).toBeVisible();
  await expect(page.getByText("发送首条消息后才会创建对话")).toHaveCount(0);
  const boundary = await page.locator(".conversation-shell-content").evaluate((element) => {
    const style = getComputedStyle(element);
    return { marginLeft: style.marginLeft, radius: style.borderTopLeftRadius, shadow: style.boxShadow };
  });
  expect(boundary.marginLeft).toBe("10px");
  expect(boundary.radius).toBe("18px");
  expect(boundary.shadow).not.toBe("none");

  const composer = await page.locator(".conversation-composer").boundingBox();
  const prompt = await page.locator(".conversation-empty-prompt").boundingBox();
  expect(composer).toBeTruthy();
  expect(prompt).toBeTruthy();
  expect(1024 - (composer!.y + composer!.height)).toBeLessThan(28);
  expect(composer!.y - (prompt!.y + prompt!.height)).toBeLessThan(150);

  await page.screenshot({ path: testInfo.outputPath("p0-conversation-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(page.locator(".conversation-shell-content")).toHaveCSS("margin-left", "0px");
  await expect(page.locator(".conversation-shell-content")).toHaveCSS("border-top-left-radius", "0px");
});

test("移动端侧栏是默认关闭的焦点抽屉，七阶段沿 S 曲线自然滚动", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "展开侧边栏" });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole("dialog", { name: "应用导航" })).toBeHidden();
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "新对话", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await drawer.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "应用导航" })).toBeHidden();
  await expect(page.locator(".chrome-sidebar")).toHaveCSS("opacity", "0");
  await page.screenshot({ path: testInfo.outputPath("p0-conversation-mobile.png"), fullPage: false });

  await page.goto("/");
  await expect(page.locator(".chrome-layout")).toHaveAttribute("data-mobile-sidebar", "closed");
  await expect(page.locator(".chrome-sidebar")).toHaveCSS("opacity", "0");
  await expect(page.locator(".dashboard-study-flow-path-mobile")).toBeVisible();
  await expect(page.locator(".dashboard-study-flow-list > li")).toHaveCount(7);
  await expect(page.getByRole("button", { name: /Obsidian 输出/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("p0-dashboard-mobile.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("深色模式下桌面与移动端保持学习路径和新对话可用", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "返回应用" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".dashboard-study-flow-path-desktop")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".dashboard-study-flow-path-mobile")).toBeVisible();
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.getByRole("dialog", { name: "应用导航" }).getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "对话输入" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
