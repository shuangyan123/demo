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

test("非官方实时额度厂商保持插件预留状态", () => {
  const unsupported = aiQuotaProviderPlugins.filter((plugin) => plugin.id !== "openai" && plugin.id !== "manual");
  assert.ok(unsupported.length >= 6);
  assert.equal(unsupported.every((plugin) => !plugin.supportsOfficialRefresh), true);
  assert.equal(unsupported.every((plugin) => plugin.refreshStrategy === "unsupported"), true);
  assert.equal(unsupported.every((plugin) => plugin.describeUnsupported?.includes("不抓取网页后台")), true);
  assert.equal(unsupported.every((plugin) => plugin.descriptor.sourceModes.includes("manual")), true);
  assert.deepEqual(aiQuotaProviderPlugins.map((plugin) => plugin.id), ["openai", "deepseek", "google", "anthropic", "xai", "minimax", "zhipu", "manual"]);
  assert.equal(unsupported.some((plugin) => ["qwen", "doubao", "siliconflow"].includes(plugin.id)), false);
});

test("额度白名单厂商都使用本地品牌 SVG", async () => {
  const { getProviderBranding } = await import("./provider-branding.ts");
  for (const plugin of aiQuotaProviderPlugins.filter((item) => item.id !== "manual")) {
    const branding = getProviderBranding(plugin.provider);
    assert.match(branding.iconPath, /^\/(?:provider|plugin)-icons\/.+\.svg$/);
    assert.doesNotMatch(branding.iconPath, /generic/);
  }
});

test("额度插件声明 CodexBar 风格 descriptor 与刷新策略", () => {
  const openai = aiQuotaProviderPlugins.find((plugin) => plugin.id === "openai");
  assert.equal(openai?.descriptor.dashboardUrl, "https://platform.openai.com/usage");
  assert.equal(openai?.descriptor.sourceModes.includes("official_api"), true);
  assert.equal(openai?.fetchStrategies.some((strategy) => strategy.id === "openai.admin-costs"), true);
  assert.match(openai?.statusUrl ?? "", /status.openai.com/);
});
