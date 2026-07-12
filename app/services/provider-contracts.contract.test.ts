import assert from "node:assert/strict";
import test from "node:test";
import { creatableProviderContracts, getProviderModelCatalog, getProviderModels, providerContracts } from "./provider-contracts.ts";
import { getVoiceProviderDescriptor } from "./voice-provider-descriptors.ts";

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
  assert.deepEqual(getProviderModels("openai", "speech"), ["tts-1-hd", "tts-1"]);
  assert.equal(getProviderModels("openai", "realtime").includes("gpt-realtime-2.1"), true);
  assert.equal(getProviderModels("google", "realtime").length, 2);
  assert.equal(getProviderModels("zhipu", "transcription").includes("glm-asr-2512"), true);
  assert.equal(getProviderModels("zhipu", "realtime").includes("glm-realtime"), true);
  assert.equal(getProviderModelCatalog("deepseek", "text").every((model) => model.lifecycle !== "deprecated"), true);
  assert.equal(getProviderModelCatalog("zhipu", "vision").every((model) => Boolean(model.family && model.generation && model.modalityGroup)), true);
});

test("语音 descriptor 只声明各厂商支持的字段和官方音色", () => {
  assert.equal(getVoiceProviderDescriptor("google")?.voices.length, 30);
  assert.equal(getVoiceProviderDescriptor("google")?.supports.pitch, false);
  assert.equal(getVoiceProviderDescriptor("minimax")?.supports.pitch, true);
  assert.equal(getVoiceProviderDescriptor("zhipu")?.supports.volume, true);
  assert.deepEqual(getVoiceProviderDescriptor("openai")?.models, ["tts-1-hd", "tts-1"]);
});
