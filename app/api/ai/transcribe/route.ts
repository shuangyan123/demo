import { policyFetch } from "../../../server/http/policy-fetch.ts";
import type { AiTranscriptionRequest } from "../../../services/api-client";
import { buildTranscriptionProviderRequest, parseTranscriptionProviderResponse } from "../../../server/ai/provider-adapter.ts";
import {
  RouteSecurityError,
  apiErrorResponse,
  apiJsonResponse,
  readRouteJson,
} from "../../../server/http/route-security.ts";
import { networkPolicyFromProviderOptions, validateOutboundNetworkTarget } from "../../../server/http/outbound-network-policy.ts";

const MAX_TRANSCRIPTION_REQUEST_BYTES = 17 * 1024 * 1024;

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
    const body = await readRouteJson(request, MAX_TRANSCRIPTION_REQUEST_BYTES);
    if (!isTranscriptionRequest(body)) {
      return apiErrorResponse(
        new RouteSecurityError("invalid_transcription_request", "缺少有效的 Google Gemini 转写请求", 400),
        { code: "invalid_transcription_request", message: "转写请求无效", status: 400 },
      );
    }
    await validateOutboundNetworkTarget(body.baseUrl, networkPolicyFromProviderOptions(body.providerOptions));
    const providerRequest = buildTranscriptionProviderRequest(body);
    const response = await policyFetch(providerRequest.url, {
      method: "POST",
      headers: providerRequest.headers,
      body: JSON.stringify(providerRequest.body),
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    }, networkPolicyFromProviderOptions(body.providerOptions));
    if (!response.ok) {
      return apiErrorResponse(
        new RouteSecurityError("transcription_provider_failed", "Gemini 转写请求失败", response.status, response.status >= 429),
        { code: "transcription_provider_failed", message: "Gemini 转写请求失败", status: response.status },
      );
    }
    return apiJsonResponse(parseTranscriptionProviderResponse(await response.json(), response.headers));
  } catch (error) {
    return apiErrorResponse(error, {
      code: "transcription_failed",
      message: "录音转写失败",
      status: 500,
      retryable: true,
    });
  }
}
