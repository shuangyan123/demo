import type { AiSpeechRequest } from "../../../services/api-client";
import { buildSpeechProviderRequest, parseSpeechJsonResponse } from "../../../server/ai/provider-adapter.ts";
import {
  RouteSecurityError,
  apiErrorResponse,
  createRequestId,
  readRouteJson,
  validateOutboundHttpUrl,
} from "../../../server/http/route-security.ts";

const MAX_SPEECH_REQUEST_BYTES = 512 * 1024;

// 校验语音请求，限制必须存在的连接、音色和文本字段。
function isSpeechRequest(value: unknown): value is AiSpeechRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiSpeechRequest>;
  const hasValidKey = input.provider === "custom" || Boolean(input.apiKey);
  return Boolean(input.provider && hasValidKey && input.baseUrl && (input.provider === "azure" || input.model) && input.voiceId && input.text?.trim());
}

// 代理云端 TTS 并统一返回 MP3 字节；原始音频不会写入服务端或 IndexedDB。
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const body = await readRouteJson(request, MAX_SPEECH_REQUEST_BYTES);
    if (!isSpeechRequest(body)) {
      return apiErrorResponse(
        new RouteSecurityError("invalid_speech_request", "缺少有效的语音连接、音色或文本", 400),
        { code: "invalid_speech_request", message: "语音请求无效", status: 400 },
      );
    }
    validateOutboundHttpUrl(body.baseUrl);
    const providerRequest = buildSpeechProviderRequest(body);
    const response = await fetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: typeof providerRequest.body === "string" ? providerRequest.body : JSON.stringify(providerRequest.body),
      cache: "no-store",
    });
    if (!response.ok) {
      return apiErrorResponse(
        new RouteSecurityError("speech_provider_failed", `语音厂商请求失败（${response.status}）`, response.status, response.status >= 429),
        { code: "speech_provider_failed", message: "语音厂商请求失败", status: response.status },
      );
    }
    if (providerRequest.parseMode === "binary") {
      return new Response(await response.arrayBuffer(), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": response.headers.get("content-type") || "audio/mpeg",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": requestId,
        },
      });
    }
    const payload: unknown = await response.json();
    const bytes = await parseSpeechJsonResponse(providerRequest.parseMode, payload);
    // 裁剪出当前视图对应的独立 ArrayBuffer，避免 Uint8Array<ArrayBufferLike> 与 Response BodyInit 类型冲突。
    const audioBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(audioBuffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": providerRequest.parseMode === "google_pcm" ? "audio/wav" : "audio/mpeg",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      code: "speech_request_failed",
      message: "语音 API 请求失败",
      status: 500,
      retryable: true,
    }, requestId);
  }
}
