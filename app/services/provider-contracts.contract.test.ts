import assert from "node:assert/strict";
import test from "node:test";
import { creatableProviderContracts, getProviderModelCatalog, getProviderModels, providerContracts } from "./provider-contracts.ts";
import { getVoiceProviderDescriptor } from "./voice-provider-descriptors.ts";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues, resolveRuntimeModelId } from "./model-runtime-descriptors.ts";
import { resolveModelCapabilityProfile } from "./ai-capability-resolution.ts";

test("新建连接暴露七家原生、六家兼容厂商与高级自定义入口", () => {
  const providers = creatableProviderContracts.map((contract) => contract.provider);
  assert.deepEqual(providers, ["openai", "google", "anthropic", "xai", "deepseek", "qwen", "openrouter", "groq", "mistral", "siliconflow", "kimi", "zhipu", "minimax", "custom"]);
  for (const provider of ["qwen", "openrouter", "groq", "mistral", "siliconflow", "kimi"] as const) {
    const compatible = providerContracts.find((contract) => contract.provider === provider);
    assert.equal(compatible?.supportLevel, "compatible", provider);
    assert.equal(compatible?.modelListStrategy, "official_api", provider);
    assert.equal(compatible?.creatable, true, provider);
  }
  for (const provider of ["doubao", "baidu", "tencent"] as const) {
    const legacy = providerContracts.find((contract) => contract.provider === provider);
    assert.equal(legacy?.availability, "legacy", provider);
    assert.equal(legacy?.supportLevel, "legacy", provider);
    assert.equal(legacy?.creatable, false, provider);
  }
});

test("模型目录按能力暴露生命周期与最近模型家族", () => {
  assert.equal(getProviderModels("openai", "text").includes("gpt-5.5"), true);
  assert.equal(getProviderModels("google", "vision").includes("gemini-3.5-flash"), true);
  assert.equal(getProviderModels("minimax", "speech").includes("speech-2.8-hd"), true);
  assert.equal(getProviderModels("minimax", "text")[0], "MiniMax-M3");
  assert.equal(getProviderModels("minimax", "vision").includes("MiniMax-M3"), true);
  const minimaxM3Catalog = getProviderModelCatalog("minimax").find((model) => model.id === "MiniMax-M3");
  assert.deepEqual(minimaxM3Catalog?.capabilities.slice(0, 4), ["text", "vision", "video", "tools"]);
  assert.equal(minimaxM3Catalog?.contextWindow, 1_000_000);
  assert.equal(getProviderModelCatalog("minimax").find((model) => model.id === "MiniMax-M2.7")?.capabilities.includes("vision"), false);
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

test("模型级运行 descriptor 覆盖七家厂商并拒绝推断未知模型", () => {
  const cases = [
    ["openai", "gpt-5.5", "effort", "service_tier"],
    ["google", "gemini-3.5-flash", "effort", "service_tier"],
    ["anthropic", "claude-opus-4-8", "adaptive", "fast_mode"],
    ["deepseek", "deepseek-v4-pro", "effort", undefined],
    ["zhipu", "glm-5.2", "effort", undefined],
    ["minimax", "MiniMax-M3", "adaptive", "service_tier"],
    ["xai", "grok-4.5", "effort", "service_tier"],
  ] as const;
  for (const [provider, modelId, reasoningKind, speedKind] of cases) {
    const descriptor = getAiModelRuntimeDescriptor(provider, modelId);
    assert.equal(descriptor?.reasoning?.kind, reasoningKind, `${provider}:${modelId}`);
    assert.equal(descriptor?.speed?.kind, speedKind, `${provider}:${modelId}`);
    assert.match(descriptor?.documentationUrl ?? "", /^https:\/\//);
    assert.equal(descriptor?.verifiedAt, "2026-07-15");
  }
  assert.equal(getAiModelRuntimeDescriptor("openai", "user-manual-model"), undefined);
});

test("预算型 descriptor 保留哨兵值与范围内整数，并对非法值回退默认值", () => {
  const pro = getAiModelRuntimeDescriptor("google", "gemini-2.5-pro")!;
  if (pro.reasoning?.kind !== "budget") assert.fail("Gemini 2.5 Pro 应声明预算型推理");
  assert.deepEqual(pro.reasoning.customRange, { min: 128, max: 32768 });
  assert.equal(normalizeAiSelectedRuntimeValues(pro, { reasoning: -1 }).reasoning, -1);
  assert.equal(normalizeAiSelectedRuntimeValues(pro, { reasoning: 12000 }).reasoning, 12000);
  assert.equal(normalizeAiSelectedRuntimeValues(pro, { reasoning: 32768 }).reasoning, 32768);
  assert.equal(normalizeAiSelectedRuntimeValues(pro, { reasoning: 127 }).reasoning, -1);
  assert.equal(normalizeAiSelectedRuntimeValues(pro, { reasoning: 32769 }).reasoning, -1);
  assert.equal(normalizeAiSelectedRuntimeValues(pro, { reasoning: 128.5 }).reasoning, -1);

  const flash = getAiModelRuntimeDescriptor("google", "gemini-2.5-flash")!;
  if (flash.reasoning?.kind !== "budget") assert.fail("Gemini 2.5 Flash 应声明预算型推理");
  assert.deepEqual(flash.reasoning.customRange, { min: 0, max: 24576 });
  assert.equal(normalizeAiSelectedRuntimeValues(flash, { reasoning: 0 }).reasoning, 0);
  assert.equal(normalizeAiSelectedRuntimeValues(flash, { reasoning: 12345 }).reasoning, 12345);

  const flashLite = getAiModelRuntimeDescriptor("google", "gemini-2.5-flash-lite")!;
  if (flashLite.reasoning?.kind !== "budget") assert.fail("Gemini 2.5 Flash Lite 应声明预算型推理");
  assert.deepEqual(flashLite.reasoning.customRange, { min: 512, max: 24576 });
  assert.equal(normalizeAiSelectedRuntimeValues(flashLite, { reasoning: -1 }).reasoning, -1);
  assert.equal(normalizeAiSelectedRuntimeValues(flashLite, { reasoning: 0 }).reasoning, 0);
  assert.equal(normalizeAiSelectedRuntimeValues(flashLite, { reasoning: 512 }).reasoning, 512);
  assert.equal(normalizeAiSelectedRuntimeValues(flashLite, { reasoning: 511 }).reasoning, 0);

  const claude = getAiModelRuntimeDescriptor("anthropic", "claude-haiku-4-5")!;
  if (claude.reasoning?.kind !== "budget") assert.fail("Claude Haiku 4.5 应声明预算型推理");
  assert.deepEqual(claude.reasoning.customRange, { min: 1024, max: 32000 });
  assert.equal(claude.reasoning.defaultValue, 1024);
  assert.equal(normalizeAiSelectedRuntimeValues(claude, { reasoning: 12000 }).reasoning, 12000);
  assert.equal(normalizeAiSelectedRuntimeValues(claude, { reasoning: 1023 }).reasoning, 1024);
});

test("GLM 七档、非法旧值回退与 MiniMax 配对高速模型保持明确契约", () => {
  const glm = getAiModelRuntimeDescriptor("zhipu", "glm-5.2")!;
  assert.deepEqual(glm.reasoning?.options.map((option) => option.value), ["max", "xhigh", "high", "medium", "low", "minimal", "none"]);
  assert.equal(glm.reasoning?.defaultValue, "max");
  assert.deepEqual(normalizeAiSelectedRuntimeValues(glm, { reasoning: "invalid" }), { reasoning: "max" });
  for (const modelId of ["glm-5.1", "glm-5", "glm-5-turbo", "glm-5v-turbo", "glm-4.7", "glm-4.6", "glm-4.6v", "glm-4.5", "glm-4.5v"]) {
    assert.equal(getAiModelRuntimeDescriptor("zhipu", modelId)?.reasoning?.kind, "toggle", modelId);
  }
  for (const modelId of ["glm-999", "glm-5.2-custom", "glm-6", "glm-4.8"]) {
    assert.equal(getAiModelRuntimeDescriptor("zhipu", modelId), undefined, modelId);
  }

  const minimax = getAiModelRuntimeDescriptor("minimax", "MiniMax-M2.7")!;
  assert.equal(resolveRuntimeModelId(minimax, "MiniMax-M2.7", { speed: "highspeed" }), "MiniMax-M2.7-highspeed");
  assert.equal(resolveRuntimeModelId(minimax, "MiniMax-M2.7-highspeed", { speed: "standard" }), "MiniMax-M2.7");
  const minimaxM3 = getAiModelRuntimeDescriptor("minimax", "MiniMax-M3")!;
  const minimaxM3Facts = resolveModelCapabilityProfile("minimax", "MiniMax-M3");
  assert.equal(minimaxM3Facts.capabilities.vision, "supported");
  assert.equal(minimaxM3Facts.capabilities.video, "supported");
  assert.equal(minimaxM3Facts.capabilities.tools, "supported");
  assert.equal(minimaxM3Facts.contextWindowTokens, 1_000_000);
  assert.equal(minimaxM3.reasoning?.defaultValue, "disabled");
  assert.deepEqual(minimaxM3.speed?.options.map((option) => option.value), ["standard", "priority"]);
});
