import type { AiModelDirectoryEntry, AiModelsResult } from "./api-client.ts";
import { listModelsWithConnection, listModelsWithConnectionDraft } from "./ai-connection-client.ts";
import { providerModelCache } from "./provider-model-cache.ts";
import { getProviderContract, getProviderModelCatalog } from "./provider-contracts.ts";
import type { ApiProvider } from "../types/domains/ai-provider.ts";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { AiModelCatalogEntry } from "../types/domains/provider-catalog.ts";

export type ModelCatalogLoadResult = {
  models: AiModelCatalogEntry[];
  directory?: AiModelsResult;
  source: "live" | "cache" | "fallback";
  fetchedAt?: string;
  stale: boolean;
  complete: boolean;
};

const inFlightDirectories = new Map<string, Promise<AiModelsResult>>();

/** 同一连接的多个默认能力并行加载时复用一次官方目录请求。 */
async function fetchSharedDirectory(connection: ApiConnectionProfile, forceRefresh: boolean): Promise<AiModelsResult> {
  const key = `${connection.id}:${connection.provider}:${connection.baseUrl}`;
  const existing = !forceRefresh ? inFlightDirectories.get(key) : undefined;
  if (existing) return existing;
  const pending = listModelsWithConnection(connection);
  inFlightDirectories.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightDirectories.get(key) === pending) inFlightDirectories.delete(key);
  }
}

/** 把公开在线目录归一为设置页和对话选择器共用的模型条目。 */
function toCatalogEntry(connection: Pick<ApiConnectionProfile, "provider">, model: AiModelDirectoryEntry, purpose?: AiConnectionPurpose): AiModelCatalogEntry {
  const fallback = getProviderModelCatalog(connection.provider, undefined, true).find((entry) => entry.id === model.id);
  const deprecated = fallback?.lifecycle === "deprecated" || model.status === "deprecated";
  return {
    id: model.id,
    label: model.label,
    provider: connection.provider,
    purposes: purpose ? [purpose] : model.purposes,
    capabilities: model.capabilities,
    status: model.status === "preview" ? "preview" : deprecated ? "deprecated" : "stable",
    source: "official_live",
    capabilitySource: model.capabilitySource,
    supportedGenerationMethods: model.supportedGenerationMethods,
    generationProtocol: model.generationProtocol,
    family: model.family,
    generation: model.generation,
    modalityGroup: model.modalityGroup,
    lifecycle: deprecated ? "deprecated" : model.status === "preview" ? "preview" : "active",
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    documentationUrl: fallback?.documentationUrl,
    verifiedAt: fallback?.verifiedAt ?? model.updatedAt.slice(0, 10),
  };
}

function catalogFromDirectory(connection: Pick<ApiConnectionProfile, "provider">, directory: AiModelsResult, purpose?: AiConnectionPurpose): AiModelCatalogEntry[] {
  const online = directory.models
    .filter((model) => !purpose || model.purposes.includes(purpose))
    .map((model) => toCatalogEntry(connection, model, purpose));
  // Google Models API 不保证列出 Interactions-only 模型；MiniMax 目录也需保留已核验 M3。
  const verified = ["google", "minimax"].includes(connection.provider)
    ? getProviderModelCatalog(connection.provider, purpose, true)
    : [];
  const merged = new Map(verified.map((model) => [model.id, model]));
  for (const model of online) {
    const descriptor = merged.get(model.id);
    merged.set(model.id, {
      ...descriptor,
      ...model,
      capabilities: descriptor?.capabilities ?? model.capabilities,
      purposes: descriptor?.purposes ?? model.purposes,
      capabilitySource: descriptor ? "verified" : model.capabilitySource,
      documentationUrl: descriptor?.documentationUrl ?? model.documentationUrl,
      verifiedAt: descriptor?.verifiedAt ?? model.verifiedAt,
      generationProtocol: descriptor?.generationProtocol ?? model.generationProtocol,
    });
  }
  return [...merged.values()];
}

/** 同步读取共享缓存；默认能力选择和对话菜单由此看到同一份在线目录。 */
export function inspectConnectionModelCatalog(connection: ApiConnectionProfile, purpose?: AiConnectionPurpose): ModelCatalogLoadResult {
  const cached = providerModelCache.inspect(connection.id, connection.provider, connection.baseUrl);
  if (cached.value && !cached.stale) {
    const models = catalogFromDirectory(connection, cached.value, purpose);
    if (models.length) return {
      models,
      directory: cached.value,
      source: "cache",
      fetchedAt: cached.value.fetchedAt,
      stale: false,
      complete: cached.value.complete !== false,
    };
  }
  return { models: getProviderModelCatalog(connection.provider, purpose), source: "fallback", stale: true, complete: false };
}

/** @deprecated 使用 inspectConnectionModelCatalog 读取来源明确的首帧目录。 */
export function getCachedConnectionModelCatalog(connection: ApiConnectionProfile, purpose?: AiConnectionPurpose): AiModelCatalogEntry[] {
  return inspectConnectionModelCatalog(connection, purpose).models;
}

/**
 * 加载已保存连接的模型目录。
 * 手动刷新 forceRefresh=true 时绕过 24 小时缓存，在线失败仍保留可用回退。
 */
export async function loadConnectionModelCatalog(connection: ApiConnectionProfile, purpose?: AiConnectionPurpose, forceRefresh = false): Promise<ModelCatalogLoadResult> {
  const contract = getProviderContract(connection.provider);
  const cached = providerModelCache.load(connection.id, connection.provider, connection.baseUrl);
  if (!forceRefresh && cached && !providerModelCache.isStale(cached)) {
    const models = catalogFromDirectory(connection, cached, purpose);
    if (models.length) return { models, directory: cached, source: "cache", fetchedAt: cached.fetchedAt, stale: false, complete: cached.complete !== false };
  }
  if (contract.modelListStrategy === "official_api") {
    try {
      const directory = await fetchSharedDirectory(connection, forceRefresh);
      providerModelCache.save(connection.id, connection.provider, connection.baseUrl, directory);
      const models = catalogFromDirectory(connection, directory, purpose);
      if (models.length) return { models, directory, source: "live", fetchedAt: directory.fetchedAt, stale: false, complete: directory.complete !== false };
    } catch {
      const models = cached ? catalogFromDirectory(connection, cached, purpose) : [];
      if (models.length) return { models, directory: cached, source: "cache", fetchedAt: cached?.fetchedAt, stale: true, complete: cached?.complete !== false };
    }
  }
  return { models: getProviderModelCatalog(connection.provider, purpose), source: "fallback", stale: true, complete: false };
}

/** 新连接保存前只按官方策略读取目录；静态或手动厂商不会产生额外网络请求。 */
export async function loadDraftModelCatalog(input: {
  provider: ApiProvider;
  apiKey: string;
  baseUrl: string;
  providerOptions?: Record<string, string>;
  existingConnection?: ApiConnectionProfile;
}, purpose?: AiConnectionPurpose): Promise<ModelCatalogLoadResult> {
  const contract = getProviderContract(input.provider);
  if (contract.modelListStrategy !== "official_api") return { models: getProviderModelCatalog(input.provider, purpose), source: "fallback", stale: true, complete: false };
  const directory = await listModelsWithConnectionDraft(input);
  const models = catalogFromDirectory({ provider: input.provider }, directory, purpose);
  return models.length
    ? { models, directory, source: "live", fetchedAt: directory.fetchedAt, stale: false, complete: directory.complete !== false }
    : { models: getProviderModelCatalog(input.provider, purpose), directory, source: "fallback", stale: true, complete: false };
}

/** 保存连接后把本轮草稿发现结果复制到连接隔离缓存。 */
export function rememberConnectionModelDirectory(connection: ApiConnectionProfile, directory: AiModelsResult | undefined): void {
  if (directory) providerModelCache.save(connection.id, connection.provider, connection.baseUrl, directory);
}
