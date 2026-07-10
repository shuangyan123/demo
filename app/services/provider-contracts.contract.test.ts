import assert from "node:assert/strict";
import test from "node:test";
import { creatableProviderContracts, getProviderModelCatalog, getProviderModels } from "./provider-contracts.ts";

test("provider catalog exposes expanded vendors and capability-scoped models", () => {
  const providers = creatableProviderContracts.map((contract) => contract.provider);
  for (const provider of ["openai", "anthropic", "google", "deepseek", "qwen", "openrouter", "groq", "mistral", "siliconflow", "doubao", "baidu", "tencent", "custom"] as const) {
    assert.equal(providers.includes(provider), true, provider);
  }
  assert.equal(getProviderModels("openai", "text").includes("gpt-5.5"), true);
  assert.equal(getProviderModels("google", "vision").includes("gemini-3.5-flash"), true);
  assert.equal(getProviderModels("qwen", "speech").includes("qwen-tts"), true);
  assert.equal(getProviderModelCatalog("deepseek", "text").some((model) => model.source === "official"), true);
  assert.equal(getProviderModelCatalog("openrouter", "text").some((model) => model.status === "manual"), true);
});
