import assert from "node:assert/strict";
import test from "node:test";
import { creatableProviderContracts, getProviderModelCatalog, getProviderModels, providerContracts } from "./provider-contracts.ts";
import { getVoiceProviderDescriptor } from "./voice-provider-descriptors.ts";
import { getModelReasoningDescriptor, reasoningProviderOptions } from "./model-reasoning.ts";

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
  assert.equal(getProviderModels("minimax", "text")[0], "MiniMax-M3");
  assert.equal(getProviderModels("minimax", "vision").includes("MiniMax-M3"), true);
  assert.equal(getProviderModels("minimax", "text").includes("MiniMax-M2.5"), false);
  assert.equal(getProviderModels("zhipu", "text")[0], "glm-5.2");
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

test("推理强度按厂商和模型映射且 MiniMax M3 不虚构档位", () => {
  assert.equal(reasoningProviderOptions("openai", "gpt-5.6-sol", "high").reasoningEffort, "high");
  assert.equal(reasoningProviderOptions("google", "gemini-3.5-flash", "minimal").thinkingLevel, "minimal");
  assert.equal(reasoningProviderOptions("deepseek", "deepseek-v4-pro", "disabled").thinking, "disabled");
  assert.equal(getModelReasoningDescriptor("minimax", "MiniMax-M3")?.readOnly, true);
  assert.deepEqual(reasoningProviderOptions("minimax", "MiniMax-M3", "auto"), {});
});
