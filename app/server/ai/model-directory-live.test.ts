import assert from "node:assert/strict";
import test from "node:test";
import { fetchProviderModelDirectory } from "./model-directory.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";

const enabled = process.env.RUN_LIVE_MODEL_CATALOG_TESTS === "1";

const fixtures: Array<{ provider: ApiProvider; key?: string; baseUrl: string; providerOptions?: Record<string, string> }> = [
  { provider: "google", key: process.env.GEMINI_API_KEY, baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { provider: "minimax", key: process.env.MINIMAX_API_KEY, baseUrl: process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/anthropic", providerOptions: { region: process.env.MINIMAX_REGION === "global" ? "global" : "cn" } },
  { provider: "qwen", key: process.env.QWEN_API_KEY, baseUrl: process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { provider: "openrouter", key: process.env.OPENROUTER_API_KEY, baseUrl: "https://openrouter.ai/api/v1" },
  { provider: "groq", key: process.env.GROQ_API_KEY, baseUrl: "https://api.groq.com/openai/v1" },
  { provider: "mistral", key: process.env.MISTRAL_API_KEY, baseUrl: "https://api.mistral.ai/v1" },
  { provider: "siliconflow", key: process.env.SILICONFLOW_API_KEY, baseUrl: "https://api.siliconflow.cn/v1" },
  { provider: "kimi", key: process.env.KIMI_API_KEY, baseUrl: "https://api.moonshot.cn/v1" },
];

/**
 * 真实目录 smoke 只执行官方只读模型列表，不输出密钥、模型清单或数量。
 */
for (const fixture of fixtures) {
  test(`live ${fixture.provider} model catalog smoke`, { skip: !enabled || !fixture.key }, async () => {
    const result = await fetchProviderModelDirectory({
      provider: fixture.provider,
      apiKey: fixture.key!,
      baseUrl: fixture.baseUrl,
      ...(fixture.providerOptions ? { providerOptions: fixture.providerOptions } : {}),
    });
    assert.equal(result.complete, true);
    assert.ok(result.models.length > 0);
  });
}
