import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

test("五家官方额度适配与七家控制台厂商边界明确", () => {
  const official = aiQuotaProviderPlugins.filter((plugin) => ["openai", "anthropic", "deepseek", "xai", "openrouter"].includes(plugin.id));
  const unsupported = aiQuotaProviderPlugins.filter((plugin) => ["google", "minimax", "zhipu", "qwen", "kimi", "doubao", "siliconflow"].includes(plugin.id));
  assert.equal(official.every((plugin) => plugin.supportsOfficialRefresh && plugin.refreshStrategy === "official_api"), true);
  assert.equal(unsupported.every((plugin) => !plugin.supportsOfficialRefresh && plugin.refreshStrategy === "unsupported"), true);
  assert.equal(unsupported.every((plugin) => plugin.describeUnsupported?.includes("不抓取网页后台")), true);
  assert.equal(unsupported.every((plugin) => plugin.descriptor.sourceModes.includes("manual")), true);
  assert.deepEqual(aiQuotaProviderPlugins.map((plugin) => plugin.id), [
    "openai", "deepseek", "google", "anthropic", "xai", "minimax", "zhipu",
    "openrouter", "qwen", "kimi", "doubao", "siliconflow", "manual",
  ]);
  assert.equal(aiQuotaProviderPlugins.length, 13);
  assert.equal(aiQuotaProviderPlugins.find((plugin) => plugin.id === "openrouter")?.credentialFields[0]?.key, "managementKey");
  assert.equal(unsupported.every((plugin) => plugin.credentialFields.length === 0), true);
});

test("额度厂商使用本地图形资产或经许可审计的文字标记", async () => {
  const { getProviderBranding } = await import("./provider-branding.ts");
  for (const plugin of aiQuotaProviderPlugins.filter((item) => item.id !== "manual")) {
    const branding = getProviderBranding(plugin.provider);
    if (branding.iconPath) {
      assert.match(branding.iconPath, /^\/(?:provider|plugin)-icons\/.+\.svg$/);
      assert.doesNotMatch(branding.iconPath, /generic/);
      assert.match(branding.assetSourceUrl ?? "", /^https:\/\//);
      assert.match(branding.assetChecksum ?? "", /^[a-f0-9]{64}$/);
      const asset = await readFile(new URL(`../../public${branding.iconPath}`, import.meta.url));
      assert.equal(createHash("sha256").update(asset).digest("hex"), branding.assetChecksum, plugin.provider);
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
  const openRouter = aiQuotaProviderPlugins.find((plugin) => plugin.id === "openrouter");
  assert.match(openRouter?.documentationUrl ?? "", /credits\/get-credits/);
  assert.equal(openRouter?.fetchStrategies.some((strategy) => strategy.kind === "official_api"), true);
});

test("Claude 统一使用固定版本的彩色品牌资产", async () => {
  const { getProviderBranding } = await import("./provider-branding.ts");
  const branding = getProviderBranding("anthropic");
  assert.equal(branding.iconPath, "/provider-icons/lobe/claude-color.svg");
  assert.equal(branding.themeVariant, "single");
  assert.equal(branding.assetChecksum, "d4366130584b1027bbc376e3c06a48500d6e862403a69556726d7722610e5561");
});
