import type { ApiProvider } from "../types/domains/ai-provider.ts";

export const aiProviderFailureCodes = [
  "authentication",
  "permission",
  "invalid_request",
  "model_not_found",
  "rate_limit",
  "quota_exhausted",
  "provider_unavailable",
  "network",
  "timeout",
  "cancelled",
  "malformed_response",
  "stream_interrupted",
  "unknown",
] as const;

export type AiProviderFailureCode = (typeof aiProviderFailureCodes)[number];
export type AiProviderFailureRetry = "safe" | "after-delay" | "manual-only" | "no";

export type AiProviderFailure = {
  code: AiProviderFailureCode;
  provider: ApiProvider;
  retry: AiProviderFailureRetry;
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  retryAfterMs?: number;
};

const providerValues = new Set<string>([
  "openai", "azure_openai", "google", "anthropic", "xai", "deepseek", "qwen", "openrouter", "groq", "mistral",
  "elevenlabs", "azure", "minimax", "zhipu", "kimi", "doubao", "siliconflow", "baidu", "tencent", "custom",
]);
const failureCodeValues = new Set<string>(aiProviderFailureCodes);
const retryValues = new Set<AiProviderFailureRetry>(["safe", "after-delay", "manual-only", "no"]);

/** 将稳定失败分类转换成不会泄漏厂商原文的产品提示。 */
export function aiProviderFailureMessage(code: AiProviderFailureCode, providerCode?: string): string {
  if (code === "malformed_response" && providerCode === "empty_visible_output") return "模型未返回可见文本";
  switch (code) {
    case "authentication": return "AI 连接鉴权失败，请检查密钥";
    case "permission": return "当前连接无权访问所选模型";
    case "invalid_request": return "AI 请求参数与所选模型不兼容";
    case "model_not_found": return "模型或 API 地址不存在，请刷新模型目录后重试";
    case "rate_limit": return "请求已被限流，请稍后再试";
    case "quota_exhausted": return "AI 配额或余额不足，请检查额度或切换连接";
    case "provider_unavailable": return "AI 服务暂时不可用，请稍后再试";
    case "network": return "无法连接 AI 服务，请检查网络";
    case "timeout": return "AI 服务响应超时，请稍后再试";
    case "cancelled": return "AI 请求已取消";
    case "malformed_response": return "AI 服务返回格式异常";
    case "stream_interrupted": return "AI 流式响应中断，已接收内容尚未完成";
    case "unknown": return "AI 请求失败，请稍后再试";
  }
}

/** 仅把可公开的稳定字段重建为客户端可消费的失败对象。 */
export function isAiProviderFailure(value: unknown): value is AiProviderFailure {
  if (!value || typeof value !== "object") return false;
  const failure = value as Partial<AiProviderFailure>;
  return typeof failure.code === "string"
    && failureCodeValues.has(failure.code)
    && typeof failure.provider === "string"
    && providerValues.has(failure.provider)
    && typeof failure.retry === "string"
    && retryValues.has(failure.retry)
    && (failure.httpStatus === undefined || (typeof failure.httpStatus === "number" && Number.isInteger(failure.httpStatus)))
    && (failure.providerCode === undefined || typeof failure.providerCode === "string")
    && (failure.requestId === undefined || typeof failure.requestId === "string")
    && (failure.retryAfterMs === undefined || (typeof failure.retryAfterMs === "number" && Number.isFinite(failure.retryAfterMs)));
}

export class AiProviderFailureError extends Error {
  readonly failure: AiProviderFailure;

  constructor(failure: AiProviderFailure, _message?: string) {
    // 忽略兼容调用方传入的原始文案，typed failure 的 Error.message 也必须保持可公开安全。
    super(aiProviderFailureMessage(failure.code, failure.providerCode));
    void _message;
    this.name = "AiProviderFailureError";
    this.failure = failure;
  }

  get recoveryDiagnosis() {
    const networkFailure = this.failure.code === "network"
      || this.failure.code === "timeout"
      || this.failure.code === "stream_interrupted";
    return networkFailure
      ? { category: "network" as const, recoveryAction: "check_network" as const }
      : { category: "model" as const, recoveryAction: "configure_ai_connection" as const };
  }
}
