import { expect, test, type Page } from "@playwright/test";
import { readConversationModelSelection, seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/**
 * PRE-EXISTING MOBILE E2E DEBT EXPOSED BY RESTORED ACTIONS EXECUTION:
 * this flow follows the current main Escape contract.
 */
/** 移动视口不得出现页面级横向滚动。 */
async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

/** 从移动抽屉点击工作台入口，导航完成后抽屉应自动关闭。 */
async function selectMobileWorkspaceEntry(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await drawer.getByRole("button", { name, exact: typeof name === "string" }).click();
  await expect(drawer).toBeHidden();
}

test("390×844 下 GLM 七档和两档按内容布局，触控目标、滚动与 composer 均可用", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "mobile-glm", label: "E2E GLM", provider: "zhipu", apiFormat: "chat_completions" },
  ], [
    { id: "mobile-glm-chat", title: "移动 GLM 菜单", connectionId: "mobile-glm", modelId: "glm-5.2", runtime: { reasoning: "max" } },
  ]);
  await page.reload();
  await selectMobileWorkspaceEntry(page, "移动 GLM 菜单");
  await expect(page.locator('[data-conversation-layer="workspace"]')).toBeVisible();
  const conversationGeometry = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-workspace-frame="true"]')!.getBoundingClientRect();
    const workspace = document.querySelector<HTMLElement>('[data-conversation-layer="workspace"]')!.getBoundingClientRect();
    const messageList = document.querySelector<HTMLElement>('[data-conversation-layer="canvas-scroll"]')!;
    const composer = document.querySelector<HTMLElement>('[data-conversation-layer="composer-card"]')!.getBoundingClientRect();
    return {
      composerBottom: composer.bottom,
      frameBottom: frame.bottom,
      listOverflowY: getComputedStyle(messageList).overflowY,
      viewportHeight: window.innerHeight,
      workspaceBottom: workspace.bottom,
    };
  });
  expect(conversationGeometry.frameBottom).toBeLessThanOrEqual(conversationGeometry.viewportHeight + 1);
  expect(conversationGeometry.workspaceBottom).toBeLessThanOrEqual(conversationGeometry.viewportHeight + 1);
  expect(conversationGeometry.composerBottom).toBeLessThanOrEqual(conversationGeometry.viewportHeight);
  expect(conversationGeometry.composerBottom).toBeGreaterThan(conversationGeometry.viewportHeight - 32);
  expect(conversationGeometry.listOverflowY).toBe("auto");
  await expectNoDocumentHorizontalOverflow(page);
  await page.locator('[data-conversation-composer] input[type="file"]').setInputFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `移动端多行附件-${index + 1}-用于验证动态浮层定位.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`fixture-${index + 1}`),
    })),
  );
  await expect(page.locator(".conversation-attachment-chips > span")).toHaveCount(6);

  const trigger = page.getByRole("button", { name: "选择模型" });
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await picker.getByRole("button", { name: /^模型 / }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await picker.getByRole("button", { name: "GLM / 智谱" }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await expect(picker.getByRole("button", { name: /推理/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await trigger.click();
  const reasoningTrigger = picker.getByRole("button", { name: /^推理强度 / });
  const triggerBox = await reasoningTrigger.boundingBox();
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(43.9);
  await reasoningTrigger.click();
  const reasoningDialog = picker.getByRole("region", { name: "选择推理档位" });
  const xhighOption = reasoningDialog.getByRole("radio", { name: "xhigh", exact: true });
  const sliderBox = await xhighOption.locator("xpath=..").boundingBox();
  expect(sliderBox?.height ?? 0).toBeGreaterThanOrEqual(43.9);
  await xhighOption.locator("xpath=..").click();
  await expect.poll(async () => (await readConversationModelSelection(page, "mobile-glm-chat")).runtime?.reasoning).toBe("xhigh");
  await expect(page.locator('body > [role="tooltip"]')).toHaveCount(0);

  const pickerBox = await reasoningDialog.boundingBox();
  const composerBox = await page.locator("[data-conversation-composer]").boundingBox();
  expect(pickerBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect((pickerBox?.y ?? 0) + (pickerBox?.height ?? 0)).toBeLessThanOrEqual((composerBox?.y ?? Number.POSITIVE_INFINITY) + 1);
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-mobile-seven-levels.png"), fullPage: false });

  await page.keyboard.press("Escape");
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await picker.getByRole("button", { name: /^模型 / }).click();
  await picker.getByRole("button", { name: "GLM / 智谱" }).click();
  await picker.getByRole("radio", { name: /^glm-5\.1/ }).locator("xpath=..").click();
  await page.keyboard.press("Escape");
  await trigger.click();
  await picker.getByRole("button", { name: /^推理强度 / }).click();
  await expect(reasoningDialog.getByRole("radio")).toHaveCount(2);
  await expect.poll(async () => (await reasoningDialog.boundingBox())?.height).toBeLessThanOrEqual(190);

  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-mobile-two-levels.png"), fullPage: false });

  await page.keyboard.press("Escape");
  await selectMobileWorkspaceEntry(page, "设置");
  await selectMobileWorkspaceEntry(page, "外观");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await selectMobileWorkspaceEntry(page, "返回应用");
  await selectMobileWorkspaceEntry(page, "移动 GLM 菜单");
  await page.getByRole("button", { name: "选择模型" }).click();
  await page.getByRole("dialog", { name: "选择对话模型" }).getByRole("button", { name: /^推理强度 / }).click();
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-mobile-dark.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
