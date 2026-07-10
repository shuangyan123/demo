import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerateProviderRequest, buildSpeechProviderRequest, parseGenerateProviderResponse, parseGenerateProviderStreamEvent, parseSpeechJsonResponse } from "./provider-adapter.ts";
import type { AiGenerateRequest, AiSpeechRequest } from "../../services/api-client.ts";
import { POST as speechPost } from "../../api/ai/speech/route.ts";

const baseGenerate: Omit<AiGenerateRequest, "provider"> = {
  apiKey: "fixture-key",
  baseUrl: "https://provider.example/v1/",
  maxOutputTokens: 321,
  messages: [
    { role: "system", content: "系统约束" },
    { role: "user", content: "测试问题" },
  ],
  model: "fixture-model",
  temperature: 0.2,
};

test("OpenAI Responses fixture：endpoint、instructions 和 token 字段由服务端适配", () => {
  const input: AiGenerateRequest = { ...baseGenerate, provider: "openai" };
  const request = buildGenerateProviderRequest(input);
  assert.equal(request.url, "https://provider.example/v1/responses");
  assert.deepEqual(request.headers, { Authorization: "Bearer fixture-key", "Content-Type": "application/json" });
  assert.deepEqual(request.body, {
    model: "fixture-model",
    input: [{ role: "user", content: "测试问题" }],
    instructions: "系统约束",
    max_output_tokens: 321,
    temperature: 0.2,
  });
  assert.deepEqual(
    parseGenerateProviderResponse(input, { id: "resp_1", output_text: "完成", usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } }, new Headers()),
    { content: "完成", requestId: "resp_1", usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } },
  );
});

test("Google Gemini fixture：原生 generateContent 请求和响应均被归一化", () => {
  const input: AiGenerateRequest = { ...baseGenerate, provider: "google" };
  const request = buildGenerateProviderRequest(input);
  assert.equal(request.url, "https://provider.example/v1/models/fixture-model:generateContent");
  assert.equal(request.headers["x-goog-api-key"], "fixture-key");
  assert.deepEqual(request.body, {
    systemInstruction: { parts: [{ text: "系统约束" }] },
    contents: [{ role: "user", parts: [{ text: "测试问题" }] }],
    generationConfig: { maxOutputTokens: 321, temperature: 0.2 },
  });
  assert.deepEqual(
    parseGenerateProviderResponse(input, { candidates: [{ content: { parts: [{ text: "完成" }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, totalTokenCount: 10 } }, new Headers()),
    { content: "完成", requestId: undefined, usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
  );
});

test("Anthropic fixture：Messages 鉴权、system 和内容块保持厂商原生形状", () => {
  const input: AiGenerateRequest = { ...baseGenerate, provider: "anthropic" };
  const request = buildGenerateProviderRequest(input);
  assert.equal(request.url, "https://provider.example/v1/messages");
  assert.equal(request.headers["x-api-key"], "fixture-key");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(request.body, {
    model: "fixture-model",
    max_tokens: 321,
    system: "系统约束",
    messages: [{ role: "user", content: "测试问题" }],
    temperature: 0.2,
  });
  assert.deepEqual(
    parseGenerateProviderResponse(input, { id: "msg_1", content: [{ type: "text", text: "完成" }], usage: { input_tokens: 9, output_tokens: 5 } }, new Headers()),
    { content: "完成", requestId: "msg_1", usage: { inputTokens: 9, outputTokens: 5, totalTokens: 14 } },
  );
});

test("OpenAI-compatible providers map to Chat Completions", () => {
  for (const provider of ["xai", "deepseek", "qwen", "openrouter", "groq", "mistral", "siliconflow", "zhipu", "kimi", "doubao", "baidu", "tencent"] as const) {
    const input: AiGenerateRequest = { ...baseGenerate, provider };
    const request = buildGenerateProviderRequest(input);
    assert.equal(request.url, "https://provider.example/v1/chat/completions");
    assert.deepEqual(request.body, { model: "fixture-model", messages: baseGenerate.messages, max_tokens: 321, temperature: 0.2 });
    assert.deepEqual(
      parseGenerateProviderResponse(input, { id: "chat_1", choices: [{ message: { content: "完成" } }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } }, new Headers()),
      { content: "完成", requestId: "chat_1", usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } },
    );
  }
});

test("流式生成请求会启用厂商原生 stream 字段并归一化 delta 与 usage", () => {
  const openaiInput: AiGenerateRequest = { ...baseGenerate, provider: "openai", stream: true };
  const openaiRequest = buildGenerateProviderRequest(openaiInput);
  assert.equal((openaiRequest.body as { stream?: boolean }).stream, true);
  assert.deepEqual(
    parseGenerateProviderStreamEvent(openaiInput, { type: "response.output_text.delta", delta: "你好" }, new Headers()),
    [{ type: "delta", text: "你好" }],
  );
  assert.deepEqual(
    parseGenerateProviderStreamEvent(openaiInput, { type: "response.completed", response: { id: "resp_1", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } }, new Headers()),
    [{ type: "usage", requestId: "resp_1", usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }],
  );

  const chatInput: AiGenerateRequest = { ...baseGenerate, provider: "deepseek", stream: true };
  const chatRequest = buildGenerateProviderRequest(chatInput);
  assert.deepEqual((chatRequest.body as { stream_options?: unknown }).stream_options, { include_usage: true });
  assert.deepEqual(
    parseGenerateProviderStreamEvent(chatInput, { id: "chat_1", choices: [{ delta: { content: "世界" } }] }, new Headers()),
    [{ type: "delta", text: "世界" }],
  );
});

const speechBase: Omit<AiSpeechRequest, "provider"> = {
  apiKey: "fixture-key",
  baseUrl: "https://speech.example/v1",
  model: "speech-model",
  voiceId: "voice-id",
  text: "你好",
  speed: 1.2,
  style: "温和",
};

test("五家默认语音服务 fixture：endpoint、鉴权和字段互不泄漏到客户端", () => {
  const openai = buildSpeechProviderRequest({ ...speechBase, provider: "openai" });
  assert.equal(openai.url, "https://speech.example/v1/audio/speech");
  assert.equal(openai.parseMode, "binary");

  const google = buildSpeechProviderRequest({ ...speechBase, provider: "google" });
  assert.equal(google.url, "https://speech.example/v1/models/speech-model:generateContent");
  assert.equal(google.headers["x-goog-api-key"], "fixture-key");
  assert.equal(google.parseMode, "google_pcm");

  const elevenlabs = buildSpeechProviderRequest({ ...speechBase, provider: "elevenlabs" });
  assert.equal(elevenlabs.url, "https://speech.example/v1/text-to-speech/voice-id");
  assert.equal(elevenlabs.headers["xi-api-key"], "fixture-key");

  const azure = buildSpeechProviderRequest({ ...speechBase, provider: "azure" });
  assert.equal(azure.url, "https://speech.example/v1");
  assert.equal(azure.headers["Ocp-Apim-Subscription-Key"], "fixture-key");
  assert.equal(typeof azure.body, "string");

  const minimax = buildSpeechProviderRequest({ ...speechBase, provider: "minimax" });
  assert.equal(minimax.url, "https://speech.example/v1/t2a_v2");
  assert.equal(minimax.parseMode, "minimax");
  assert.equal((minimax.body as { output_format: string }).output_format, "hex");
});

test("JSON 语音响应 fixture：MiniMax 十六进制与 Gemini PCM 都可转为音频字节", async () => {
  assert.deepEqual(Array.from(await parseSpeechJsonResponse("minimax", { data: { audio: "4869" } })), [72, 105]);
  const wav = await parseSpeechJsonResponse("google_pcm", { candidates: [{ content: { parts: [{ inlineData: { data: "SGk=" } }] } }] });
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.deepEqual(Array.from(wav.slice(-2)), [72, 105]);
});

test("无鉴权本地 TTS 使用 OpenAI 兼容 endpoint 且不发送空 Authorization", async () => {
  const localRequest = buildSpeechProviderRequest({
    ...speechBase,
    provider: "custom",
    apiKey: "",
    baseUrl: "http://127.0.0.1:8000/v1/audio/speech",
  });
  assert.equal(localRequest.url, "http://127.0.0.1:8000/v1/audio/speech");
  assert.deepEqual(localRequest.headers, { "Content-Type": "application/json" });
  assert.deepEqual(localRequest.body, {
    model: "speech-model",
    voice: "voice-id",
    input: "你好",
    instructions: "温和",
    speed: 1.2,
    response_format: "mp3",
  });

  const originalFetch = globalThis.fetch;
  let forwardedUrl = "";
  let forwardedHeaders: Record<string, string> | undefined;
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedHeaders = init?.headers as Record<string, string>;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  };
  try {
    const response = await speechPost(new Request("http://localhost/api/ai/speech", {
      method: "POST",
      body: JSON.stringify({ ...speechBase, provider: "custom", apiKey: "", baseUrl: "http://127.0.0.1:8000/v1" }),
    }));
    assert.equal(response.status, 200);
    assert.equal(forwardedUrl, "http://127.0.0.1:8000/v1/audio/speech");
    assert.equal(forwardedHeaders?.Authorization, undefined);
    assert.equal((await response.arrayBuffer()).byteLength, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
