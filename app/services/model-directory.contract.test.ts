import assert from "node:assert/strict";
import test from "node:test";
import type { AiModelsResult } from "./api-client.ts";
import { getCachedConnectionModelCatalog } from "./model-directory-service.ts";
import { normalizeProviderBaseUrl, PROVIDER_MODEL_CACHE_TTL, providerModelCache } from "./provider-model-cache.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  },
});

function directory(fetchedAt = new Date().toISOString()): AiModelsResult {
  return {
    fetchedAt,
    models: [{
      id: "account-model",
      label: "Account Model",
      purposes: ["text"],
      capabilities: ["text", "streaming"],
      status: "active",
      source: "official_api",
      capabilitySource: "provider",
      supportsStreaming: true,
      supportsStructuredOutput: false,
      updatedAt: "2026-07-13T00:00:00.000Z",
    }],
  };
}

function profile(id: string, baseUrl = "https://api.openai.com/v1/"): ApiConnectionProfile {
  return {
    id,
    label: id,
    provider: "openai",
    apiFormat: "responses",
    baseUrl,
    capabilities: ["text"],
    encryptedKey: "ciphertext",
    iv: "iv",
    maskedKey: "****",
    providerOptions: {},
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

test("模型目录缓存按连接、厂商与规范化 Base URL 隔离", () => {
  values.clear();
  providerModelCache.save("connection-a", "openai", "https://api.openai.com/v1/", directory());
  assert.equal(providerModelCache.load("connection-a", "openai", "https://api.openai.com/v1")?.models[0]?.id, "account-model");
  assert.equal(providerModelCache.load("connection-b", "openai", "https://api.openai.com/v1"), undefined);
  assert.equal(providerModelCache.load("connection-a", "openai", "https://proxy.example/v1"), undefined);
  assert.equal(providerModelCache.load("connection-a", "google", "https://api.openai.com/v1"), undefined);
  assert.equal(normalizeProviderBaseUrl(" https://api.openai.com/v1/// "), "https://api.openai.com/v1");
});

test("共享目录只同步使用 24 小时内的在线缓存", () => {
  values.clear();
  const connection = profile("connection-a");
  const fresh = directory();
  providerModelCache.save(connection.id, connection.provider, connection.baseUrl, fresh);
  assert.equal(getCachedConnectionModelCatalog(connection, "text")[0]?.id, "account-model");

  const expired = directory(new Date(Date.now() - PROVIDER_MODEL_CACHE_TTL - 1).toISOString());
  providerModelCache.save(connection.id, connection.provider, connection.baseUrl, expired);
  assert.equal(providerModelCache.isStale(expired), true);
  assert.notEqual(getCachedConnectionModelCatalog(connection, "text")[0]?.id, "account-model");
});

test("Google 在线目录与 Interactions-only 静态模型按 ID 合并", () => {
  values.clear();
  const connection: ApiConnectionProfile = {
    ...profile("google-connection", "https://generativelanguage.googleapis.com/v1beta"),
    provider: "google",
    apiFormat: "google_generate_content",
    capabilities: ["text", "vision", "streaming"],
  };
  providerModelCache.save(connection.id, connection.provider, connection.baseUrl, {
    fetchedAt: new Date().toISOString(),
    models: [{
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      purposes: ["text", "vision"],
      capabilities: ["text", "vision", "structured_output", "streaming"],
      status: "active",
      source: "official_api",
      capabilitySource: "verified",
      supportedGenerationMethods: ["generateContent"],
      generationProtocol: "google_generate_content",
      supportsStreaming: true,
      supportsStructuredOutput: true,
      updatedAt: new Date().toISOString(),
    }],
  });
  const models = getCachedConnectionModelCatalog(connection, "text");
  assert.equal(models.filter((model) => model.id === "gemini-2.5-flash").length, 1);
  assert.equal(models.find((model) => model.id === "gemini-3.5-flash")?.generationProtocol, "google_interactions");
});
