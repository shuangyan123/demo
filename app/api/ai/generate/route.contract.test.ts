import { outboundTransport } from "../../../server/http/outbound-fetch.ts";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { POST } from "./route.ts";
import { AiProviderFailureError, type AiProviderFailure } from "../../../services/ai-provider-failure.ts";
import { callAiGenerate, callAiGenerateStream, type AiGenerateRequest } from "../../../services/api-client.ts";

// 测试同时替换 DNS 与 transport；未知主机直接失败，绝不依赖生产域名绕过或真实网络。
beforeEach((context) => {
  if (!("mock" in context)) throw new Error("fixture requires a test context");
  context.mock.method(outboundTransport, "fetch", (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  context.mock.method(dns, "lookup", async (hostname: string) => {
    assert.equal(hostname, "provider.example", "unexpected fixture DNS host");
    return [{ address: "8.8.8.8", family: 4 }];
  });
  syncBuiltinESMExports();
});
afterEach((context) => { if ("mock" in context) context.mock.restoreAll(); syncBuiltinESMExports(); });

const baseInput: AiGenerateRequest = {
  provider: "deepseek",
  apiKey: "fixture-key",
  baseUrl: "https://provider.example/v1",
  model: "fixture-model",
  messages: [{ role: "user", content: "fixture prompt" }],
};

async function postGenerate(overrides: Partial<AiGenerateRequest> = {}): Promise<Response> {
  return POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseInput, ...overrides }),
  }));
}

async function readSse(response: Response): Promise<Array<Record<string, unknown>>> {
  const source = await response.text();
  return source
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6))
    .filter((data): data is string => Boolean(data))
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

function providerFailure(overrides: Partial<AiProviderFailure> = {}): AiProviderFailure {
  return {
    code: "authentication",
    provider: "deepseek",
    retry: "no",
    httpStatus: 502,
    ...overrides,
  };
}

test("AUD-09 route: fake DNS 拒绝测试域名私网，授权后只执行一次 mock transport", async (context) => {
  let lookups = 0;
  let transports = 0;
  context.mock.method(dns, "lookup", async () => { lookups += 1; return [{ address: "192.168.0.9", family: 4 }]; });
  syncBuiltinESMExports();
  context.mock.method(globalThis, "fetch", async () => {
    transports += 1;
    return Response.json({ choices: [{ message: { content: "controlled fixture" }, finish_reason: "stop" }] });
  });
  const denied = await postGenerate();
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).code, "private_network_confirmation_required");
  assert.equal(transports, 0);
  const allowed = await postGenerate({ providerOptions: { allowPrivateNetwork: "true" } });
  assert.equal(allowed.status, 200);
  assert.equal(lookups, 3, "early validation and bound transport independently authorize the allowed request");
  assert.equal(transports, 1);
});

test("route marks a normal incremental stream complete only after provider completion", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `data: ${JSON.stringify({ id: "chat_1", choices: [{ delta: { content: "Hel" } }] })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
  try {
    const response = await postGenerate({ stream: true });
    const events = await readSse(response);
    assert.equal(response.status, 200);
    assert.deepEqual(events.filter((event) => event.type === "delta").map((event) => event.text), ["Hel"]);
    assert.equal(events.filter((event) => event.type === "done").length, 0);
    const error = events.find((event) => event.type === "error");
    assert.equal((error?.failure as AiProviderFailure).code, "stream_interrupted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const emptyTerminalStreams: Array<{ label: string; overrides: Partial<AiGenerateRequest>; payload: unknown }> = [
  { label: "Responses completed without visible delta", overrides: { provider: "openai" }, payload: { type: "response.completed", response: { id: "resp_empty" } } },
  { label: "Messages stopped without visible delta", overrides: { provider: "anthropic" }, payload: { type: "message_stop", message: { id: "msg_empty" } } },
  { label: "Chat finish without visible delta", overrides: { provider: "deepseek" }, payload: { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } } },
  { label: "Gemini GenerateContent EOF without visible delta", overrides: { provider: "google", model: "gemini-2.5-flash-lite", generationProtocol: "google_generate_content" }, payload: { candidates: [] } },
  { label: "Google Interactions completed without visible delta", overrides: { provider: "google", model: "gemini-3.5-flash", generationProtocol: "google_interactions" }, payload: { type: "interaction.completed", interaction: { id: "interaction_empty" } } },
];

test("provider completion without visible stream output is malformed, not a successful done event", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const fixture of emptyTerminalStreams) {
      globalThis.fetch = async () => new Response(`data: ${JSON.stringify(fixture.payload)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      const response = await postGenerate({ ...fixture.overrides, stream: true });
      const events = await readSse(response);
      assert.equal(response.status, 200, fixture.label);
      assert.equal(events.some((event) => event.type === "done"), false, fixture.label);
      assert.equal((events.find((event) => event.type === "error")?.failure as AiProviderFailure).code, "malformed_response", fixture.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route maps provider HTTP failures to typed local failures without exposing upstream text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: {
      code: "apiKey=fixture-key",
      type: "invalid_api_key",
      message: "apiKey=fixture-key Authorization: Bearer secret prompt=fixture prompt",
    },
  }, { status: 401, headers: { "x-request-id": "upstream-auth" } });
  try {
    const response = await postGenerate();
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 502);
    assert.equal(payload.code, "authentication");
    assert.equal((payload.failure as AiProviderFailure).code, "authentication");
    assert.equal((payload.failure as AiProviderFailure).requestId, "upstream-auth");
    assert.equal(JSON.stringify(payload).includes("fixture-key"), false);
    assert.equal(JSON.stringify(payload).includes("secret"), false);
    assert.equal(JSON.stringify(payload).includes("fixture prompt"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route preserves retry-after metadata while keeping retry policy explicit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { type: "rate_limit_error" } }, {
    status: 429,
    headers: { "retry-after": "2" },
  });
  try {
    const response = await postGenerate();
    const payload = await response.json() as { retryable: boolean; failure: AiProviderFailure };
    assert.equal(response.status, 502);
    assert.equal(payload.failure.code, "rate_limit");
    assert.equal(payload.failure.retry, "after-delay");
    assert.equal(payload.failure.retryAfterMs, 2000);
    assert.equal(payload.retryable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route separates malformed provider responses from capability contract failures", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ choices: "malformed" });
  };
  try {
    const malformedResponse = await postGenerate();
    const malformed = await malformedResponse.json() as { failure?: AiProviderFailure };
    assert.equal(malformedResponse.status, 502);
    assert.equal(malformed.failure?.code, "malformed_response");

    const capabilityResponse = await postGenerate({
      provider: "google",
      model: "gemini-2.5-flash-lite",
      generationProtocol: "google_generate_content",
      runtime: { reasoning: 511 },
    });
    const capability = await capabilityResponse.json() as { code?: string; failure?: AiProviderFailure };
    assert.equal(capabilityResponse.status, 400);
    assert.equal(capability.code, "invalid-runtime-value");
    assert.equal("failure" in capability, false);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("route distinguishes empty visible output from an invalid provider response shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ message: {} }] });
  try {
    const emptyResponse = await postGenerate();
    const empty = await emptyResponse.json() as { message?: string; failure?: AiProviderFailure };
    assert.equal(emptyResponse.status, 502);
    assert.equal(empty.failure?.providerCode, "empty_visible_output");
    assert.equal(empty.message, "模型未返回可见文本");

    globalThis.fetch = async () => Response.json({ choices: "malformed" });
    const malformedResponse = await postGenerate();
    const malformed = await malformedResponse.json() as { message?: string; failure?: AiProviderFailure };
    assert.equal(malformedResponse.status, 502);
    assert.equal(malformed.failure?.providerCode, "invalid_response_shape");
    assert.equal(malformed.message, "AI 服务返回格式异常");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("client reconstructs typed provider failures and does not treat stream interruption as success", async () => {
  const originalFetch = globalThis.fetch;
  const streamFailureCodes: Array<"stream_interrupted" | "malformed_response"> = ["stream_interrupted", "malformed_response"];
  globalThis.fetch = async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as { stream?: boolean };
    if (requestBody.stream) {
      const code = streamFailureCodes.shift() ?? "malformed_response";
      return new Response(`data: ${JSON.stringify({
        type: "error",
        message: "safe message",
        failure: providerFailure({ code, retry: code === "stream_interrupted" ? "manual-only" : "no" }),
      })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      code: "authentication",
      message: "safe message",
      retryable: false,
      failure: providerFailure(),
    }, { status: 502 });
  };
  try {
    await assert.rejects(() => callAiGenerate(baseInput), (error: unknown) => {
      return error instanceof AiProviderFailureError && error.failure.code === "authentication";
    });
    await assert.rejects(async () => {
      for await (const event of callAiGenerateStream({ ...baseInput, stream: true })) {
        assert.equal(event.type, "status");
      }
    }, (error: unknown) => {
      return error instanceof AiProviderFailureError && error.failure.code === "stream_interrupted";
    });
    await assert.rejects(async () => {
      for await (const event of callAiGenerateStream({ ...baseInput, stream: true })) {
        assert.equal(event.type, "status");
      }
    }, (error: unknown) => {
      return error instanceof AiProviderFailureError && error.failure.code === "malformed_response";
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
