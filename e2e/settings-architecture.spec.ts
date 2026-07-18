import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

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
  const workspaceDiffuse = await page.locator(".chrome-content").evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(workspaceDiffuse).toContain("radial-gradient");
  const topbarDiffuse = await page.locator(".chrome-topbar").evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(topbarDiffuse).toContain("radial-gradient");
  const codeFontFamilies = await page.locator(".settings-code-preview, .settings-input.font-mono").evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).fontFamily),
  );
  expect(codeFontFamilies.length).toBeGreaterThan(1);
  const primaryCodeFontFamilies = codeFontFamilies.map((family) => family.split(",")[0].replaceAll('"', "").trim());
  expect(new Set(primaryCodeFontFamilies)).toEqual(new Set(["GeistMono"]));
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
