import assert from "node:assert/strict";
import test from "node:test";
import { parseAiJsonObject } from "../../services/ai-json.ts";
import { AiProviderFailureError, isAiProviderFailure } from "../../services/ai-provider-failure.ts";
import type { AiGenerateRequest } from "../../services/api-client.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import { buildGenerateProviderRequest, parseGenerateProviderResponse, parseGenerateProviderStreamEvent } from "./provider-adapter.ts";
import { parseProviderFailure } from "./provider-failure.ts";

const baseGenerate = {
  apiKey: "fixture-key",
  baseUrl: "https://provider.example/v1/",
  maxOutputTokens: 321,
  messages: [
    { role: "system", content: "system constraint" },
    { role: "user", content: "fixture prompt" },
  ],
  model: "fixture-model",
  temperature: 0.2,
} satisfies Omit<AiGenerateRequest, "provider">;

function input(provider: ApiProvider, overrides: Partial<AiGenerateRequest> = {}): AiGenerateRequest {
  return { ...baseGenerate, provider, ...overrides };
}

const nativeRequestFixtures: Array<{ provider: ApiProvider; overrides?: Partial<AiGenerateRequest>; pathSuffix: string }> = [
  { provider: "openai", pathSuffix: "/responses" },
  { provider: "google", pathSuffix: ":generateContent", overrides: { generationProtocol: "google_generate_content" } },
  { provider: "google", pathSuffix: "/interactions", overrides: { generationProtocol: "google_interactions", model: "gemini-3.5-flash" } },
  { provider: "anthropic", pathSuffix: "/messages" },
  { provider: "deepseek", pathSuffix: "/chat/completions" },
  { provider: "zhipu", pathSuffix: "/chat/completions" },
  { provider: "minimax", pathSuffix: "/messages", overrides: { model: "MiniMax-M3", providerOptions: { region: "cn" } } },
  { provider: "xai", pathSuffix: "/responses", overrides: { model: "grok-4.5" } },
  { provider: "custom", pathSuffix: "/chat/completions" },
];

test("request normalization keeps seven native protocols and custom compatibility in one boundary", () => {
  for (const fixture of nativeRequestFixtures) {
    const request = buildGenerateProviderRequest(input(fixture.provider, fixture.overrides));
    assert.ok(request.url.endsWith(fixture.pathSuffix), fixture.provider);
    assert.equal(JSON.stringify(request.body).includes("fixture-key"), false, fixture.provider);
    assert.equal(JSON.stringify(request.body).includes("Authorization"), false, fixture.provider);
  }

  const googleInteractions = buildGenerateProviderRequest(input("google", { generationProtocol: "google_interactions", stream: true }));
  const interactionsBody = googleInteractions.body as Record<string, unknown>;
  assert.equal("contents" in interactionsBody, false);
  assert.equal("generationConfig" in interactionsBody, false);
  assert.equal(interactionsBody.store, false);

  const custom = buildGenerateProviderRequest(input("custom"));
  assert.deepEqual((custom.body as Record<string, unknown>).messages, baseGenerate.messages);
});

const responseFixtures: Array<{ label: string; input: AiGenerateRequest; payload: unknown; expectedRequestId: string }> = [
  {
    label: "openai responses",
    input: input("openai"),
    payload: {
      id: "resp_openai",
      output: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "hidden reasoning" }] },
        { type: "message", content: [{ type: "output_text", text: "Hel" }, { type: "output_text", text: "lo" }] },
      ],
      usage: { input_tokens: 2, output_tokens: 3 },
    },
    expectedRequestId: "resp_openai",
  },
  {
    label: "google generate content",
    input: input("google", { generationProtocol: "google_generate_content" }),
    payload: {
      candidates: [{ content: { parts: [{ thought: true, text: "hidden reasoning" }, { text: "Hello" }] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
    },
    expectedRequestId: "request-google",
  },
  {
    label: "google interactions",
    input: input("google", { generationProtocol: "google_interactions", model: "gemini-3.5-flash" }),
    payload: {
      id: "interaction_google",
      steps: [
        { type: "user_input", content: [{ type: "text", text: "fixture prompt" }] },
        { type: "model_output", content: [{ type: "text", text: "Hello" }] },
      ],
      usage: { total_input_tokens: 2, total_output_tokens: 3, total_tokens: 5 },
    },
    expectedRequestId: "interaction_google",
  },
  {
    label: "anthropic messages",
    input: input("anthropic"),
    payload: {
      id: "msg_anthropic",
      content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "text", text: "Hello" }],
      usage: { input_tokens: 2, output_tokens: 3 },
    },
    expectedRequestId: "msg_anthropic",
  },
  {
    label: "deepseek chat completions",
    input: input("deepseek"),
    payload: { id: "chat_deepseek", choices: [{ message: { role: "assistant", content: "Hello" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
    expectedRequestId: "chat_deepseek",
  },
  {
    label: "zhipu chat completions",
    input: input("zhipu"),
    payload: { id: "chat_zhipu", choices: [{ message: { role: "assistant", content: "Hello" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
    expectedRequestId: "chat_zhipu",
  },
  {
    label: "minimax messages",
    input: input("minimax", { model: "MiniMax-M3", providerOptions: { region: "cn" } }),
    payload: {
      id: "msg_minimax",
      content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "text", text: "Hello" }],
      usage: { input_tokens: 2, output_tokens: 3 },
    },
    expectedRequestId: "msg_minimax",
  },
  {
    label: "xai responses",
    input: input("xai", { model: "grok-4.5" }),
    payload: { id: "resp_xai", output_text: "Hello", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } },
    expectedRequestId: "resp_xai",
  },
  {
    label: "custom chat compatibility",
    input: input("custom"),
    payload: { id: "chat_custom", choices: [{ message: { role: "assistant", content: "Hello" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
    expectedRequestId: "chat_custom",
  },
];

test("response normalization returns common content, request id and usage without hidden reasoning", () => {
  for (const fixture of responseFixtures) {
    const result = parseGenerateProviderResponse(fixture.input, fixture.payload, new Headers({ "x-request-id": fixture.expectedRequestId }));
    assert.equal(result.content, "Hello", fixture.label);
    assert.equal(result.requestId, fixture.expectedRequestId, fixture.label);
    assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, fixture.label);
    assert.equal(JSON.stringify(result).includes("hidden reasoning"), false, fixture.label);
  }
});

test("usage normalization preserves zero and explicit totals while leaving unknown values undefined", () => {
  const zero = parseGenerateProviderResponse(input("deepseek"), {
    id: "zero",
    choices: [{ message: { content: "ok" } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }, new Headers());
  assert.deepEqual(zero.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });

  const explicitTotal = parseGenerateProviderResponse(input("openai"), { output_text: "ok", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 99 } }, new Headers());
  assert.deepEqual(explicitTotal.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 99 });

  const partial = parseGenerateProviderResponse(input("custom"), { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2 } }, new Headers());
  assert.deepEqual(partial.usage, { inputTokens: 2 });
});

const streamFixtures: Array<{ label: string; input: AiGenerateRequest; payloads: unknown[] }> = [
  {
    label: "openai responses",
    input: input("openai", { stream: true }),
    payloads: [
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
      { type: "response.reasoning_summary_text.delta", delta: "hidden reasoning" },
      { type: "response.completed", response: { id: "resp_stream_openai", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
    ],
  },
  {
    label: "google generate content",
    input: input("google", { generationProtocol: "google_generate_content", stream: true }),
    payloads: [
      { candidates: [{ content: { parts: [{ text: "Hel" }] } }] },
      { candidates: [{ content: { parts: [{ thought: true, text: "hidden reasoning" }, { text: "lo" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 } },
    ],
  },
  {
    label: "google interactions",
    input: input("google", { generationProtocol: "google_interactions", stream: true }),
    payloads: [
      { type: "step.delta", delta: { type: "text", text: "Hel" } },
      { type: "step.delta", delta: { type: "text", text: "lo" } },
      { type: "interaction.completed", interaction: { id: "interaction_stream_google", usage: { total_input_tokens: 2, total_output_tokens: 3, total_tokens: 5 } } },
    ],
  },
  {
    label: "anthropic messages",
    input: input("anthropic", { stream: true }),
    payloads: [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hidden reasoning" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_delta", delta: {}, usage: { input_tokens: 2, output_tokens: 3 } },
      { type: "message_stop", message: { id: "msg_stream_anthropic" } },
    ],
  },
  {
    label: "minimax messages",
    input: input("minimax", { model: "MiniMax-M3", stream: true, providerOptions: { region: "cn" } }),
    payloads: [
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_stop", message: { id: "msg_stream_minimax" } },
    ],
  },
  ...(["deepseek", "zhipu", "xai", "custom"] as const).map((provider) => ({
    label: `${provider} chat/responses`,
    input: input(provider, { stream: true, ...(provider === "xai" ? { model: "grok-4.5" } : {}) }),
    payloads: provider === "xai"
      ? [
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        { type: "response.completed", response: { id: "resp_stream_xai", usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
      ]
      : [
        { id: `chat_stream_${provider}`, choices: [{ delta: { content: "Hel" } }] },
        { id: `chat_stream_${provider}`, choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
      ],
  })),
];

test("stream normalization emits incremental deltas and one explicit completion per provider", () => {
  for (const fixture of streamFixtures) {
    const events = fixture.payloads.flatMap((payload) => parseGenerateProviderStreamEvent(fixture.input, payload, new Headers()));
    assert.deepEqual(events.filter((event) => event.type === "delta").map((event) => event.text), ["Hel", "lo"], fixture.label);
    assert.equal(events.filter((event) => event.type === "done").length, 1, fixture.label);
    assert.equal(JSON.stringify(events).includes("hidden reasoning"), false, fixture.label);
  }
});

const failureFixtures: Array<{ provider: ApiProvider; status: number; payload: unknown; expectedCode: string; headers?: Record<string, string> }> = [
  { provider: "openai", status: 401, payload: { error: { code: "invalid_api_key", message: "apiKey=fixture-key Authorization: Bearer secret" } }, expectedCode: "authentication" },
  { provider: "google", status: 403, payload: { error: { status: "PERMISSION_DENIED", message: "fixture prompt" } }, expectedCode: "permission" },
  { provider: "anthropic", status: 404, payload: { type: "error", error: { type: "not_found_error", message: "fixture prompt" } }, expectedCode: "model_not_found" },
  { provider: "deepseek", status: 429, payload: { error: { code: "rate_limit_reached", message: "fixture prompt" } }, expectedCode: "rate_limit", headers: { "retry-after": "2" } },
  { provider: "zhipu", status: 402, payload: { error: { code: "insufficient_balance", message: "fixture prompt" } }, expectedCode: "quota_exhausted" },
  { provider: "minimax", status: 503, payload: { error: { type: "overloaded_error", message: "fixture prompt" } }, expectedCode: "provider_unavailable" },
  { provider: "xai", status: 418, payload: { error: { code: "vendor_specific_unknown", message: "fixture prompt" }, request_id: "upstream-xai" }, expectedCode: "unknown" },
  { provider: "custom", status: 400, payload: { error: { code: "invalid_request_error", message: "fixture prompt" } }, expectedCode: "invalid_request" },
];

test("provider failures normalize status/code/request metadata without raw provider text", async () => {
  for (const fixture of failureFixtures) {
    const response = Response.json(fixture.payload, { status: fixture.status, headers: fixture.headers });
    const failure = await parseProviderFailure(input(fixture.provider), response);
    assert.equal(failure.code, fixture.expectedCode, fixture.provider);
    assert.equal(failure.provider, fixture.provider);
    assert.equal(isAiProviderFailure(failure), true);
    assert.equal(JSON.stringify(failure).includes("fixture-key"), false, fixture.provider);
    assert.equal(JSON.stringify(failure).includes("secret"), false, fixture.provider);
    assert.equal(JSON.stringify(failure).includes("fixture prompt"), false, fixture.provider);
    if (fixture.provider === "deepseek") assert.equal(failure.retryAfterMs, 2000);
  }
});

test("malformed provider response stays distinct from business JSON validation", () => {
  assert.throws(
    () => parseGenerateProviderResponse(input("custom"), { choices: "not-an-array" }, new Headers()),
    (error: unknown) => error instanceof AiProviderFailureError && error.failure.code === "malformed_response",
  );
  assert.throws(() => parseAiJsonObject("{bad"), /AI 返回不是有效 JSON 对象/);
});
