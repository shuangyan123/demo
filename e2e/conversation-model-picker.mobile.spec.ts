import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 移动视口不得出现页面级横向滚动。 */
async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

/** 验证弹层尾部只保留紧凑内边距，不继承其他档位的固定高度。 */
async function expectCompactTrailingSpace(picker: Locator): Promise<void> {
  const trailing = await picker.evaluate((element) => {
    const radios = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const last = radios.at(-1)?.closest("label")?.getBoundingClientRect();
    const panel = element.getBoundingClientRect();
    return last ? panel.bottom - last.bottom : Number.POSITIVE_INFINITY;
  });
  expect(trailing).toBeLessThanOrEqual(16.5);
}

test("390×844 下 GLM 七档和两档按内容布局，触控目标、滚动与 composer 均可用", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "mobile-glm", label: "E2E GLM", provider: "zhipu", apiFormat: "chat_completions" },
  ], [
    { id: "mobile-glm-chat", title: "移动 GLM 菜单", connectionId: "mobile-glm", modelId: "glm-5.2", runtime: { reasoning: "max" } },
  ]);
  await page.reload();
  await page.locator('[data-conversation-id="mobile-glm-chat"] .conversation-tree-chat-label').click();
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
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await picker.getByRole("button", { name: "GLM / 智谱" }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await picker.getByRole("button", { name: /推理/ }).click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "reasoning");
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeGreaterThanOrEqual(286);
  await expect.poll(async () => (await picker.boundingBox())?.width).toBeLessThanOrEqual(290);

  const sevenLevels = picker.getByRole("radio");
  await expect(sevenLevels).toHaveCount(7);
  for (const radio of await sevenLevels.all()) {
    const box = await radio.locator("xpath=..").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.9);
  }
  const backBox = await picker.getByRole("button", { name: "返回模型" }).boundingBox();
  expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(43.9);
  const xhigh = picker.getByRole("radio", { name: /^xhigh/ });
  const xhighBox = await xhigh.locator("xpath=..").boundingBox();
  if (!xhighBox) throw new Error("xhigh 触控行没有可见边界");
  await page.touchscreen.tap(xhighBox.x + xhighBox.width / 2, xhighBox.y + xhighBox.height / 2);
  await expect(xhigh).toBeChecked();
  await expect(page.getByRole("tooltip", { name: "兼容值，服务端映射到 max" })).toBeVisible();
  await expectCompactTrailingSpace(picker);

  const pickerBox = await picker.boundingBox();
  const composerBox = await page.locator("[data-conversation-composer]").boundingBox();
  expect(pickerBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect((pickerBox?.y ?? 0) + (pickerBox?.height ?? 0)).toBeLessThanOrEqual((composerBox?.y ?? Number.POSITIVE_INFINITY) + 1);
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-mobile-seven-levels.png"), fullPage: false });

  await picker.getByRole("button", { name: "返回模型" }).click();
  await picker.getByRole("radio", { name: /^glm-5\.1/ }).locator("xpath=..").click();
  await picker.getByRole("button", { name: /推理/ }).click();
  await expect(picker.getByRole("radio")).toHaveCount(2);
  await expect.poll(async () => (await picker.boundingBox())?.height).toBeLessThanOrEqual(150);
  await expectCompactTrailingSpace(picker);

  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-mobile-two-levels.png"), fullPage: false });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "外观" }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "返回应用" }).click();
  await page.locator('[data-conversation-id="mobile-glm-chat"] .conversation-tree-chat-label').click();
  await trigger.click();
  await picker.getByRole("button", { name: "GLM / 智谱" }).click();
  await picker.getByRole("radio", { name: /^glm-5\.2/ }).locator("xpath=..").click();
  await picker.getByRole("button", { name: /推理/ }).click();
  await page.screenshot({ path: testInfo.outputPath("conversation-model-picker-mobile-dark.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
