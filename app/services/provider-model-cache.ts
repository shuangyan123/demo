import type { AiGenerationProtocol } from "../types/domains/ai-model";
import type { AiModelsResult } from "./api-client";
import type { ApiProvider } from "../types/domains/ai-provider";

// v4 使错误的 Google Interactions 路径和不完整分页目录立即失效。
const CACHE_PREFIX = "review_provider_models_v4";
export const PROVIDER_MODEL_CACHE_TTL = 24 * 60 * 60 * 1000;

export function normalizeProviderBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function key(connectionId: string, provider: ApiProvider, baseUrl: string): string {
  return `${CACHE_PREFIX}:${connectionId}:${provider}:${normalizeProviderBaseUrl(baseUrl)}`;
}

/** 模型缓存只保存公开目录，不保存 Key、请求头或厂商原始响应。 */
export const providerModelCache = {
  load(connectionId: string, provider: ApiProvider, baseUrl: string): AiModelsResult | undefined {
    if (typeof window === "undefined") return undefined;
    try {
      const raw = window.localStorage.getItem(key(connectionId, provider, baseUrl));
      if (!raw) return undefined;
      const value = JSON.parse(raw) as AiModelsResult;
      return value;
    } catch {
      return undefined;
    }
  },
  /** 返回缓存及其过期状态，避免调用方把静态兜底误认为在线目录。 */
  inspect(connectionId: string, provider: ApiProvider, baseUrl: string): { value?: AiModelsResult; stale: boolean } {
    const value = this.load(connectionId, provider, baseUrl);
    return { value, stale: value ? this.isStale(value) : true };
  },
  save(connectionId: string, provider: ApiProvider, baseUrl: string, value: AiModelsResult): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key(connectionId, provider, baseUrl), JSON.stringify(value));
  },
  /** 仅保存连接测试明确学到的协议，不保存请求或响应正文。 */
  rememberProtocol(connectionId: string, provider: ApiProvider, baseUrl: string, modelId: string, protocol: AiGenerationProtocol): void {
    if (typeof window === "undefined" || provider !== "google") return;
    const current = this.load(connectionId, provider, baseUrl) ?? { models: [], fetchedAt: new Date().toISOString() };
    const existing = current.models.find((model) => model.id === modelId);
    const learned = existing
      ? { ...existing, generationProtocol: protocol }
      : {
          id: modelId,
          label: modelId,
          purposes: ["text" as const],
          capabilities: ["text" as const, "structured_output" as const, "streaming" as const],
          status: "unknown" as const,
          source: "static_catalog" as const,
          capabilitySource: "unknown" as const,
          generationProtocol: protocol,
          supportsStreaming: true,
          supportsStructuredOutput: true,
          updatedAt: new Date().toISOString(),
        };
    this.save(connectionId, provider, baseUrl, {
      ...current,
      models: [...current.models.filter((model) => model.id !== modelId), learned],
      fetchedAt: new Date().toISOString(),
    });
  },
  isStale(value: AiModelsResult): boolean {
    return Date.now() - new Date(value.fetchedAt).getTime() > PROVIDER_MODEL_CACHE_TTL;
  },
};
