import assert from "node:assert/strict";
import test from "node:test";
import { getQuotaProviderAdapter } from "./quota-adapters.ts";
import type { AiQuotaCredentialKey } from "../../types/domains/ai-quota.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";

const enabled = process.env.RUN_LIVE_QUOTA_TESTS === "1";
const cases: Array<{ provider: ApiProvider; env: string; key: AiQuotaCredentialKey; teamEnv?: string }> = [
  { provider: "openai", env: "OPENAI_ADMIN_KEY", key: "adminKey" },
  { provider: "anthropic", env: "ANTHROPIC_ADMIN_KEY", key: "adminKey" },
  { provider: "deepseek", env: "DEEPSEEK_API_KEY", key: "apiKey" },
  { provider: "xai", env: "XAI_MANAGEMENT_API_KEY", key: "managementKey", teamEnv: "XAI_TEAM_ID" },
];

for (const item of cases) {
  test(`live quota smoke: ${item.provider}`, { skip: !enabled || !process.env[item.env] }, async () => {
    const credentials: Partial<Record<AiQuotaCredentialKey, string>> = { [item.key]: process.env[item.env] };
    if (item.teamEnv && process.env[item.teamEnv]) credentials.teamId = process.env[item.teamEnv];
    const adapter = getQuotaProviderAdapter(item.provider);
    assert.ok(adapter);
    const verification = await adapter.validate({ provider: item.provider, credentials });
    assert.equal(verification.valid, true);
    const snapshot = await adapter.refresh({ provider: item.provider, credentials });
    assert.equal(snapshot.status, "ready");
    assert.ok(snapshot.metrics?.length);
  });
}
