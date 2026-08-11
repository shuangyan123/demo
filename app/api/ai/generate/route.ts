import type { AiGenerateRequest, AiGenerateResult, AiGenerateStreamEvent } from "../../../services/api-client";
import { getProviderAdapter } from "../../../server/ai/provider-adapter-registry.ts";
import { executeProviderGenerate } from "../../../server/ai/execute-provider-generate.ts";
import { AiProviderFailureError, aiProviderFailureMessage, type AiProviderFailure } from "../../../services/ai-provider-failure.ts";
import {
  RouteSecurityError,
  apiErrorResponse,
  apiJsonResponse,
  createRequestId,
  readRouteJson,
} from "../../../server/http/route-security.ts";
import { networkPolicyFromProviderOptions, validateOutboundNetworkTarget } from "../../../server/http/outbound-network-policy.ts";
import { AiCapabilityContractError } from "../../../types/domains/ai-capability.ts";
import { classifyProviderStreamFailure, classifyProviderTransportFailure, providerFailureStreamEvent, requireVisibleGenerateContent } from "../../../server/ai/provider-failure.ts";

const MAX_GENERATE_REQUEST_BYTES = 20 * 1024 * 1024;

// 校验统一生成请求的最小字段，避免把任意 URL 或空密钥转发到外部服务。
function isGenerateRequest(value: unknown): value is AiGenerateRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiGenerateRequest>;
  const hasValidKey = input.provider === "custom" || Boolean(input.apiKey);
  return Boolean(input.provider && hasValidKey && input.baseUrl && input.model && Array.isArray(input.messages));
}

function encodeSse(event: AiGenerateStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function providerFailureResponse(failure: AiProviderFailure, routeRequestId: string): Response {
  const message = aiProviderFailureMessage(failure.code);
  const retryable = failure.retry === "safe" || failure.retry === "after-delay";
  return apiErrorResponse(
    new RouteSecurityError(failure.code, message, 502, retryable),
    { code: failure.code, message, status: 502, retryable, failure },
    routeRequestId,
  );
}

async function pipeProviderStream(body: AiGenerateRequest, response: Response, routeRequestId: string, signal: AbortSignal): Promise<Response> {
  const adapter = getProviderAdapter(body.provider);
  if (!response.body) {
    return providerFailureResponse({ code: "provider_unavailable", provider: body.provider, retry: "after-delay" }, routeRequestId);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finalUsage: AiGenerateResult["usage"];
  let providerRequestId: string | undefined;
  let actualSpeed: string | undefined;
  let completed = false;
  const completion = adapter.streamCompletion(body);
  const consumeEvent = (event: AiGenerateStreamEvent, controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (event.type === "delta") content += event.text;
    if (event.type === "usage") {
      finalUsage = event.usage ?? finalUsage;
      providerRequestId = event.requestId ?? providerRequestId;
      actualSpeed = event.actualSpeed ?? actualSpeed;
    }
    if (event.type === "done") {
      completed = true;
      finalUsage = event.usage ?? finalUsage;
      providerRequestId = event.requestId ?? providerRequestId;
      actualSpeed = event.actualSpeed ?? actualSpeed;
      return;
    }
    controller.enqueue(encodeSse(event));
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeSse({ type: "status", message: "已连接厂商，正在等待模型输出" }));
      const processChunk = (chunk: string) => {
        const dataLines = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
        if (!dataLines.length) return;
        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          if (completion === "sentinel") completed = true;
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data) as unknown;
        } catch {
          throw new AiProviderFailureError({ code: "malformed_response", provider: body.provider, retry: "no" });
        }
        for (const event of adapter.parseStream(body, payload, response.headers)) consumeEvent(event, controller);
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) processChunk(chunk);
        }
        buffer += decoder.decode();
        if (buffer.trim()) processChunk(buffer);
        if (completion === "eof") completed = true;
        if (!completed) throw new AiProviderFailureError({ code: "stream_interrupted", provider: body.provider, retry: "manual-only" });
        const visibleContent = requireVisibleGenerateContent(body, response.headers, content, providerRequestId);
        controller.enqueue(encodeSse({ type: "done", content: visibleContent, requestId: providerRequestId, usage: finalUsage, actualSpeed }));
      } catch (error) {
        const failure = error instanceof AiProviderFailureError
          ? error.failure
          : classifyProviderStreamFailure(body, error, signal);
        controller.enqueue(encodeSse(providerFailureStreamEvent(failure, routeRequestId)));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": routeRequestId,
    },
  });
}

// 代理文本、视觉和结构化输出请求；Key 只存在于本次请求内存，不在服务端持久化。
export async function POST(request: Request) {
  const requestId = createRequestId();
  let body: AiGenerateRequest | undefined;
  try {
    const parsedBody = await readRouteJson(request, MAX_GENERATE_REQUEST_BYTES);
    if (!isGenerateRequest(parsedBody)) {
      return apiErrorResponse(
        new RouteSecurityError("invalid_ai_request", "缺少有效的 AI 连接或消息内容", 400),
        { code: "invalid_ai_request", message: "AI 请求无效", status: 400 },
        requestId,
      );
    }
    body = parsedBody;
    await validateOutboundNetworkTarget(body.baseUrl, networkPolicyFromProviderOptions(body.providerOptions));
    const adapter = getProviderAdapter(body.provider);
    const executed = await executeProviderGenerate(body, { signal: request.signal });
    const effectiveBody = executed.body;
    const response = executed.response;
    if (!response.ok) {
      return providerFailureResponse(await adapter.parseFailure(effectiveBody, response), requestId);
    }
    if (effectiveBody.stream) return pipeProviderStream(effectiveBody, response, requestId, request.signal);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiProviderFailureError({ code: "malformed_response", provider: effectiveBody.provider, retry: "no" });
    }
    return apiJsonResponse(adapter.parseGenerate(effectiveBody, payload, response.headers), { requestId });
  } catch (error) {
    if (error instanceof AiCapabilityContractError) {
      return apiErrorResponse(
        new RouteSecurityError(error.code, error.message, 400),
        { code: error.code, message: error.message, status: 400 },
        requestId,
      );
    }
    if (error instanceof RouteSecurityError) {
      return apiErrorResponse(error, { code: error.code, message: error.message, status: error.status, retryable: error.retryable }, requestId);
    }
    if (error instanceof AiProviderFailureError) return providerFailureResponse(error.failure, requestId);
    if (body) return providerFailureResponse(classifyProviderTransportFailure(body, error, request.signal), requestId);
    return apiErrorResponse(error, {
      code: "ai_generate_failed",
      message: error instanceof Error && error.message.includes("URL") ? "API 地址无效" : "AI API 请求失败",
      status: 500,
      retryable: false,
    }, requestId);
  }
}
