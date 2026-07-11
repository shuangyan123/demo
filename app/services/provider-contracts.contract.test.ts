import assert from "node:assert/strict";
import test from "node:test";
import { creatableProviderContracts, getProviderModelCatalog, getProviderModels, providerContracts } from "./provider-contracts.ts";

test("新建连接只暴露七家活跃厂商与高级自定义入口", () => {
  const providers = creatableProviderContracts.map((contract) => contract.provider);
  assert.deepEqual(providers, ["openai", "google", "anthropic", "xai", "deepseek", "zhipu", "minimax", "custom"]);
  for (const provider of ["qwen", "openrouter", "groq", "mistral", "siliconflow", "doubao", "baidu", "tencent"] as const) {
    const legacy = providerContracts.find((contract) => contract.provider === provider);
    assert.equal(legacy?.availability, "legacy", provider);
    assert.equal(legacy?.creatable, false, provider);
  }
});

test("模型目录按能力暴露生命周期与最近模型家族", () => {
  assert.equal(getProviderModels("openai", "text").includes("gpt-5.5"), true);
  assert.equal(getProviderModels("google", "vision").includes("gemini-3.5-flash"), true);
  assert.equal(getProviderModels("minimax", "speech").includes("speech-2.8-hd"), true);
  assert.equal(getProviderModelCatalog("deepseek", "text").every((model) => model.lifecycle !== "deprecated"), true);
  assert.equal(getProviderModelCatalog("zhipu", "vision").every((model) => Boolean(model.family && model.generation && model.modalityGroup)), true);
});
