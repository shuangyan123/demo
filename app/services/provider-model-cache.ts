import type { AiModelsResult } from "./api-client";
import type { ApiProvider } from "../types/domains/ai-provider";

const CACHE_PREFIX = "review_provider_models_v2";
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
  save(connectionId: string, provider: ApiProvider, baseUrl: string, value: AiModelsResult): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key(connectionId, provider, baseUrl), JSON.stringify(value));
  },
  isStale(value: AiModelsResult): boolean {
    return Date.now() - new Date(value.fetchedAt).getTime() > PROVIDER_MODEL_CACHE_TTL;
  },
};
