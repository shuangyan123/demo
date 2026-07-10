import type { AiModelsResult } from "./api-client";
import type { ApiProvider } from "../types/review";

const CACHE_PREFIX = "review_provider_models_v1";
const CACHE_TTL = 24 * 60 * 60 * 1000;

function key(provider: ApiProvider, baseUrl: string): string {
  return `${CACHE_PREFIX}:${provider}:${baseUrl.replace(/\/+$/, "")}`;
}

/** 模型缓存只保存公开目录，不保存 Key、请求头或厂商原始响应。 */
export const providerModelCache = {
  load(provider: ApiProvider, baseUrl: string): AiModelsResult | undefined {
    if (typeof window === "undefined") return undefined;
    try {
      const raw = window.localStorage.getItem(key(provider, baseUrl));
      if (!raw) return undefined;
      const value = JSON.parse(raw) as AiModelsResult;
      if (Date.now() - new Date(value.fetchedAt).getTime() > CACHE_TTL) return undefined;
      return value;
    } catch {
      return undefined;
    }
  },
  save(provider: ApiProvider, baseUrl: string, value: AiModelsResult): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key(provider, baseUrl), JSON.stringify(value));
  },
};
