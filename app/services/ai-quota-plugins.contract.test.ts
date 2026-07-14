import assert from "node:assert/strict";
import test from "node:test";
import { aiQuotaProviderPlugins, normalizeOpenAiCostsSnapshot } from "./ai-quota-plugins.ts";

test("额度插件把 OpenAI 官方费用响应归一化且不伪造官方余额", () => {
  const snapshot = normalizeOpenAiCostsSnapshot({
    data: [
      { results: [{ amount: { value: 3.25, currency: "usd" } }] },
      { results: [{ amount: { value: 1.75, currency: "usd" } }] },
    ],
  }, { monthlyBudget: 10, refreshedAt: "2026-07-05T00:00:00.000Z" });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.usedAmount, 5);
  assert.equal(snapshot.remainingAmount, 5);
  assert.equal(snapshot.officialRemainingAvailable, false);
  assert.equal(snapshot.sourceLabel, "OpenAI Admin Costs API");
  assert.equal(snapshot.periodLabel, "本月");
  assert.equal(snapshot.usageRatio, 0.5);
  assert.match(snapshot.message, /月预算估算/);
});

test("四家官方额度适配与三家手动厂商边界明确", () => {
  const official = aiQuotaProviderPlugins.filter((plugin) => ["openai", "anthropic", "deepseek", "xai"].includes(plugin.id));
  const unsupported = aiQuotaProviderPlugins.filter((plugin) => ["google", "minimax", "zhipu"].includes(plugin.id));
  assert.equal(official.every((plugin) => plugin.supportsOfficialRefresh && plugin.refreshStrategy === "official_api"), true);
  assert.equal(unsupported.every((plugin) => !plugin.supportsOfficialRefresh && plugin.refreshStrategy === "unsupported"), true);
  assert.equal(unsupported.every((plugin) => plugin.describeUnsupported?.includes("不抓取网页后台")), true);
  assert.equal(unsupported.every((plugin) => plugin.descriptor.sourceModes.includes("manual")), true);
  assert.deepEqual(aiQuotaProviderPlugins.map((plugin) => plugin.id), ["openai", "deepseek", "google", "anthropic", "xai", "minimax", "zhipu", "manual"]);
  assert.equal(unsupported.some((plugin) => ["qwen", "doubao", "siliconflow"].includes(plugin.id)), false);
});

test("额度厂商使用本地图形资产或经许可审计的文字标记", async () => {
  const { getProviderBranding } = await import("./provider-branding.ts");
  for (const plugin of aiQuotaProviderPlugins.filter((item) => item.id !== "manual")) {
    const branding = getProviderBranding(plugin.provider);
    if (branding.iconPath) {
      assert.match(branding.iconPath, /^\/(?:provider|plugin)-icons\/.+\.svg$/);
      assert.doesNotMatch(branding.iconPath, /generic/);
    } else {
      assert.ok(branding.mark.length > 0);
    }
    assert.match(branding.sourceUrl, /^https:\/\//);
    assert.match(branding.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(branding.licenseNote.length > 0);
  }
});

test("额度插件声明 CodexBar 风格 descriptor 与刷新策略", () => {
  const openai = aiQuotaProviderPlugins.find((plugin) => plugin.id === "openai");
  assert.equal(openai?.descriptor.dashboardUrl, "https://platform.openai.com/usage");
  assert.equal(openai?.descriptor.sourceModes.includes("official_api"), true);
  assert.equal(openai?.fetchStrategies.some((strategy) => strategy.id === "openai.admin-costs"), true);
  assert.match(openai?.statusUrl ?? "", /status.openai.com/);
});
