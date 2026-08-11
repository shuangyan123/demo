import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { AiModelsResult } from "./api-client.ts";
import { resolveEffectiveModelCapability, resolveModelCapabilityProfile } from "./ai-capability-resolution.ts";
import { generateWithConnection, generateWithConnectionStream, resolveConnectionModelCapabilityProfile } from "./ai-connection-client.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import { providerModelCache } from "./provider-model-cache.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "dispatchEvent", { configurable: true, value: () => true });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

function connection(id: string, baseUrl = "https://compatible.example/v1"): ApiConnectionProfile {
  return {
    id,
    label: id,
    provider: "custom",
    apiFormat: "chat_completions",
    baseUrl,
    model: "account-model",
    capabilities: ["text", "vision", "streaming"],
    encryptedKey: "ciphertext",
    iv: "fixture-iv",
    maskedKey: "****",
    providerOptions: {},
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

function directory(
  modelId: string,
  capabilities: AiModelsResult["models"][number]["capabilities"],
  capabilitySource: AiModelsResult["models"][number]["capabilitySource"] = "provider",
  numeric?: { contextWindow?: number; maxOutputTokens?: number },
): AiModelsResult {
  return {
    fetchedAt: "2026-08-10T00:00:00.000Z",
    models: [{
      id: modelId,
      label: modelId,
      purposes: capabilities.includes("vision") ? ["text", "vision"] : ["text"],
      capabilities,
      status: "active",
      source: "official_api",
      capabilitySource,
      contextWindow: numeric?.contextWindow,
      maxOutputTokens: numeric?.maxOutputTokens,
      supportsStreaming: capabilities.includes("streaming"),
      supportsStructuredOutput: capabilities.includes("structured_output"),
      updatedAt: "2026-08-10T00:00:00.000Z",
    }],
  };
}

test("cache absent 时 connection resolver 等价于静态模型 resolver", () => {
  values.clear();
  const profile = { ...connection("known"), provider: "deepseek" as const };
  assert.deepEqual(
    resolveConnectionModelCapabilityProfile(profile, "deepseek-v4-pro"),
    resolveModelCapabilityProfile("deepseek", "deepseek-v4-pro"),
  );
});

test("可信 discovered capability 与数值事实沿 connection resolver 一致传播", () => {
  values.clear();
  const profile = connection("trusted");
  providerModelCache.save(profile.id, profile.provider, profile.baseUrl, directory(
    "account-model",
    ["text", "streaming"],
    "provider",
    { contextWindow: 196_608, maxOutputTokens: 8_192 },
  ));

  const base = resolveModelCapabilityProfile(profile.provider, "account-model");
  const resolved = resolveConnectionModelCapabilityProfile(profile, "account-model");
  assert.equal(base.capabilities.streaming, "unknown");
  assert.equal(resolved.source, "provider-metadata");
  assert.equal(resolved.capabilities.streaming, "supported");
  assert.equal(resolved.contextWindowTokens, 196_608);
  assert.equal(resolved.maxOutputTokens, 8_192);
  assert.equal(resolveEffectiveModelCapability(resolved, "streaming").support, "supported");
});

test("熟悉模型名和未受信目录元数据不会提升可选能力或数值上限", () => {
  values.clear();
  const profile = connection("untrusted");
  const modelId = "gpt-vision-streaming-999";
  providerModelCache.save(profile.id, profile.provider, profile.baseUrl, directory(
    modelId,
    ["text", "vision", "streaming"],
    "unknown",
    { contextWindow: 999_999, maxOutputTokens: 99_999 },
  ));
  const resolved = resolveConnectionModelCapabilityProfile(profile, modelId);
  assert.equal(resolved.capabilities.text, "supported");
  assert.equal(resolved.capabilities.vision, "unknown");
  assert.equal(resolved.capabilities.streaming, "unknown");
  assert.equal(resolved.contextWindowTokens, undefined);
  assert.equal(resolved.maxOutputTokens, undefined);
  assert.equal(resolveEffectiveModelCapability(resolved, "streaming").support, "unknown");
});

test("cache 继续按 connection、provider 与 base URL 隔离", () => {
  values.clear();
  const connectionA = connection("connection-a");
  const connectionB = connection("connection-b");
  providerModelCache.save(connectionA.id, connectionA.provider, connectionA.baseUrl, directory("shared-model", ["text", "streaming"]));
  assert.equal(resolveConnectionModelCapabilityProfile(connectionA, "shared-model").capabilities.streaming, "supported");
  assert.equal(resolveConnectionModelCapabilityProfile(connectionB, "shared-model").capabilities.streaming, "unknown");
  assert.equal(resolveConnectionModelCapabilityProfile(connection("connection-a", "https://other.example/v1"), "shared-model").capabilities.streaming, "unknown");
});

test("verified static catalog 保持高于冲突的 provider metadata", () => {
  values.clear();
  const profile = { ...connection("verified"), provider: "deepseek" as const };
  providerModelCache.save(profile.id, profile.provider, profile.baseUrl, directory("deepseek-v4-pro", ["text", "vision", "streaming"]));
  const resolved = resolveConnectionModelCapabilityProfile(profile, "deepseek-v4-pro");
  assert.equal(resolved.source, "verified-catalog");
  assert.equal(resolved.capabilities.vision, "unsupported");
});

test("Conversation 流式预路由与 generation contract 对同一缓存事实结论一致", async () => {
  values.clear();
  const profile = connection("streaming-consistency");
  providerModelCache.save(profile.id, profile.provider, profile.baseUrl, directory("account-model", ["text", "streaming"]));
  assert.equal(resolveEffectiveModelCapability(resolveConnectionModelCapabilityProfile(profile, "account-model"), "streaming").support, "supported");

  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let secretReads = 0;
  aiConnectionsRepository.resolveSecret = async () => {
    secretReads += 1;
    return "fixture-secret";
  };
  globalThis.fetch = async () => new Response('data: {"type":"delta","text":"ok"}\n\ndata: {"type":"done","content":"ok"}\n\n', {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
  try {
    const events = [];
    for await (const event of generateWithConnectionStream(profile, "text", {
      modelId: "account-model",
      messages: [{ role: "user", content: "测试" }],
    })) events.push(event);
    assert.deepEqual(events, [{ type: "delta", text: "ok" }, { type: "done", content: "ok" }]);
    assert.equal(secretReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});

test("可信 discovered vision 同时通过 resolver 与 generation guard", async () => {
  values.clear();
  const profile = connection("vision-consistency");
  providerModelCache.save(profile.id, profile.provider, profile.baseUrl, directory("vision-model", ["text", "vision"]));
  assert.equal(resolveConnectionModelCapabilityProfile(profile, "vision-model").capabilities.vision, "supported");

  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  aiConnectionsRepository.resolveSecret = async () => "fixture-secret";
  globalThis.fetch = async () => Response.json({ content: "ok" });
  try {
    const result = await generateWithConnection(profile, "vision", {
      modelId: "vision-model",
      messages: [{ role: "user", content: "分析图片" }],
    });
    assert.equal(result.content, "ok");
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});
