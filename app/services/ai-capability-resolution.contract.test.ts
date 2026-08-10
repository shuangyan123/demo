import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectiveCapability, resolveEffectiveModelCapability, resolveModelCapabilityProfile } from "./ai-capability-resolution.ts";
import { getAiModelRuntimeDescriptor, validateAiSelectedRuntimeValues } from "./model-runtime-descriptors.ts";
import { getProviderProtocolCapabilityProfile } from "./provider-protocol-capabilities.ts";

test("七家 native provider 的精确 catalog entry 形成可验证模型能力 fixture", () => {
  const fixtures = [
    ["openai", "gpt-5.5", "vision", "supported"],
    ["google", "gemini-3.5-flash", "vision", "supported"],
    ["anthropic", "claude-opus-4-8", "vision", "supported"],
    ["xai", "grok-4.5", "vision", "supported"],
    ["deepseek", "deepseek-v4-pro", "vision", "unsupported"],
    ["zhipu", "glm-5.2", "vision", "unsupported"],
    ["minimax", "MiniMax-M3", "vision", "supported"],
  ] as const;
  for (const [provider, modelId, capability, expected] of fixtures) {
    const profile = resolveModelCapabilityProfile(provider, modelId);
    assert.equal(profile.source, "verified-catalog", `${provider}:${modelId}`);
    assert.equal(profile.capabilities.text, "supported", `${provider}:${modelId}:text`);
    assert.equal(profile.capabilities[capability], expected, `${provider}:${modelId}:${capability}`);
  }
});

test("未知、熟悉名称与 custom-compatible 模型保持保守事实", () => {
  const unknown = resolveModelCapabilityProfile("openai", "future-vision-reasoning-model");
  assert.equal(unknown.capabilities.text, "supported");
  assert.equal(unknown.capabilities.vision, "unknown");
  assert.equal(unknown.runtime.reasoning, "unknown");
  const custom = resolveModelCapabilityProfile("custom", "gpt-5.5-vision-reasoning");
  assert.equal(custom.capabilities.text, "supported");
  assert.equal(custom.capabilities.vision, "unknown");
  assert.equal(custom.capabilities.structured_output, "unknown");
  assert.equal(custom.runtime.reasoning, "unknown");
});

test("数值事实只来自精确 catalog，未知模型没有默认上限", () => {
  const known = resolveModelCapabilityProfile("minimax", "MiniMax-M3");
  assert.equal(known.contextWindowTokens, 1_000_000);
  assert.equal(known.maxOutputTokens, 524_288);
  const unknown = resolveModelCapabilityProfile("minimax", "MiniMax-M3-custom");
  assert.equal(unknown.contextWindowTokens, undefined);
  assert.equal(unknown.maxOutputTokens, undefined);
});

test("model 与 protocol 能力交集保留稳定且可区分的原因", () => {
  assert.deepEqual(resolveEffectiveCapability("supported", "supported"), {
    support: "supported", reason: "available", modelSupport: "supported", protocolSupport: "supported",
  });
  assert.equal(resolveEffectiveCapability("unsupported", "supported").reason, "model-capability-unsupported");
  assert.equal(resolveEffectiveCapability("supported", "unsupported").reason, "protocol-capability-unsupported");
  assert.equal(resolveEffectiveCapability("unknown", "supported").reason, "model-capability-unknown");
  assert.equal(resolveEffectiveCapability("supported", "unknown").reason, "protocol-capability-unknown");
  const deepSeek = resolveModelCapabilityProfile("deepseek", "deepseek-v4-pro");
  assert.equal(resolveEffectiveModelCapability(deepSeek, "vision").reason, "model-capability-unsupported");
  assert.equal(getProviderProtocolCapabilityProfile("deepseek").capabilities.vision, "unsupported");
});

test("runtime contract 保留合法值并稳定拒绝非法、unsupported 与 unknown", () => {
  const descriptor = getAiModelRuntimeDescriptor("google", "gemini-2.5-pro")!;
  assert.deepEqual(validateAiSelectedRuntimeValues(descriptor, { reasoning: 12000, speed: "priority" }), {
    status: "valid", values: { reasoning: 12000, speed: "priority" },
  });
  assert.deepEqual(validateAiSelectedRuntimeValues(descriptor, { reasoning: 127 }), {
    status: "invalid", code: "invalid-runtime-value", option: "reasoning", requestedValue: 127,
  });
  assert.deepEqual(validateAiSelectedRuntimeValues(getAiModelRuntimeDescriptor("deepseek", "deepseek-v4-pro"), { speed: "priority" }), {
    status: "invalid", code: "runtime-capability-unsupported", option: "speed", requestedValue: "priority",
  });
  assert.deepEqual(validateAiSelectedRuntimeValues(undefined, { reasoning: "high" }), {
    status: "invalid", code: "runtime-capability-unknown", option: "reasoning", requestedValue: "high",
  });
  assert.deepEqual(validateAiSelectedRuntimeValues(descriptor, { reasoning: 12000, speed: "priority" }), validateAiSelectedRuntimeValues(descriptor, { reasoning: 12000, speed: "priority" }));
});
