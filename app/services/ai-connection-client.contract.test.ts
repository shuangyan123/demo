import assert from "node:assert/strict";
import test from "node:test";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import { buildGenerateProviderRequest } from "../server/ai/provider-adapter.ts";
import type { AiGenerateRequest } from "./api-client.ts";
import { CONNECTION_TEST_MAX_OUTPUT_TOKENS, generateWithConnection, synthesizeWithConnection, testConnectionDraft, transcribeWithConnection } from "./ai-connection-client.ts";
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

test("具体模型的 unsupported、unknown 与非法 runtime 在解密和网络前稳定失败", async () => {
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let secretReads = 0;
  aiConnectionsRepository.resolveSecret = async () => {
    secretReads += 1;
    return "fixture-secret";
  };
  try {
    await assert.rejects(
      generateWithConnection({ ...connection, provider: "deepseek", capabilities: ["text", "vision"] }, "vision", { modelId: "deepseek-v4-pro", messages: [{ role: "user", content: "分析图片" }] }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "model-capability-unsupported",
    );
    await assert.rejects(
      generateWithConnection({ ...connection, provider: "custom", capabilities: ["text", "vision"] }, "vision", { modelId: "gpt-5.5-vision", messages: [{ role: "user", content: "分析图片" }] }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "model-capability-unknown",
    );
    await assert.rejects(
      generateWithConnection({ ...connection, provider: "google", capabilities: ["text"] }, "text", { modelId: "gemini-2.5-pro", selectedRuntimeValues: { reasoning: 127 }, messages: [{ role: "user", content: "测试" }] }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid-runtime-value",
    );
    assert.equal(secretReads, 0);
  } finally {
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
});

test("custom unknown 结构化输出能力保留文本流程但不发送未经验证的协议参数", async () => {
  const originalFetch = globalThis.fetch;
  const originalResolveSecret = aiConnectionsRepository.resolveSecret;
  let requestBody: Record<string, unknown> | undefined;
  aiConnectionsRepository.resolveSecret = async () => "fixture-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ content: JSON.stringify({ ok: true }) });
  };
  try {
    const result = await generateWithConnection(
      { ...connection, provider: "custom", capabilities: ["text", "structured_output"] },
      "text",
      {
        modelId: "mock-json-model",
        messages: [{ role: "system", content: "保留业务指令" }, { role: "user", content: "只返回 JSON" }],
        structuredOutput: { name: "probe", schema: { type: "object" } },
      },
    );
    assert.equal(result.content, JSON.stringify({ ok: true }));
    assert.equal(requestBody?.model, "mock-json-model");
    assert.equal("structuredOutput" in (requestBody ?? {}), false);
    assert.match(JSON.stringify(requestBody?.messages), /保留业务指令/);
    assert.match(JSON.stringify(requestBody?.messages), /输出契约 probe/);
    assert.match(JSON.stringify(requestBody?.messages), /JSON Schema/);
  } finally {
    globalThis.fetch = originalFetch;
    aiConnectionsRepository.resolveSecret = originalResolveSecret;
  }
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

type ConnectionDraftInput = Parameters<typeof testConnectionDraft>[0];

async function captureConnectionTestRequest(input: ConnectionDraftInput): Promise<AiGenerateRequest> {
  const originalFetch = globalThis.fetch;
  let requestBody: AiGenerateRequest | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as AiGenerateRequest;
    return Response.json({ content: "OK" });
  };
  try {
    await testConnectionDraft(input);
    if (!requestBody) throw new Error("connection test request was not captured");
    return requestBody;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("DeepSeek connection test disables thinking while normal generation keeps high default", async () => {
  const connectionTest = await captureConnectionTestRequest({
    provider: "deepseek",
    apiKey: "connection-test-key",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-v4-flash",
  });
  assert.equal(connectionTest.maxOutputTokens, CONNECTION_TEST_MAX_OUTPUT_TOKENS);
  assert.deepEqual(connectionTest.runtime, { reasoning: "disabled" });

  const request = buildGenerateProviderRequest(connectionTest);
  const body = request.body as Record<string, unknown>;
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.headers.Authorization, "Bearer connection-test-key");
  assert.deepEqual(body.messages, [{ role: "user", content: "仅回复 OK" }]);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in body, false);
  assert.equal(body.max_tokens, CONNECTION_TEST_MAX_OUTPUT_TOKENS);

  const normalRequest = buildGenerateProviderRequest({
    provider: "deepseek",
    apiKey: "connection-test-key",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    maxOutputTokens: 321,
    messages: [{ role: "user", content: "normal generation" }],
  });
  const normalBody = normalRequest.body as Record<string, unknown>;
  assert.deepEqual(normalBody.thinking, { type: "enabled" });
  assert.equal(normalBody.reasoning_effort, "high");
});

test("Gemini connection test uses minimal verified thinking while normal generation keeps medium default", async () => {
  const connectionTest = await captureConnectionTestRequest({
    provider: "google",
    apiKey: "connection-test-key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelId: "gemini-3.5-flash",
  });
  assert.equal(connectionTest.maxOutputTokens, CONNECTION_TEST_MAX_OUTPUT_TOKENS);
  assert.deepEqual(connectionTest.runtime, { reasoning: "minimal" });
  assert.equal(connectionTest.generationProtocol, "google_interactions");

  const request = buildGenerateProviderRequest(connectionTest);
  const body = request.body as Record<string, unknown>;
  const generationConfig = body.generation_config as Record<string, unknown>;
  assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(request.headers["x-goog-api-key"], "connection-test-key");
  assert.equal(body.store, false);
  assert.deepEqual(body.input, [{ type: "text", text: "仅回复 OK" }]);
  assert.deepEqual(generationConfig, { max_output_tokens: CONNECTION_TEST_MAX_OUTPUT_TOKENS, thinking_level: "minimal" });
  assert.equal("thinking_budget" in generationConfig, false);
  assert.equal("service_tier" in body, false);
  assert.equal("contents" in body, false);
  assert.equal("generationConfig" in body, false);

  const normalRequest = buildGenerateProviderRequest({
    provider: "google",
    apiKey: "connection-test-key",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
    generationProtocol: "google_interactions",
    maxOutputTokens: 321,
    messages: [{ role: "user", content: "normal generation" }],
  });
  const normalBody = normalRequest.body as Record<string, unknown>;
  assert.deepEqual(normalBody.generation_config as Record<string, unknown>, { max_output_tokens: 321, thinking_level: "medium" });
});

test("unknown and fixed-reasoning connection tests do not invent a disabled runtime", async () => {
  const unknown = await captureConnectionTestRequest({
    provider: "custom",
    apiKey: "connection-test-key",
    baseUrl: "https://custom.example/v1",
    modelId: "future-reasoning-model",
  });
  assert.equal("runtime" in unknown, false);
  assert.equal(unknown.maxOutputTokens, CONNECTION_TEST_MAX_OUTPUT_TOKENS);

  const fixed = await captureConnectionTestRequest({
    provider: "minimax",
    apiKey: "connection-test-key",
    baseUrl: "https://api.minimaxi.com/anthropic",
    modelId: "MiniMax-M2.7",
  });
  assert.equal("runtime" in fixed, false);
});
