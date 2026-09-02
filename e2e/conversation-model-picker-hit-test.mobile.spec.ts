import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

type HitTestNode = {
  tag: string;
  className: string;
  layer: string | undefined;
  pickerSurface: string | undefined;
  focusKey: string | undefined;
};

type HitTestSnapshot = {
  point: { x: number; y: number };
  control: HitTestNode;
  hit: HitTestNode | null;
  stack: HitTestNode[];
  ownsHit: boolean;
};

async function selectMobileWorkspaceEntry(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  const drawer = page.getByRole("dialog", { name: "应用导航" });
  await drawer.getByRole("button", { name, exact: true }).click();
  await expect(drawer).toBeHidden();
}

async function nextAnimationFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function readModelControlHitTest(control: Locator): Promise<HitTestSnapshot> {
  return control.evaluate((element) => {
    const describe = (node: Element | null): HitTestNode | null => node ? {
      tag: node.tagName.toLowerCase(),
      className: typeof node.className === "string" ? node.className : "",
      layer: node.getAttribute("data-conversation-layer") ?? undefined,
      pickerSurface: node.getAttribute("data-model-picker-surface") ?? undefined,
      focusKey: node.getAttribute("data-picker-focus-key") ?? undefined,
    } : null;
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    const stack = document.elementsFromPoint(point.x, point.y).map((node) => describe(node)).filter((node): node is HitTestNode => Boolean(node));
    return {
      point,
      control: describe(element)!,
      hit: describe(hit),
      stack,
      ownsHit: Boolean(hit && element.contains(hit)),
    };
  });
}

async function expectModelControlOwnsHitTest(page: Page, control: Locator): Promise<void> {
  for (let frame = 0; frame < 6; frame += 1) {
    await nextAnimationFrame(page);
    const snapshot = await readModelControlHitTest(control);
    expect(snapshot.ownsHit, JSON.stringify(snapshot)).toBe(true);
    expect(snapshot.hit?.layer, JSON.stringify(snapshot)).not.toBe("reading-column");
  }
}

test("移动端模型控制中心点在打开后的布局帧内始终由 picker 拥有", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [
    { id: "mobile-hit-google", label: "移动命中 Gemini", provider: "google", apiFormat: "google_generate_content" },
  ], [
    { id: "mobile-hit-chat", title: "移动命中归属", connectionId: "mobile-hit-google", modelId: "gemini-3.5-flash" },
  ]);
  await page.reload();
  await selectMobileWorkspaceEntry(page, "移动命中归属");

  const trigger = page.getByRole("button", { name: "选择模型" });
  const picker = page.getByRole("dialog", { name: "选择对话模型" });
  const outsideTarget = page.locator('[data-conversation-layer="reading-column"]');

  for (let iteration = 0; iteration < 6; iteration += 1) {
    await trigger.click();
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute("data-model-picker-view", "controls");
    const modelControl = picker.locator('[data-picker-focus-key="control-entry:model"]');
    await expect(modelControl).toBeVisible();
    await expectModelControlOwnsHitTest(page, modelControl);

    // This is intentionally a normal Playwright click: an intercepted center point must fail here.
    await modelControl.click();
    await expect(picker).toHaveAttribute("data-model-picker-view", "providers");

    if (iteration % 2 === 0) {
      await outsideTarget.click({ position: { x: 24, y: 24 } });
      await expect(picker).toBeHidden();
      continue;
    }

    const provider = picker.locator('[data-model-picker-surface="provider"]');
    await expect(provider).toBeVisible();
    // An internal click must keep the picker alive and advance the same navigation session.
    await provider.getByRole("button", { name: "Google Gemini", exact: true }).click();
    await expect(picker).toHaveAttribute("data-model-picker-view", "models");
    const model = picker.locator('[data-model-picker-surface="model"]');
    await expect(model).toBeVisible();
    await model.getByRole("button", { name: "返回厂商" }).click();
    await expect(picker).toHaveAttribute("data-model-picker-view", "providers");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
  }

  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
