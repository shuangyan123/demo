import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";
import { seedConversationModelFixtures } from "./helpers/conversation-model-fixtures";

test("设置导航、厂商选择与弥散状态保持独立且可持久化", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();

  await expect(page.getByRole("button", { name: "个性化" })).toBeVisible();
  await expect(page.getByRole("button", { name: "额度" })).toBeVisible();
  await expect(page.getByRole("button", { name: "角色", exact: true })).toHaveCount(0);

  const lightDiffuse = page.getByRole("switch", { name: "浅色主题弥散渐变" });
  await expect(lightDiffuse).toHaveAttribute("aria-checked", "false");
  await lightDiffuse.click();
  await expect(page.locator("body")).toHaveAttribute("data-diffuse-gradient", "true");
  await page.getByRole("button", { name: "返回应用" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const expandSidebar = page.getByRole("button", { name: "展开侧边栏" });
  if (await expandSidebar.isVisible()) await expandSidebar.click();
  await expect(page.locator(".chrome-layout")).toHaveClass(/is-sidebar-expanded/);
  const workspaceDiffuse = await page.locator(".chrome-content-frame").evaluate((frame) => {
    const main = frame.querySelector<HTMLElement>(".chrome-content")!;
    const layout = frame.closest<HTMLElement>(".chrome-layout")!;
    const frameStyle = getComputedStyle(frame);
    const layoutStyle = getComputedStyle(layout);
    const mainStyle = getComputedStyle(main);
    return {
      frameBackgroundColor: frameStyle.backgroundColor,
      frameBackgroundImage: frameStyle.backgroundImage,
      frameRadius: frameStyle.borderTopLeftRadius,
      layoutBackgroundImage: layoutStyle.backgroundImage,
      mainBackgroundColor: mainStyle.backgroundColor,
      mainBackgroundImage: mainStyle.backgroundImage,
    };
  });
  expect(workspaceDiffuse.frameBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(workspaceDiffuse.frameBackgroundImage).toContain("radial-gradient");
  expect(workspaceDiffuse.frameRadius).toBe("18px");
  expect(workspaceDiffuse.layoutBackgroundImage).toBe("none");
  expect(workspaceDiffuse.mainBackgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(workspaceDiffuse.mainBackgroundImage).toBe("none");
  await page.setViewportSize({ width: 1115, height: 792 });
  const diffuseFrameBox = await page.locator(".chrome-content-frame").boundingBox();
  expect(diffuseFrameBox).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("settings-diffuse-corner-desktop.png"),
    clip: {
      x: Math.max(0, diffuseFrameBox!.x - 24),
      y: Math.max(0, diffuseFrameBox!.y - 20),
      width: 84,
      height: 84,
    },
  });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.getByRole("button", { name: "设置" }).first().click();
  const sharedChromeDiffuse = await page.locator(".chrome-shell").evaluate((element) => ({
    shell: getComputedStyle(element, "::before").backgroundImage,
    topbar: getComputedStyle(element.querySelector<HTMLElement>(".chrome-topbar")!).backgroundImage,
    sidebar: getComputedStyle(element.querySelector<HTMLElement>(".chrome-sidebar")!).backgroundImage,
  }));
  expect(sharedChromeDiffuse.shell).toContain("radial-gradient");
  expect(sharedChromeDiffuse.topbar).toBe("none");
  expect(sharedChromeDiffuse.sidebar).toBe("none");
  const codeFontFamily = await page.locator("body").evaluate((element) => getComputedStyle(element).getPropertyValue("--app-code-font"));
  expect(codeFontFamily).toContain("GeistMono");
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByRole("switch", { name: "浅色主题弥散渐变" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("settings-appearance-dark-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.getByRole("switch", { name: "浅色主题弥散渐变" })).toHaveAttribute("aria-checked", "true");
  // 视觉基准使用关闭弥散的中性浅色主题，避免背景色场干扰宽度与层级比对。
  await page.getByRole("switch", { name: "浅色主题弥散渐变" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-diffuse-gradient", "false");
  await expect(page.locator(".chrome-topbar")).toHaveCSS("background-image", "none");

  await page.getByRole("button", { name: "AI 连接" }).click();
  const provider = page.getByRole("combobox", { name: "厂商" });
  await provider.click();
  const options = page.getByRole("listbox", { name: "厂商" }).getByRole("option");
  await expect(options).toHaveCount(20);
  const optionLabels = await options.allTextContents();
  expect(new Set(optionLabels).size).toBe(20);
  await expect(page.getByRole("option", { name: /Azure OpenAI/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-provider-select-desktop.png"), fullPage: false });

  await page.keyboard.press("Escape");
  const capabilityPanel = page.getByRole("region", { name: "默认能力分配" });
  const capabilityBox = await capabilityPanel.boundingBox();
  expect(capabilityBox?.width).toBeLessThanOrEqual(562);
  await expect(page.getByText("默认文本", { exact: true })).toBeVisible();
  await expect(page.getByText("默认多模态", { exact: true })).toBeVisible();
  await expect(page.getByText("默认语音", { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("settings-ai-connections-compact-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "个性化" }).click();
  await expect(page.getByRole("heading", { name: "个性化" })).toBeVisible();
  await page.getByRole("button", { name: "额度" }).click();
  await expect(page.getByRole("heading", { name: "额度与用量" })).toBeVisible();
  const quotaTable = page.getByRole("region", { name: "AI 额度与用量" });
  expect((await quotaTable.boundingBox())?.width).toBeLessThanOrEqual(762);
  await page.screenshot({ path: testInfo.outputPath("settings-quota-compact-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "额度", exact: true }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath("settings-quota-compact-desktop-dark.png"), fullPage: false });
  await page.waitForTimeout(250);
  await expect(page.getByRole("heading", { name: "额度与用量" })).toBeVisible();
  await page.getByRole("button", { name: "诊断" }).click();
  await expect(page.getByRole("heading", { name: "诊断", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "个性化" }).click();
  await expect(page.getByRole("heading", { name: "个性化" })).toBeVisible();
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("额度页面通过归一化接口验证并刷新，不暴露原始响应", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.route("**/api/ai/quota", async (route) => {
    const body = route.request().postDataJSON() as { action?: string; provider?: string };
    if (body.action === "validate") {
      await route.fulfill({ json: { valid: true, provider: body.provider, message: "额度凭据验证通过" } });
      return;
    }
    await route.fulfill({ json: {
      id: body.provider,
      provider: body.provider,
      label: "DeepSeek",
      status: "ready",
      source: "official",
      metrics: [{ id: "remaining_balance", label: "官方可用余额", value: 1, unit: "CNY", source: "official" }],
      remainingAmount: 1,
      currency: "CNY",
      officialRemainingAvailable: true,
      message: "已读取官方余额",
      refreshedAt: new Date().toISOString(),
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "额度" }).click();
  const quotaPanel = page.getByRole("region", { name: "AI 额度与用量" });
  await quotaPanel.getByRole("switch", { name: "DeepSeek额度刷新" }).check();
  await quotaPanel.getByRole("button", { name: "配置DeepSeek额度" }).click();
  let dialog = page.getByRole("dialog", { name: "配置 DeepSeek" });
  await dialog.getByLabel("DeepSeek API Key").fill("test-key-not-real");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await quotaPanel.getByRole("button", { name: "配置DeepSeek额度" }).click();
  dialog = page.getByRole("dialog", { name: "配置 DeepSeek" });
  await dialog.getByRole("button", { name: "测试凭据" }).click();
  await expect(page.getByText("额度凭据验证通过", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(quotaPanel).toContainText("官方");
  await dialog.getByRole("button", { name: "关闭额度配置" }).click();
  await expect(quotaPanel.getByRole("button", { name: "刷新DeepSeek额度" })).toBeVisible();
  const metricRing = quotaPanel.getByRole("button", { name: /官方可用余额/ });
  await metricRing.hover();
  await expect(page.getByRole("tooltip")).toContainText("官方可用余额");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});

test("设置融合壳层、连接列、Claude 品牌色与插件详情边界符合批注", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1115, height: 792 });
  await page.goto("/");
  await seedConversationModelFixtures(page, [{
    id: "claude-layout-fixture",
    label: "Claude 示例连接",
    provider: "anthropic",
    apiFormat: "chat_completions",
    baseUrl: "https://api.anthropic.com",
  }], []);
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();

  await expect(page.locator('[aria-label="开发示例状态"]')).toHaveCount(0);

  const shellGeometry = await page.locator(".chrome-shell").evaluate((shell) => {
    const main = shell.querySelector<HTMLElement>(".chrome-content")!;
    const frame = shell.querySelector<HTMLElement>(".chrome-content-frame")!;
    const topbar = shell.querySelector<HTMLElement>(".chrome-topbar")!;
    const sidebar = shell.querySelector<HTMLElement>(".chrome-sidebar")!;
    return {
      mainTop: main.getBoundingClientRect().top,
      frameTop: frame.getBoundingClientRect().top,
      frameBottom: frame.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      topbarColor: getComputedStyle(topbar).backgroundColor,
      sidebarColor: getComputedStyle(sidebar).backgroundColor,
    };
  });
  expect(shellGeometry.mainTop).toBe(12);
  expect(shellGeometry.frameTop).toBe(12);
  expect(shellGeometry.frameBottom).toBe(shellGeometry.viewportHeight);
  expect(shellGeometry.topbarColor).toBe(shellGeometry.sidebarColor);

  await page.getByRole("button", { name: "AI 连接" }).click();
  const table = page.locator('[class*="connectionTable"]').first();
  const centers = await table.evaluate((element) => {
    const header = element.firstElementChild as HTMLElement;
    const row = header.nextElementSibling as HTMLElement;
    return [...header.children].map((cell, index) => {
      const headerRect = (cell as HTMLElement).getBoundingClientRect();
      const rowRect = (row.children[index] as HTMLElement).getBoundingClientRect();
      return Math.abs((headerRect.left + headerRect.width / 2) - (rowRect.left + rowRect.width / 2));
    });
  });
  expect(Math.max(...centers)).toBeLessThanOrEqual(1);
  const actionButtons = table.locator('[class*="connectionActions"]').first().getByRole("button");
  await expect(actionButtons).toHaveCount(3);
  for (const button of await actionButtons.all()) {
    await expect(button).toBeVisible();
    await expect(button).toHaveCSS("white-space", "nowrap");
  }
  await page.screenshot({ path: testInfo.outputPath("settings-ai-connections-1115x792.png"), fullPage: false });
  const claudeColor = await page.locator('[data-render-mode="mask"]').first().evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(claudeColor).toBe("rgb(217, 119, 87)");

  await page.getByRole("button", { name: "返回应用" }).click();
  await page.getByRole("button", { name: "插件" }).click();
  const search = page.getByRole("textbox", { name: "搜索插件" });
  await search.focus();
  const searchStyles = await search.evaluate((input) => {
    const inputStyle = getComputedStyle(input);
    const rowStyle = getComputedStyle(input.parentElement!);
    return {
      inputBorder: inputStyle.borderTopWidth,
      inputOutline: inputStyle.outlineStyle,
      inputShadow: inputStyle.boxShadow,
      rowBorder: rowStyle.borderTopWidth,
      rowOutline: rowStyle.outlineStyle,
      rowShadow: rowStyle.boxShadow,
    };
  });
  expect(searchStyles).toEqual({
    inputBorder: "0px",
    inputOutline: "none",
    inputShadow: "none",
    rowBorder: "0px",
    rowOutline: "none",
    rowShadow: "none",
  });
  await page.getByRole("button", { name: /粉笔导入/ }).click();
  const detailBounds = await page.getByRole("complementary", { name: "粉笔导入 详情" }).evaluate((detail) => {
    const rect = detail.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      clientWidth: detail.clientWidth,
      scrollWidth: detail.scrollWidth,
      overflowY: getComputedStyle(detail).overflowY,
    };
  });
  expect(detailBounds.bottom).toBeLessThanOrEqual(detailBounds.viewportHeight + 1);
  expect(detailBounds.scrollWidth).toBe(detailBounds.clientWidth);
  expect(detailBounds.overflowY).toBe("auto");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
