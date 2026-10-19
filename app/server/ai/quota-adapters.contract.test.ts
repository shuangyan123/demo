import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { outboundTransport } from "../http/outbound-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { getQuotaProviderAdapter, serializeQuotaError } from "./quota-adapters.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("四家官方额度适配器只调用管理、费用或余额端点", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("management-keys/validation")) return Response.json({ team_id: "team-test" });
    if (url.includes("deepseek.com/user/balance")) return Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "8.00" }] });
    return Response.json({ data: [{ amount: { value: 1 } }], input_tokens: 2, balance: 3, cost: 1 });
  }) as typeof fetch;

  await getQuotaProviderAdapter("openai")!.refresh({ provider: "openai", credentials: { adminKey: "test" }, monthlyBudget: 10 });
  await getQuotaProviderAdapter("anthropic")!.refresh({ provider: "anthropic", credentials: { adminKey: "test" } });
  const deepSeek = await getQuotaProviderAdapter("deepseek")!.refresh({ provider: "deepseek", credentials: { apiKey: "test" } });
  await getQuotaProviderAdapter("xai")!.refresh({ provider: "xai", credentials: { managementKey: "test" } });

  assert.equal(deepSeek.metrics?.some((metric) => metric.id === "remaining_balance" && metric.source === "official"), true);
  assert.equal(requests.some(({ url }) => url.includes("organization/costs")), true);
  assert.equal(requests.some(({ url }) => url.includes("organizations/cost_report")), true);
  assert.equal(requests.some(({ url }) => url.includes("user/balance")), true);
  assert.equal(requests.some(({ url }) => url.includes("billing/teams/team-test")), true);
  assert.equal(requests.some(({ url }) => /chat|messages$|generate/.test(url)), false);
});

test("额度适配器把鉴权与限流错误归一化", async () => {
  globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
  await assert.rejects(
    getQuotaProviderAdapter("deepseek")!.validate({ provider: "deepseek", credentials: { apiKey: "test" } }),
    (error) => serializeQuotaError(error).code === "insufficient_permission",
  );
});

// DNS 和 HTTP 成对 mock，未登记主机立即失败，测试不使用真实网络。
test.beforeEach(context => {
  if (!("mock" in context)) throw new Error("fixture requires TestContext");
  context.mock.method(outboundTransport, "fetch", (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  context.mock.method(dns, "lookup", async (hostname: string) => {
    assert.ok(["api.openai.com", "api.anthropic.com", "api.deepseek.com", "api.x.ai", "management-api.x.ai"].includes(hostname), `unexpected fixture host: ${hostname}`);
    return [{ address: "8.8.8.8", family: 4 }];
  });
  syncBuiltinESMExports();
});
test.afterEach(context => { if ("mock" in context) context.mock.restoreAll(); syncBuiltinESMExports(); });
