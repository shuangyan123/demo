import { expect, test, type Locator, type Page } from "@playwright/test";
import { readConversationModelSelection, seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

type FrameGate = { hold: () => void; flush: () => number };
type FrameWindow = Window & { pickerFrameGate: FrameGate };

/** 控制事件顺序而非等待时间：暂扣 Tab 后的帧，再在换层卸载时依注册顺序执行。 */
async function installFrameGate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map<number, FrameRequestCallback>();
    let holding = false;
    let sequence = 0;
    window.requestAnimationFrame = (callback) => {
      if (!holding) return request(callback);
      const id = --sequence;
      pending.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (id < 0) pending.delete(id);
      else cancel(id);
    };
    (window as unknown as FrameWindow).pickerFrameGate = {
      hold: () => { holding = true; },
      flush: () => {
        holding = false;
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback(performance.now());
        return callbacks.length;
      },
    };
  });
}

async function seedPicker(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "focus-minimax", label: "Focus MiniMax", provider: "minimax", apiFormat: "anthropic_messages" },
    { id: "focus-google", label: "Focus Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [{ id: "focus-chat", title: "模型焦点契约", connectionId: "focus-minimax", modelId: "MiniMax-M3" }]);
  await page.reload();
  await page.locator('[data-conversation-id="focus-chat"] .conversation-tree-chat-label').click();
  await page.getByRole("button", { name: "选择模型", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择对话模型", exact: true });
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  // 指针留在级联之外，测试纯键盘焦点，不触发另一个 hover 层。
  await page.mouse.move(0, 0);
  return picker;
}

async function enterModels(picker: Locator): Promise<void> {
  await picker.getByRole("button", { name: /^模型 / }).press("ArrowRight");
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await picker.getByRole("button", { name: "Google Gemini", exact: true }).press("ArrowRight");
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await expect(picker.getByRole("searchbox", { name: "搜索模型" })).toBeFocused();
}

async function holdFrames(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as FrameWindow).pickerFrameGate.hold());
}

async function flushAtUnmount(page: Page, picker: Locator, view: string): Promise<void> {
  await expect(picker).toHaveAttribute("data-model-picker-view", view);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  expect(await page.evaluate(() => (window as unknown as FrameWindow).pickerFrameGate.flush())).toBeGreaterThan(0);
  await expect(picker).toBeVisible();
}

test("模型焦点竞态：内部 Tab 后 ArrowLeft/Right 换层不关闭 dialog", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await installFrameGate(page);
  const picker = await seedPicker(page);
  const before = await readConversationModelSelection(page, "focus-chat");
  await enterModels(picker);
  const search = picker.getByRole("searchbox", { name: "搜索模型" });
  const radio = picker.getByRole("radio").first();
  await holdFrames(page);
  await page.keyboard.press("Tab");
  await expect(radio).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(radio).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await flushAtUnmount(page, picker, "providers");
  const provider = picker.getByRole("button", { name: "Google Gemini", exact: true });
  await expect(provider).toBeFocused();
  await provider.press("ArrowRight");
  await expect(search).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(provider).toBeFocused();
  await expect(picker).toBeVisible();
  expect(await readConversationModelSelection(page, "focus-chat")).toEqual(before);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(errors);
});

test("模型焦点竞态：runtime 内部 Tab 与方向键往返不关闭 dialog", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await installFrameGate(page);
  const picker = await seedPicker(page);
  const before = await readConversationModelSelection(page, "focus-chat");
  for (const [name, view] of [[/^推理强度 /, "reasoning"], [/^速度 /, "speed"]] as const) {
    const control = picker.getByRole("button", { name });
    await control.press("ArrowRight");
    await expect(picker).toHaveAttribute("data-model-picker-view", view);
    const option = picker.locator('[data-model-picker-surface="runtime"]').getByRole("radio").first();
    await expect(option).toBeFocused();
    await holdFrames(page);
    await page.keyboard.press("Shift+Tab");
    await expect(picker.getByRole("button", { name: "返回模型", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(option).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await flushAtUnmount(page, picker, "controls");
    await expect(control).toBeFocused();
  }
  expect(await readConversationModelSelection(page, "focus-chat")).toEqual(before);
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(errors);
});

test("模型焦点竞态：旧 Tab 帧不能关闭重新打开的 picker", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await installFrameGate(page);
  const picker = await seedPicker(page);
  await enterModels(picker);
  await holdFrames(page);
  await page.keyboard.press("Tab");
  await expect(picker.getByRole("radio").first()).toBeFocused();
  const trigger = page.getByRole("button", { name: "选择模型", exact: true });
  await trigger.click();
  await expect(picker).toBeHidden();
  await trigger.click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await picker.getByRole("button", { name: /^模型 / }).press("ArrowRight");
  const provider = picker.getByRole("button", { name: "Google Gemini", exact: true });
  await provider.press("ArrowRight");
  await picker.getByRole("searchbox", { name: "搜索模型" }).press("ArrowLeft");
  await flushAtUnmount(page, picker, "providers");
  await expect(provider).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(errors);
});

test("模型 dismiss 契约：Escape 按层返回并恢复触发器焦点", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const picker = await seedPicker(page);
  await enterModels(picker);
  const search = picker.getByRole("searchbox", { name: "搜索模型" });
  await search.fill("gemini");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(picker).toHaveAttribute("data-model-picker-view", "models");
  await search.press("Escape");
  await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
  await expect(picker.getByRole("button", { name: "Google Gemini", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  const trigger = page.getByRole("button", { name: "选择模型", exact: true });
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(errors);
});

test("模型 dismiss 契约：外部 pointer 和真实 Tab 退出不抢回焦点", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const picker = await seedPicker(page);
  const input = page.getByRole("textbox", { name: "对话输入" });
  await input.click();
  await expect(picker).toBeHidden();
  await expect(input).toBeFocused();
  const trigger = page.getByRole("button", { name: "选择模型", exact: true });
  for (const key of ["Tab", "Shift+Tab"]) {
    await trigger.click();
    await expect(picker).toBeVisible();
    const controls = picker.getByRole("button");
    if (key === "Tab") await controls.last().focus();
    else await trigger.focus();
    for (let step = 0; step < 30 && await picker.isVisible(); step += 1) await page.keyboard.press(key);
    await expect(picker).toBeHidden();
    await expect(trigger).not.toBeFocused();
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(false);
  }
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(errors);
});

test("模型 dismiss 契约：selection 关闭、持久化并恢复模型触发器", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const picker = await seedPicker(page);
  await enterModels(picker);
  await picker.getByRole("radio", { name: /gemini-3\.5-flash/ }).locator("xpath=..").click();
  await expect(picker).toBeHidden();
  const trigger = page.getByRole("button", { name: "选择模型", exact: true });
  await expect(trigger).toBeFocused();
  await expect.poll(async () => (await readConversationModelSelection(page, "focus-chat")).modelId).toBe("gemini-3.5-flash");
  await expect(trigger).toContainText("gemini-3.5-flash");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(errors);
});
