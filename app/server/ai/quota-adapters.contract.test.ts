import assert from "node:assert/strict";
import test from "node:test";
import { getQuotaProviderAdapter, serializeQuotaError } from "./quota-adapters.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("五家官方额度适配器只调用管理、费用或余额端点", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("management-keys/validation")) return Response.json({ team_id: "team-test" });
    if (url.includes("deepseek.com/user/balance")) return Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "8.00" }] });
    if (url.includes("openrouter.ai/api/v1/credits")) return Response.json({ data: { total_credits: 100, total_usage: 25.5 } });
    return Response.json({ data: [{ amount: { value: 1 } }], input_tokens: 2, balance: 3, cost: 1 });
  }) as typeof fetch;

  await getQuotaProviderAdapter("openai")!.refresh({ provider: "openai", credentials: { adminKey: "test" }, monthlyBudget: 10 });
  await getQuotaProviderAdapter("anthropic")!.refresh({ provider: "anthropic", credentials: { adminKey: "test" } });
  const deepSeek = await getQuotaProviderAdapter("deepseek")!.refresh({ provider: "deepseek", credentials: { apiKey: "test" } });
  const openRouter = await getQuotaProviderAdapter("openrouter")!.refresh({ provider: "openrouter", credentials: { managementKey: "test-management-key" } });
  await getQuotaProviderAdapter("xai")!.refresh({ provider: "xai", credentials: { managementKey: "test" } });

  assert.equal(deepSeek.metrics?.some((metric) => metric.id === "remaining_balance" && metric.source === "official"), true);
  assert.equal(openRouter.remainingAmount, 74.5);
  assert.equal(openRouter.periodLabel, "累计");
  assert.equal(openRouter.sourceLabel, "OpenRouter Credits API");
  assert.equal(requests.some(({ url }) => url.includes("organization/costs")), true);
  assert.equal(requests.some(({ url }) => url.includes("organizations/cost_report")), true);
  assert.equal(requests.some(({ url }) => url.includes("user/balance")), true);
  assert.equal(requests.some(({ url }) => url === "https://openrouter.ai/api/v1/credits"), true);
  assert.equal(requests.some(({ url }) => url.includes("billing/teams/team-test")), true);
  assert.equal(requests.some(({ url }) => /chat|messages$|generate/.test(url)), false);
});

test("OpenRouter 拒绝缺字段响应且不会伪造零余额", async () => {
  globalThis.fetch = (async () => Response.json({ data: { total_credits: 10 } })) as typeof fetch;
  await assert.rejects(
    getQuotaProviderAdapter("openrouter")!.refresh({ provider: "openrouter", credentials: { managementKey: "test-management-key" } }),
    (error) => serializeQuotaError(error).code === "malformed_response",
  );
});

test("额度适配器把鉴权与限流错误归一化", async () => {
  globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
  await assert.rejects(
    getQuotaProviderAdapter("deepseek")!.validate({ provider: "deepseek", credentials: { apiKey: "test" } }),
    (error) => serializeQuotaError(error).code === "insufficient_permission",
  );
});
