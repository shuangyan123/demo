import { expect, test } from "@playwright/test";
import { collectRuntimeErrors, expectNoFrameworkOverlay, expectNoRuntimeErrors } from "./helpers/runtime-errors";

/** 390×844 下验证额度搜索、独立触控操作与按需精确说明层。 */
test("移动端额度卡片无横向溢出且精确值只在触屏说明层出现", async ({ page }, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.route("**/api/ai/quota", async (route) => {
    const body = route.request().postDataJSON() as { action?: string; provider?: string };
    if (body.action === "validate") {
      await route.fulfill({ json: { valid: true, provider: body.provider, message: "额度凭据验证通过" } });
      return;
    }
    await route.fulfill({
      json: {
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
      },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("button", { name: "额度", exact: true }).click();
  const quotaPanel = page.getByRole("region", { name: "AI 额度与用量" });
  const quotaSearch = quotaPanel.getByRole("searchbox", { name: "搜索厂商、状态或来源" });

  await quotaSearch.fill("OpenRouter");
  await expect(quotaPanel.getByText("找到 1 个", { exact: true })).toBeVisible();
  await expect(quotaPanel.getByRole("link", { name: "打开OpenRouter官方额度文档" })).toHaveAttribute("target", "_blank");
  await quotaSearch.fill("");

  await quotaPanel.getByRole("switch", { name: "DeepSeek额度刷新" }).check();
  await quotaPanel.getByRole("button", { name: "配置DeepSeek额度" }).click();
  let dialog = page.getByRole("dialog", { name: "配置 DeepSeek" });
  await dialog.getByLabel("DeepSeek API Key").fill("test-key-not-real");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await quotaPanel.getByRole("button", { name: "配置DeepSeek额度" }).click();
  dialog = page.getByRole("dialog", { name: "配置 DeepSeek" });
  await dialog.getByRole("button", { name: "刷新", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭额度配置" }).click();

  await expect(quotaPanel).not.toContainText("¥1.00");
  const metricRing = quotaPanel.getByRole("button", { name: "查看DeepSeek额度详情" });
  await metricRing.tap();
  await expect(page.getByRole("tooltip")).toContainText("¥1.00");

  const docsBox = await quotaPanel.getByRole("link", { name: "打开DeepSeek官方额度文档" }).boundingBox();
  const refreshBox = await quotaPanel.getByRole("button", { name: "刷新DeepSeek额度" }).boundingBox();
  expect(docsBox?.width).toBeGreaterThanOrEqual(44);
  expect(docsBox?.height).toBeGreaterThanOrEqual(44);
  expect(refreshBox?.width).toBeGreaterThanOrEqual(44);
  expect(refreshBox?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.screenshot({ path: testInfo.outputPath("settings-quota-mobile.png"), fullPage: false });
  await expectNoFrameworkOverlay(page);
  expectNoRuntimeErrors(runtimeErrors);
});
