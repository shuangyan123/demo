import type { AiGenerateRequest, AiGenerateStreamEvent } from "../../services/api-client.ts";
import {
  AiProviderFailureError,
  aiProviderFailureMessage,
  type AiProviderFailure,
  type AiProviderFailureCode,
} from "../../services/ai-provider-failure.ts";

const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function safeProviderCode(value: unknown): string | undefined {
  const candidate = stringValue(value)?.replace(/[\u0000-\u001f\u007f\s]+/g, "_").slice(0, 80);
  return candidate && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(candidate) ? candidate : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = stringValue(value);
    if (candidate) return candidate;
  }
  return undefined;
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_PROVIDER_ERROR_BYTES) {
        await reader.cancel();
        return "";
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

async function safeErrorPayload(response: Response): Promise<JsonRecord> {
  try {
    const text = await readBoundedText(response.clone());
    return text ? asRecord(JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function retryFor(code: AiProviderFailureCode): AiProviderFailure["retry"] {
  if (code === "rate_limit" || code === "provider_unavailable") return "after-delay";
  if (code === "network" || code === "timeout" || code === "stream_interrupted" || code === "unknown" || code === "quota_exhausted") return "manual-only";
  return "no";
}

function explicitFailureCode(values: string[], status: number): AiProviderFailureCode {
  const normalized = values.map((value) => value.toLowerCase().replace(/[-\s]/g, "_"));
  if (normalized.some((value) => /invalid_api_key|authentication_error|unauthenticated|invalid_auth|auth_failed/.test(value))) return "authentication";
  if (normalized.some((value) => /permission|forbidden|access_denied|permission_denied|model_permission/.test(value))) return "permission";
  if (normalized.some((value) => /model_not_found|unknown_model|model_missing|not_found/.test(value))) return "model_not_found";
  if (normalized.some((value) => /insufficient_quota|quota_exhausted|credit_balance|spend_limit|usage_limit|insufficient_balance|billing_error|quota/.test(value))) return "quota_exhausted";
  if (normalized.some((value) => /rate_limit|rate_limited|too_many_requests|throttl|resource_exhausted/.test(value))) return "rate_limit";
  if (normalized.some((value) => /invalid_request|invalid_argument|invalid_parameter|bad_request|unprocessable/.test(value))) return "invalid_request";
  if (normalized.some((value) => /overloaded|unavailable|service_unavailable|internal_error|server_error|api_error/.test(value))) return "provider_unavailable";

  if (status === 401) return "authentication";
  if (status === 402) return "quota_exhausted";
  if (status === 403) return "permission";
  if (status === 404) return "model_not_found";
  if (status === 408) return "timeout";
  if (status === 400 || status === 413 || status === 422) return "invalid_request";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "provider_unavailable";
  return "unknown";
}

function providerRequestId(payload: JsonRecord, error: JsonRecord, response: Response): string | undefined {
  return firstString(
    response.headers.get("x-request-id"),
    response.headers.get("request-id"),
    response.headers.get("x-goog-request-id"),
    payload.request_id,
    payload.requestId,
    error.request_id,
    error.requestId,
    payload.id,
  );
}

/** 只读取有界、安全字段；完整错误正文不离开 provider boundary。 */
export async function parseProviderFailure(input: AiGenerateRequest, response: Response): Promise<AiProviderFailure> {
  const payload = await safeErrorPayload(response);
  const error = asRecord(payload.error);
  const baseResponse = asRecord(payload.base_resp);
  const providerCodes = [
    error.code,
    error.type,
    error.status,
    error.error_code,
    baseResponse.status_code,
    payload.code,
    payload.error_code,
    payload.status,
  ].map(safeProviderCode).filter((value): value is string => Boolean(value) && value !== "error");
  const code = explicitFailureCode(providerCodes, response.status);
  const failure: AiProviderFailure = {
    code,
    provider: input.provider,
    retry: retryFor(code),
    httpStatus: response.status,
    providerCode: providerCodes[0],
    requestId: providerRequestId(payload, error, response),
    retryAfterMs: retryAfterMs(response),
  };
  return Object.fromEntries(Object.entries(failure).filter(([, value]) => value !== undefined)) as AiProviderFailure;
}

export function malformedProviderResponse(input: AiGenerateRequest, headers: Headers, providerCode = "invalid_response_shape"): AiProviderFailureError {
  return new AiProviderFailureError({
    code: "malformed_response",
    provider: input.provider,
    retry: "no",
    providerCode,
    requestId: headers.get("x-request-id") ?? headers.get("request-id") ?? undefined,
  });
}

/** 当前 text/vision/JSON consumers 只有在拿到可消费的可见终态内容时才能完成一轮生成。 */
export function requireVisibleGenerateContent(input: AiGenerateRequest, headers: Headers, content: string, requestId?: string): string {
  if (content.trim()) return content;
  throw new AiProviderFailureError({
    code: "malformed_response",
    provider: input.provider,
    retry: "no",
    providerCode: "empty_visible_output",
    requestId: requestId ?? headers.get("x-request-id") ?? headers.get("request-id") ?? undefined,
  });
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string" ? error.name : "";
}

/** 请求尚未得到 HTTP 响应时的失败分类；不会把底层异常正文带到上层。 */
export function classifyProviderTransportFailure(input: AiGenerateRequest, error: unknown, signal?: AbortSignal): AiProviderFailure {
  if (error instanceof AiProviderFailureError) return error.failure;
  const code: AiProviderFailureCode = signal?.aborted ? "cancelled" : /TimeoutError|AbortError/i.test(errorName(error)) ? "timeout" : "network";
  return { code, provider: input.provider, retry: retryFor(code) };
}

/** 流已经开始后，非正常断开不能被误认成成功；用户取消和超时仍保持独立分类。 */
export function classifyProviderStreamFailure(input: AiGenerateRequest, error: unknown, signal?: AbortSignal): AiProviderFailure {
  if (error instanceof AiProviderFailureError) return error.failure;
  const name = errorName(error);
  const code: AiProviderFailureCode = signal?.aborted ? "cancelled" : /TimeoutError|AbortError/i.test(name) ? "timeout" : "stream_interrupted";
  return { code, provider: input.provider, retry: retryFor(code) };
}

export function providerFailureStreamEvent(failure: AiProviderFailure, routeRequestId: string): Extract<AiGenerateStreamEvent, { type: "error" }> {
  return {
    type: "error",
    message: aiProviderFailureMessage(failure.code, failure.providerCode),
    code: failure.code,
    requestId: routeRequestId,
    retryable: failure.retry === "safe" || failure.retry === "after-delay",
    failure,
  };
}
