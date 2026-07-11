import { NextResponse } from "next/server";
import type { AiGenerateRequest, AiGenerateResult, AiGenerateStreamEvent } from "../../../services/api-client";
import { buildGenerateProviderRequest, parseGenerateProviderResponse, parseGenerateProviderStreamEvent } from "../../../server/ai/provider-adapter.ts";

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
function providerFailureMessage(status: number): string {
  if (status === 401 || status === 403) return "API 鉴权失败，请检查连接密钥和权限";
  if (status === 404) return "模型或 API 地址不存在，请刷新模型目录后重新选择";
  if (status === 408 || status === 504) return "厂商响应超时，请稍后重试";
  if (status === 413 || status === 422) return "请求内容超出模型限制或参数不兼容";
  if (status === 429) return "请求已被限流，请稍后重试或切换模型";
  if (status === 503) return "模型暂时满载，请切换模型或稍后再试";
  return `厂商 API 请求失败（${status}）`;
}

async function pipeProviderStream(body: AiGenerateRequest, response: Response): Promise<Response> {
  if (!response.body) return new NextResponse("厂商未返回可读取的流", { status: 502 });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finalUsage: AiGenerateResult["usage"];
  let requestId: string | undefined;
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
            const events = parseGenerateProviderStreamEvent(body, JSON.parse(data) as unknown, response.headers);
            for (const event of events) {
              if (event.type === "delta") content += event.text;
              if (event.type === "usage") {
                finalUsage = event.usage;
                requestId = event.requestId;
              }
              controller.enqueue(encodeSse(event));
            }
          }
        }
        controller.enqueue(encodeSse({ type: "done", content, requestId, usage: finalUsage }));
      } catch (error) {
        controller.enqueue(encodeSse({ type: "error", message: error instanceof Error ? error.message : "流式响应解析失败" }));
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
    },
  });
}

// 代理文本、视觉和结构化输出请求；Key 只存在于本次请求内存，不在服务端持久化。
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isGenerateRequest(body)) return new NextResponse("缺少有效的 AI 连接或消息内容", { status: 400 });
    const providerRequest = buildGenerateProviderRequest(body);
    const response = await fetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: JSON.stringify(providerRequest.body),
      cache: "no-store",
    });
    if (!response.ok) {
      return new NextResponse(providerFailureMessage(response.status), { status: response.status });
    }
    if (body.stream) return pipeProviderStream(body, response);
    const payload: unknown = await response.json();
    return NextResponse.json(parseGenerateProviderResponse(body, payload, response.headers));
  } catch (error) {
    const message = error instanceof Error && error.message.includes("URL") ? "API 地址无效" : "AI API 请求失败";
    return new NextResponse(message, { status: 500 });
  }
}
