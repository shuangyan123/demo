import { NextResponse } from "next/server";
import type { AiTranscriptionRequest } from "../../../services/api-client";
import { buildTranscriptionProviderRequest, parseTranscriptionProviderResponse } from "../../../server/ai/provider-adapter.ts";

function isTranscriptionRequest(value: unknown): value is AiTranscriptionRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiTranscriptionRequest>;
  return input.provider === "google"
    && typeof input.apiKey === "string"
    && typeof input.baseUrl === "string"
    && typeof input.model === "string"
    && typeof input.mimeType === "string"
    && typeof input.audioBase64 === "string"
    && input.audioBase64.length > 0
    && input.audioBase64.length <= 16_000_000;
}

/** 将临时浏览器录音转交 Gemini；不记录音频、提示词或厂商原始响应。 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isTranscriptionRequest(body)) return new NextResponse("缺少有效的 Google Gemini 转写请求", { status: 400 });
    const providerRequest = buildTranscriptionProviderRequest(body);
    const response = await fetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: JSON.stringify(providerRequest.body),
      cache: "no-store",
    });
    if (!response.ok) return new NextResponse((await response.text()) || "Gemini 转写请求失败", { status: response.status });
    return NextResponse.json(parseTranscriptionProviderResponse(await response.json(), response.headers));
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "录音转写失败", { status: 500 });
  }
}
