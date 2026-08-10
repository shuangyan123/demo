import type { AiGenerateRequest, AiGenerateResult, AiGenerateStreamEvent } from "../../../services/api-client";
import { getProviderAdapter } from "../../../server/ai/provider-adapter-registry.ts";
import { executeProviderGenerate } from "../../../server/ai/execute-provider-generate.ts";
import { miniMaxFailureMessage } from "../../../services/minimax-connection.ts";
import { googleUpstreamFailureMessage } from "../../../server/ai/google-error.ts";
import {
  RouteSecurityError,
  apiErrorResponse,
  apiJsonResponse,
  createRequestId,
  readRouteJson,
} from "../../../server/http/route-security.ts";
import { networkPolicyFromProviderOptions, validateOutboundNetworkTarget } from "../../../server/http/outbound-network-policy.ts";
import { AiCapabilityContractError } from "../../../types/domains/ai-capability.ts";

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

/** 将常见厂商容量状态归一成可行动提示，避免把原始错误正文展示到业务界面。 */
function providerFailureMessage(status: number, body: AiGenerateRequest): string {
  if (body.provider === "minimax") {
    return miniMaxFailureMessage(
      status,
      "generate",
      body.providerOptions?.region === "global" ? "global" : "cn",
      body.providerOptions?.credentialPlan === "token_plan" ? "token_plan" : "pay_as_you_go",
    );
  }
  if (status === 401 || status === 403) return "API 鉴权失败，请检查连接密钥和权限";
  if (status === 404) return "模型或 API 地址不存在，请刷新模型目录后重新选择";
  if (status === 408 || status === 504) return "厂商响应超时，请稍后重试";
  if (status === 413 || status === 422) return "请求内容超出模型限制或参数不兼容";
  if (status === 429) return "请求已被限流，请稍后重试或切换模型";
  if (status === 503) return "模型暂时满载，请切换模型或稍后再试";
  return `厂商 API 请求失败（${status}）`;
}

async function pipeProviderStream(body: AiGenerateRequest, response: Response, routeRequestId: string): Promise<Response> {
  const adapter = getProviderAdapter(body.provider);
  if (!response.body) {
    return apiErrorResponse(
      new RouteSecurityError("provider_stream_missing", "厂商未返回可读取的流", 502, true),
      { code: "provider_stream_missing", message: "厂商未返回可读取的流", status: 502 },
      routeRequestId,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finalUsage: AiGenerateResult["usage"];
  let providerRequestId: string | undefined;
  let actualSpeed: string | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeSse({ type: "status", message: "已连接厂商，正在等待模型输出" }));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const dataLines = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
            if (!dataLines.length) continue;
            const data = dataLines.join("\n");
            if (data === "[DONE]") continue;
            const events = adapter.parseStream(body, JSON.parse(data) as unknown, response.headers);
            for (const event of events) {
              if (event.type === "delta") content += event.text;
              if (event.type === "usage") {
                finalUsage = event.usage;
                providerRequestId = event.requestId;
                actualSpeed = event.actualSpeed ?? actualSpeed;
              }
              controller.enqueue(encodeSse(event));
            }
          }
        }
        controller.enqueue(encodeSse({ type: "done", content, requestId: providerRequestId, usage: finalUsage, actualSpeed }));
      } catch {
        controller.enqueue(encodeSse({
          type: "error",
          code: "provider_stream_parse_failed",
          message: "流式响应解析失败",
          requestId: routeRequestId,
          retryable: true,
        }));
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
  try {
    const body = await readRouteJson(request, MAX_GENERATE_REQUEST_BYTES);
    if (!isGenerateRequest(body)) {
      return apiErrorResponse(
        new RouteSecurityError("invalid_ai_request", "缺少有效的 AI 连接或消息内容", 400),
        { code: "invalid_ai_request", message: "AI 请求无效", status: 400 },
        requestId,
      );
    }
    await validateOutboundNetworkTarget(body.baseUrl, networkPolicyFromProviderOptions(body.providerOptions));
    const adapter = getProviderAdapter(body.provider);
    const executed = await executeProviderGenerate(body, { signal: request.signal });
    const effectiveBody = executed.body;
    const response = executed.response;
    if (!response.ok) {
      const message = body.provider === "google"
        ? await googleUpstreamFailureMessage(response, "接收响应", effectiveBody.generationProtocol ?? "google_generate_content")
        : providerFailureMessage(response.status, body);
      return apiErrorResponse(
        new RouteSecurityError("provider_request_failed", message, response.status, response.status >= 429),
        { code: "provider_request_failed", message, status: response.status },
        requestId,
      );
    }
    if (effectiveBody.stream) return pipeProviderStream(effectiveBody, response, requestId);
    const payload: unknown = await response.json();
    return apiJsonResponse(adapter.parseGenerate(effectiveBody, payload, response.headers), { requestId });
  } catch (error) {
    if (error instanceof AiCapabilityContractError) {
      return apiErrorResponse(
        new RouteSecurityError(error.code, error.message, 400),
        { code: error.code, message: error.message, status: 400 },
        requestId,
      );
    }
    return apiErrorResponse(error, {
      code: "ai_generate_failed",
      message: error instanceof Error && error.message.includes("URL") ? "API 地址无效" : "AI API 请求失败",
      status: 500,
      retryable: true,
    }, requestId);
  }
}
