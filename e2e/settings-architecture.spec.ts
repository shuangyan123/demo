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
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByRole("switch", { name: "浅色主题弥散渐变" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("settings-appearance-dark-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.getByRole("switch", { name: "浅色主题弥散渐变" })).toHaveAttribute("aria-checked", "true");

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
  await page.getByRole("button", { name: "个性化" }).click();
  await expect(page.getByRole("heading", { name: "个性化" })).toBeVisible();
  await page.getByRole("button", { name: "额度" }).click();
  await expect(page.getByRole("heading", { name: "额度与用量" })).toBeVisible();
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
  const card = page.locator("details").filter({ hasText: "DeepSeek" });
  await card.locator("summary").click();
  await card.getByRole("switch", { name: "DeepSeek额度刷新" }).check();
  await card.getByLabel("DeepSeek API Key").fill("test-key-not-real");
  await card.getByRole("button", { name: "保存" }).click();
  await card.getByRole("button", { name: "测试凭据" }).click();
  await expect(page.getByText("额度凭据验证通过", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "刷新额度" }).click();
  await expect(card).toContainText("CNY 1.00");
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
