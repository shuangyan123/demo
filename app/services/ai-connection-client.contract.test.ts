import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import { generateWithConnection, synthesizeWithConnection, testConnectionDraft, transcribeWithConnection } from "./ai-connection-client.ts";
import { aiConnectionsRepository } from "./ai-connections-repository.ts";

const connection: ApiConnectionProfile = {
  id: "fixture-connection",
  label: "测试连接",
  provider: "google",
  apiFormat: "google_generate_content",
  baseUrl: "https://provider.example/v1",
  model: "text-model",
  capabilities: ["text", "vision", "speech"],
  encryptedKey: "ciphertext",
  iv: "fixture-iv",
  maskedKey: "****-key",
  providerOptions: { region: "cn-test" },
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
};

test("连接级生成请求完整传递厂商、模型和扩展参数", async () => {
  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let requestBody: Record<string, unknown> | undefined;
  aiConnectionsRepository.resolveSecret = async () => "fixture-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ content: "完成" }), { status: 200 });
  };

  try {
    const result = await generateWithConnection(connection, "text", {
      modelId: "text-model",
      maxOutputTokens: 256,
      messages: [{ role: "user", content: "测试" }],
      temperature: 0.2,
    });
    assert.equal(result.content, "完成");
    assert.deepEqual(requestBody, {
      provider: "google",
      apiKey: "fixture-secret",
      baseUrl: "https://provider.example/v1",
      maxOutputTokens: 256,
      model: "text-model",
      messages: [{ role: "user", content: "测试" }],
      temperature: 0.2,
      providerOptions: { region: "cn-test" },
    });
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});

test("默认语音连接允许个性化模型覆盖但不改写连接档案", async () => {
  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let requestBody: Record<string, unknown> | undefined;
  aiConnectionsRepository.resolveSecret = async () => "fixture-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  };

  try {
    const audio = await synthesizeWithConnection(connection, {
      model: "speech-model",
      voiceId: "voice-id",
      text: "你好",
    });
    assert.equal(audio.size, 3);
    assert.deepEqual(requestBody, {
      provider: "google",
      apiKey: "fixture-secret",
      baseUrl: "https://provider.example/v1",
      model: "speech-model",
      voiceId: "voice-id",
      text: "你好",
      providerOptions: { region: "cn-test" },
    });
    assert.equal(connection.model, "text-model");
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});

test("连接级客户端在解密前拒绝能力不匹配的生成与语音请求", async () => {
  const textOnlyConnection = { ...connection, capabilities: ["text"] as ApiConnectionProfile["capabilities"] };
  const speechOnlyConnection = { ...connection, capabilities: ["speech"] as ApiConnectionProfile["capabilities"] };

  await assert.rejects(
    generateWithConnection(textOnlyConnection, "vision", { messages: [{ role: "user", content: "分析图片" }] }),
    /不支持多模态能力/,
  );
  await assert.rejects(
    synthesizeWithConnection(textOnlyConnection, { voiceId: "voice-id", text: "你好" }),
    /不支持语音能力/,
  );
  await assert.rejects(
    generateWithConnection(speechOnlyConnection, "text", { messages: [{ role: "user", content: "测试" }] }),
    /不支持文本能力/,
  );
});

test("连接级转写请求要求 Google 与 transcription 能力", async () => {
  await assert.rejects(
    transcribeWithConnection({ ...connection, capabilities: ["text"] }, { audioBase64: "UklGRg==", mimeType: "audio/webm" }),
    /未启用录音转写能力/,
  );
  await assert.rejects(
    transcribeWithConnection({ ...connection, provider: "deepseek", capabilities: ["transcription"] }, { audioBase64: "UklGRg==", mimeType: "audio/webm" }),
    /仅支持 Google Gemini/,
  );
});

test("编辑连接测试使用当前草稿地址和模型，仅在 Key 留空时读取旧密钥", async () => {
  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let requestBody: Record<string, unknown> | undefined;
  aiConnectionsRepository.resolveSecret = async () => "saved-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ content: "OK" });
  };
  try {
    await testConnectionDraft({
      provider: "google",
      apiKey: "draft-secret",
      baseUrl: "https://draft.example/v1beta",
      modelId: "gemini-draft",
      label: "编辑草稿",
      existingConnection: connection,
    });
    assert.equal(requestBody?.apiKey, "draft-secret");
    assert.equal(requestBody?.baseUrl, "https://draft.example/v1beta");
    assert.equal(requestBody?.model, "gemini-draft");
    assert.deepEqual(requestBody?.activity, { connectionLabel: "编辑草稿", presentation: "compact-test", purpose: "connection-test" });

    await testConnectionDraft({
      provider: "google",
      apiKey: "",
      baseUrl: "https://edited.example/v1beta",
      modelId: "gemini-edited",
      existingConnection: connection,
    });
    assert.equal(requestBody?.apiKey, "saved-secret");
    assert.equal(requestBody?.baseUrl, "https://edited.example/v1beta");
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});
