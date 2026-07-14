import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerateProviderRequest, buildSpeechProviderRequest, buildTranscriptionProviderRequest, parseGenerateProviderResponse, parseGenerateProviderStreamEvent, parseSpeechJsonResponse, parseTranscriptionProviderResponse } from "./provider-adapter.ts";
import type { AiGenerateRequest, AiSpeechRequest, AiTranscriptionRequest } from "../../services/api-client.ts";
import { POST as modelsPost } from "../../api/ai/models/route.ts";
import { POST as speechPost } from "../../api/ai/speech/route.ts";
import { getProviderAdapter, providerAdapterRegistry } from "./provider-adapter-registry.ts";

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

test("七家重点厂商通过显式适配器注册，其他厂商进入兼容边界", () => {
  assert.deepEqual([...providerAdapterRegistry.keys()], ["openai", "google", "anthropic", "deepseek", "zhipu", "minimax", "xai"]);
  assert.equal(getProviderAdapter("openai").protocol, "responses");
  assert.equal(getProviderAdapter("minimax").protocol, "messages");
  assert.equal(getProviderAdapter("custom").protocol, "chat_completions");
});

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

test("Gemini 多模态图片被映射为官方 inlineData，而不是文本标签", () => {
  const input: AiGenerateRequest = {
    ...baseGenerate,
    provider: "google",
    messages: [{ role: "user", content: [
      { type: "text", text: "描述图片" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ] }],
  };
  const request = buildGenerateProviderRequest(input);
  assert.deepEqual((request.body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts, [
    { text: "描述图片" },
    { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
  ]);
});

test("OpenAI 与 Gemini 只在明确选择快速模式时发送官方 service tier", () => {
  const openai = buildGenerateProviderRequest({ ...baseGenerate, provider: "openai", model: "gpt-5.5", runtime: { speed: "priority" } });
  const google = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", model: "gemini-3.5-flash", runtime: { speed: "priority" } });
  assert.equal((openai.body as Record<string, unknown>).service_tier, "priority");
  assert.equal((google.body as Record<string, unknown>).service_tier, "priority");
  const standard = buildGenerateProviderRequest({ ...baseGenerate, provider: "openai", model: "gpt-5.5", runtime: { speed: "standard" } });
  assert.equal("service_tier" in (standard.body as Record<string, unknown>), false);
});

test("七家厂商按具体模型映射推理与速度运行值", () => {
  const openai = buildGenerateProviderRequest({ ...baseGenerate, provider: "openai", model: "gpt-5.5", runtime: { reasoning: "high", speed: "priority" } });
  assert.deepEqual((openai.body as { reasoning: unknown }).reasoning, { effort: "high" });
  assert.equal((openai.body as { service_tier: string }).service_tier, "priority");

  const google = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", model: "gemini-3.5-flash", runtime: { reasoning: "low", speed: "priority" } });
  assert.deepEqual((google.body as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assert.equal((google.body as { service_tier: string }).service_tier, "priority");

  const claude = buildGenerateProviderRequest({ ...baseGenerate, provider: "anthropic", model: "claude-opus-4-8", runtime: { reasoning: "xhigh", speed: "fast" } });
  assert.deepEqual((claude.body as { thinking: unknown }).thinking, { type: "adaptive" });
  assert.equal((claude.body as { output_config: { effort: string } }).output_config.effort, "xhigh");
  assert.equal((claude.body as { speed: string }).speed, "fast");
  assert.equal(claude.headers["anthropic-beta"], "fast-mode-2026-02-01");

  const deepseek = buildGenerateProviderRequest({ ...baseGenerate, provider: "deepseek", model: "deepseek-v4-pro", runtime: { reasoning: "max" } });
  assert.deepEqual((deepseek.body as { thinking: unknown }).thinking, { type: "enabled" });
  assert.equal((deepseek.body as { reasoning_effort: string }).reasoning_effort, "max");

  const minimax = buildGenerateProviderRequest({ ...baseGenerate, provider: "minimax", model: "MiniMax-M3", runtime: { reasoning: "adaptive", speed: "priority" } });
  assert.deepEqual((minimax.body as { thinking: unknown }).thinking, { type: "adaptive" });
  assert.equal((minimax.body as { service_tier: string }).service_tier, "priority");
  assert.equal(minimax.headers.Authorization, "Bearer fixture-key");
  assert.equal("x-api-key" in minimax.headers, false);
  const minimaxDisabled = buildGenerateProviderRequest({ ...baseGenerate, provider: "minimax", model: "MiniMax-M3" });
  assert.deepEqual((minimaxDisabled.body as { thinking: unknown }).thinking, { type: "disabled" });

  const xai = buildGenerateProviderRequest({ ...baseGenerate, provider: "xai", model: "grok-4.5", runtime: { reasoning: "medium", speed: "priority" } });
  assert.deepEqual((xai.body as { reasoning: unknown }).reasoning, { effort: "medium" });
  assert.equal((xai.body as { service_tier: string }).service_tier, "priority");
});

test("MiniMax-M3 图片与视频映射为 Anthropic-compatible 独立内容块", () => {
  const request = buildGenerateProviderRequest({
    ...baseGenerate,
    provider: "minimax",
    model: "MiniMax-M3",
    providerOptions: { region: "cn", credentialPlan: "pay_as_you_go" },
    baseUrl: "https://api.minimaxi.com/v1",
    messages: [{ role: "user", content: [
      { type: "text", text: "说明内容" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } },
      { type: "video_url", video_url: { url: "https://example.test/video.mp4" } },
    ] }],
  });
  assert.equal(request.url, "https://api.minimaxi.com/anthropic/v1/messages");
  const content = (request.body as { messages: Array<{ content: unknown[] }> }).messages[0].content;
  assert.deepEqual(content[1], { type: "image", source: { type: "base64", media_type: "image/webp", data: "AAAA" } });
  assert.deepEqual(content[2], { type: "video", source: { type: "url", url: "https://example.test/video.mp4" } });
});

test("Gemini 2.5 自定义预算与动态关闭哨兵原样映射", () => {
  const pro = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", model: "gemini-2.5-pro", runtime: { reasoning: 12000 } });
  assert.deepEqual((pro.body as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig, { thinkingBudget: 12000 });

  const flashLiteDynamic = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", model: "gemini-2.5-flash-lite", runtime: { reasoning: -1 } });
  const flashLiteDisabled = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", model: "gemini-2.5-flash-lite", runtime: { reasoning: 0 } });
  const flashLiteInvalid = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", model: "gemini-2.5-flash-lite", runtime: { reasoning: 511 } });
  assert.deepEqual((flashLiteDynamic.body as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig, { thinkingBudget: -1 });
  assert.deepEqual((flashLiteDisabled.body as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual((flashLiteInvalid.body as { generationConfig: { thinkingConfig: unknown } }).generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test("Claude 预算型思考把思考 token 与正文输出额度合并到 max_tokens", () => {
  const defaultBudget = buildGenerateProviderRequest({ ...baseGenerate, provider: "anthropic", model: "claude-haiku-4-5" });
  assert.deepEqual((defaultBudget.body as { thinking: unknown }).thinking, { type: "enabled", budget_tokens: 1024 });
  assert.equal((defaultBudget.body as { max_tokens: number }).max_tokens, 1024 + 321);

  const customBudget = buildGenerateProviderRequest({ ...baseGenerate, provider: "anthropic", model: "claude-haiku-4-5", runtime: { reasoning: 12000 } });
  assert.deepEqual((customBudget.body as { thinking: unknown }).thinking, { type: "enabled", budget_tokens: 12000 });
  assert.equal((customBudget.body as { max_tokens: number }).max_tokens, 12000 + 321);
  assert.equal("temperature" in (customBudget.body as object), false);

  const invalidBudget = buildGenerateProviderRequest({ ...baseGenerate, provider: "anthropic", model: "claude-haiku-4-5", runtime: { reasoning: 1000 } });
  assert.deepEqual((invalidBudget.body as { thinking: unknown }).thinking, { type: "enabled", budget_tokens: 1024 });
  assert.equal((invalidBudget.body as { max_tokens: number }).max_tokens, 1024 + 321);
});

test("GLM-5.2 原样发送七档并默认 max，旧 GLM 只发送思考开关", () => {
  for (const reasoning of ["max", "xhigh", "high", "medium", "low", "minimal", "none"]) {
    const request = buildGenerateProviderRequest({ ...baseGenerate, provider: "zhipu", model: "glm-5.2", runtime: { reasoning } });
    assert.deepEqual((request.body as { thinking: unknown }).thinking, { type: "enabled" });
    assert.equal((request.body as { reasoning_effort: string }).reasoning_effort, reasoning);
  }
  const defaultRequest = buildGenerateProviderRequest({ ...baseGenerate, provider: "zhipu", model: "glm-5.2" });
  assert.equal((defaultRequest.body as { reasoning_effort: string }).reasoning_effort, "max");
  const oldEnabled = buildGenerateProviderRequest({ ...baseGenerate, provider: "zhipu", model: "glm-5.1", runtime: { reasoning: "enabled" } });
  const oldDisabled = buildGenerateProviderRequest({ ...baseGenerate, provider: "zhipu", model: "glm-5.1", runtime: { reasoning: "disabled" } });
  assert.deepEqual((oldEnabled.body as { thinking: unknown }).thinking, { type: "enabled" });
  assert.deepEqual((oldDisabled.body as { thinking: unknown }).thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in (oldEnabled.body as object), false);

  for (const model of ["glm-999", "glm-5.2-custom"]) {
    const unknown = buildGenerateProviderRequest({ ...baseGenerate, provider: "zhipu", model, runtime: { reasoning: "max" } });
    assert.equal("thinking" in (unknown.body as object), false, model);
    assert.equal("reasoning_effort" in (unknown.body as object), false, model);
  }
});

test("厂商实际 service tier 被归一化为最小运行结果", () => {
  const openai = parseGenerateProviderResponse({ ...baseGenerate, provider: "openai" }, { output_text: "完成", service_tier: "priority" }, new Headers());
  const google = parseGenerateProviderResponse({ ...baseGenerate, provider: "google" }, { candidates: [] }, new Headers({ "x-gemini-service-tier": "priority" }));
  const claude = parseGenerateProviderResponse({ ...baseGenerate, provider: "anthropic" }, { content: [], usage: { speed: "fast" } }, new Headers());
  assert.equal(openai.actualSpeed, "priority");
  assert.equal(google.actualSpeed, "priority");
  assert.equal(claude.actualSpeed, "fast");
});

test("Google Gemini 音频转写请求只归一化音频与文本", () => {
  const input: AiTranscriptionRequest = {
    provider: "google",
    apiKey: "fixture-key",
    baseUrl: "https://provider.example/v1/",
    model: "gemini-3.5-flash",
    mimeType: "audio/webm",
    audioBase64: "UklGRg==",
  };
  const request = buildTranscriptionProviderRequest(input);
  assert.equal(request.url, "https://provider.example/v1/models/gemini-3.5-flash:generateContent");
  assert.deepEqual(request.body, {
    contents: [{ role: "user", parts: [
      { text: "请逐字转写这段中文语音。只返回转写文本，不要解释、标题、时间戳或 Markdown。" },
      { inlineData: { mimeType: "audio/webm", data: "UklGRg==" } },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  });
  assert.deepEqual(
    parseTranscriptionProviderResponse({ candidates: [{ content: { parts: [{ text: "语音输入测试" }] } }] }, new Headers({ "x-request-id": "request-1" })),
    { text: "语音输入测试", requestId: "request-1" },
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
  for (const provider of ["deepseek", "qwen", "openrouter", "groq", "mistral", "siliconflow", "zhipu", "kimi", "doubao", "baidu", "tencent"] as const) {
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

test("六家重点厂商按原生协议映射结构化输出", () => {
  const structuredOutput = { name: "probe", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, strict: true };
  const openai = buildGenerateProviderRequest({ ...baseGenerate, provider: "openai", structuredOutput });
  const xai = buildGenerateProviderRequest({ ...baseGenerate, provider: "xai", structuredOutput });
  const google = buildGenerateProviderRequest({ ...baseGenerate, provider: "google", structuredOutput });
  const anthropic = buildGenerateProviderRequest({ ...baseGenerate, provider: "anthropic", structuredOutput });
  const deepseek = buildGenerateProviderRequest({ ...baseGenerate, provider: "deepseek", model: "deepseek-v4-pro", structuredOutput, runtime: { reasoning: "high" } });
  const minimax = buildGenerateProviderRequest({ ...baseGenerate, provider: "minimax", structuredOutput });

  assert.equal(openai.url, "https://provider.example/v1/responses");
  assert.equal(xai.url, "https://provider.example/v1/responses");
  assert.equal((openai.body as { text: { format: { type: string } } }).text.format.type, "json_schema");
  assert.equal((google.body as { generationConfig: { responseMimeType: string } }).generationConfig.responseMimeType, "application/json");
  assert.equal((anthropic.body as { output_config: { format: { type: string } } }).output_config.format.type, "json_schema");
  assert.deepEqual((deepseek.body as { response_format: unknown }).response_format, { type: "json_object" });
  assert.equal((deepseek.body as { reasoning_effort: string }).reasoning_effort, "high");
  assert.equal(minimax.url, "https://provider.example/anthropic/v1/messages");
  assert.equal((minimax.body as { max_tokens: number }).max_tokens, 321);
  assert.equal("response_format" in (minimax.body as object), false);
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

  const minimaxOptions = buildSpeechProviderRequest({ ...speechBase, provider: "minimax", volume: 0.8, pitch: 3, emotion: "happy", languageBoost: "Chinese" });
  const minimaxBody = minimaxOptions.body as { language_boost: string; voice_setting: { vol: number; pitch: number; emotion: string } };
  assert.deepEqual(minimaxBody.voice_setting, { voice_id: "voice-id", speed: 1.2, vol: 0.8, pitch: 3, emotion: "happy" });
  assert.equal(minimaxBody.language_boost, "Chinese");

  const glm = buildSpeechProviderRequest({ ...speechBase, provider: "zhipu", volume: 0.7 });
  assert.equal(glm.url, "https://speech.example/v1/audio/speech");
  assert.deepEqual(glm.body, { model: "speech-model", voice: "voice-id", input: "你好", speed: 1.2, volume: 0.7, response_format: "wav" });
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

test("模型目录代理归一化 Google models.list 且不返回密钥和原始响应", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = "";
  let forwardedHeaders: Record<string, string> | undefined;
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedHeaders = init?.headers as Record<string, string>;
    return Response.json({
      models: [
        { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"], ignored: "raw-provider-value" },
        { name: "models/gemini-future", displayName: "Gemini Future", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-005", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
      ],
    });
  };
  try {
    const response = await modelsPost(new Request("http://localhost/api/ai/models", {
      method: "POST",
      body: JSON.stringify({ provider: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/", apiKey: "fixture-key" }),
    }));
    const result = await response.json() as { models: Array<Record<string, unknown>>; fetchedAt: string };
    assert.equal(response.status, 200);
    assert.equal(forwardedUrl, "https://generativelanguage.googleapis.com/v1beta/models");
    assert.equal(forwardedHeaders?.["x-goog-api-key"], "fixture-key");
    assert.equal(result.models.length, 2);
    assert.equal(result.models[0].id, "gemini-2.5-flash");
    assert.equal(result.models[0].label, "Gemini 2.5 Flash");
    assert.deepEqual(result.models[0].purposes, ["text", "vision", "transcription"]);
    assert.deepEqual(result.models[0].capabilities, ["text", "vision", "transcription", "structured_output", "streaming"]);
    assert.equal(result.models[0].capabilitySource, "verified");
    assert.deepEqual(result.models[0].supportedGenerationMethods, ["generateContent"]);
    assert.equal(result.models[0].source, "official_api");
    assert.equal(result.models[0].supportsStreaming, true);
    assert.equal(result.models[0].supportsStructuredOutput, true);
    assert.deepEqual(result.models[1].capabilities, ["text", "structured_output", "streaming"]);
    assert.equal(result.models[1].capabilitySource, "unknown");
    assert.ok(result.models[0].updatedAt);
    assert.ok(result.fetchedAt);
    assert.equal(JSON.stringify(result).includes("fixture-key"), false);
    assert.equal(JSON.stringify(result).includes("raw-provider-value"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
