import type { AiModelDirectoryEntry, AiModelsResult } from "./api-client";
import { listModelsWithConnection, listModelsWithConnectionDraft } from "./ai-connection-client.ts";
import { providerModelCache } from "./provider-model-cache.ts";
import { getProviderContract, getProviderModelCatalog } from "./provider-contracts.ts";
import type { ApiProvider } from "../types/domains/ai-provider";
import type { AiConnectionPurpose, AiModelCatalogEntry, ApiConnectionProfile } from "../types/review";

export type ModelCatalogLoadResult = {
  models: AiModelCatalogEntry[];
  directory?: AiModelsResult;
  source: "live" | "cache" | "fallback";
};

/** 把公开在线目录归一为设置页和对话选择器共用的模型条目。 */
function toCatalogEntry(connection: Pick<ApiConnectionProfile, "provider">, model: AiModelDirectoryEntry, purpose?: AiConnectionPurpose): AiModelCatalogEntry {
  const fallback = getProviderModelCatalog(connection.provider).find((entry) => entry.id === model.id);
  return {
    id: model.id,
    label: model.label,
    provider: connection.provider,
    purposes: purpose ? [purpose] : model.purposes,
    capabilities: model.capabilities,
    status: model.status === "preview" ? "preview" : model.status === "deprecated" ? "deprecated" : "stable",
    source: "official_live",
    capabilitySource: model.capabilitySource,
    supportedGenerationMethods: model.supportedGenerationMethods,
    family: model.family,
    generation: model.generation,
    modalityGroup: model.modalityGroup,
    lifecycle: model.status === "deprecated" ? "deprecated" : model.status === "preview" ? "preview" : "active",
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    documentationUrl: fallback?.documentationUrl,
    verifiedAt: fallback?.verifiedAt ?? model.updatedAt.slice(0, 10),
  };
}

function catalogFromDirectory(connection: Pick<ApiConnectionProfile, "provider">, directory: AiModelsResult, purpose?: AiConnectionPurpose): AiModelCatalogEntry[] {
  return directory.models
    .filter((model) => model.status !== "deprecated" && (!purpose || model.purposes.includes(purpose)))
    .map((model) => toCatalogEntry(connection, model, purpose));
}

/** 同步读取共享缓存；默认能力选择和对话菜单由此看到同一份在线目录。 */
export function getCachedConnectionModelCatalog(connection: ApiConnectionProfile, purpose?: AiConnectionPurpose): AiModelCatalogEntry[] {
  const cached = providerModelCache.load(connection.id, connection.provider, connection.baseUrl);
  const online = cached && !providerModelCache.isStale(cached) ? catalogFromDirectory(connection, cached, purpose) : [];
  return online.length ? online : getProviderModelCatalog(connection.provider, purpose);
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
    if (models.length) return { models, directory: cached, source: "cache" };
  }
  if (contract.modelListStrategy === "official_api") {
    try {
      const directory = await listModelsWithConnection(connection);
      providerModelCache.save(connection.id, connection.provider, connection.baseUrl, directory);
      const models = catalogFromDirectory(connection, directory, purpose);
      if (models.length) return { models, directory, source: "live" };
    } catch {
      const models = cached ? catalogFromDirectory(connection, cached, purpose) : [];
      if (models.length) return { models, directory: cached, source: "cache" };
    }
  }
  return { models: getProviderModelCatalog(connection.provider, purpose), source: "fallback" };
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
  if (contract.modelListStrategy !== "official_api") return { models: getProviderModelCatalog(input.provider, purpose), source: "fallback" };
  const directory = await listModelsWithConnectionDraft(input);
  const models = catalogFromDirectory({ provider: input.provider }, directory, purpose);
  return models.length ? { models, directory, source: "live" } : { models: getProviderModelCatalog(input.provider, purpose), directory, source: "fallback" };
}

/** 保存连接后把本轮草稿发现结果复制到连接隔离缓存。 */
export function rememberConnectionModelDirectory(connection: ApiConnectionProfile, directory: AiModelsResult | undefined): void {
  if (directory) providerModelCache.save(connection.id, connection.provider, connection.baseUrl, directory);
}
