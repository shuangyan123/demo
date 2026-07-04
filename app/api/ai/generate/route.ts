import { NextResponse } from "next/server";
import type { AiGenerateRequest } from "../../../services/api-client";
import { buildGenerateProviderRequest, parseGenerateProviderResponse } from "../../../server/ai/provider-adapter.ts";

// 校验统一生成请求的最小字段，避免把任意 URL 或空密钥转发到外部服务。
function isGenerateRequest(value: unknown): value is AiGenerateRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiGenerateRequest>;
  const hasValidKey = input.provider === "custom" || Boolean(input.apiKey);
  return Boolean(input.provider && hasValidKey && input.baseUrl && input.model && Array.isArray(input.messages));
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
      return new NextResponse(`厂商 API 请求失败（${response.status}）`, { status: response.status });
    }
    const payload: unknown = await response.json();
    return NextResponse.json(parseGenerateProviderResponse(body, payload, response.headers));
  } catch (error) {
    const message = error instanceof Error && error.message.includes("URL") ? "API 地址无效" : "AI API 请求失败";
    return new NextResponse(message, { status: 500 });
  }
}
