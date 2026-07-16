import type { AiModelDirectoryEntry, AiModelsRequest, AiModelsResult } from "../../services/api-client.ts";
import { normalizeGoogleApiBaseUrl } from "../../services/google-connection.ts";
import { miniMaxModelDirectoryHeaders, normalizeMiniMaxAnthropicBaseUrl } from "../../services/minimax-connection.ts";
import { getProviderModelCatalog } from "../../services/provider-contracts.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import type { AiCapability, AiConnectionPurpose } from "../../types/review.ts";
import { HttpProviderTransport } from "./provider-transport.ts";

type JsonObject = Record<string, unknown>;

type RawModel = {
  id: string;
  label: string;
  status?: string;
  capabilities?: JsonObject;
  supportedGenerationMethods?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
};

type DirectoryCursor = { token?: string; page?: number };

export class ProviderDirectoryHttpError extends Error {
  readonly provider: ApiProvider;
  readonly response: Response;

  constructor(provider: ApiProvider, response: Response) {
    super(`Provider model directory failed with ${response.status}`);
    this.provider = provider;
    this.response = response;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** 模型目录鉴权与生成鉴权可能不同，必须按厂商分别构造。 */
export function providerModelDirectoryHeaders(provider: ApiProvider, apiKey: string): Record<string, string> {
  if (provider === "google") return { "x-goog-api-key": apiKey };
  if (provider === "minimax") return miniMaxModelDirectoryHeaders(apiKey);
  if (provider === "anthropic") return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function qwenDirectoryOrigin(baseUrl: string): string {
  const host = new URL(baseUrl).hostname;
  return host.includes("dashscope-intl") || host.includes("ap-southeast-1")
    ? "https://dashscope-intl.aliyuncs.com"
    : "https://dashscope.aliyuncs.com";
}

/** 根据厂商协议构造当前分页请求，禁止把所有目录都假设为 baseUrl/models。 */
export function providerModelDirectoryUrl(input: AiModelsRequest, cursor: DirectoryCursor = {}): string {
  const normalized = normalizeBaseUrl(input.baseUrl);
  if (input.provider === "google") {
    const url = new URL(`${normalizeGoogleApiBaseUrl(normalized)}/models`);
    url.searchParams.set("pageSize", "1000");
    if (cursor.token) url.searchParams.set("pageToken", cursor.token);
    return url.toString();
  }
  if (input.provider === "minimax") {
    const url = new URL(`${normalizeMiniMaxAnthropicBaseUrl(normalized, input.providerOptions?.region === "global" ? "global" : "cn")}/v1/models`);
    url.searchParams.set("limit", "100");
    if (cursor.token) url.searchParams.set("after_id", cursor.token);
    return url.toString();
  }
  if (input.provider === "qwen") {
    const url = new URL(`${qwenDirectoryOrigin(normalized)}/api/v1/deployments/models`);
    url.searchParams.set("page_no", String(cursor.page ?? 1));
    url.searchParams.set("page_size", "100");
    url.searchParams.set("version", "v1.0");
    url.searchParams.set("model_source", "base");
    return url.toString();
  }
  const url = new URL(`${normalized}/models`);
  if (input.provider === "anthropic") {
    url.searchParams.set("limit", "100");
    if (cursor.token) url.searchParams.set("after_id", cursor.token);
  }
  if (input.provider === "siliconflow") {
    url.searchParams.set("type", "text");
    url.searchParams.set("sub_type", "chat");
  }
  return url.toString();
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

/** 只采信厂商返回的能力字段或精确 descriptor，不按模型名称猜测多模态。 */
function modelCapabilities(provider: ApiProvider, id: string, raw: JsonObject): { capabilities: AiCapability[]; source: AiModelDirectoryEntry["capabilitySource"] } {
  const verified = getProviderModelCatalog(provider, undefined, true).find((model) => model.id === id);
  if (verified) return { capabilities: verified.capabilities, source: "verified" };

  const capabilities = objectValue(raw.capabilities);
  const architecture = objectValue(raw.architecture);
  const inputModalities = stringArray(architecture?.input_modalities) ?? stringArray(raw.input_modalities) ?? [];
  const providerVision = raw.supports_image_in === true || capabilities?.vision === true || capabilities?.image_input === true || inputModalities.includes("image");
  const providerVideo = raw.supports_video_in === true || inputModalities.includes("video");
  const hasProviderMetadata = providerVision || providerVideo || Boolean(capabilities) || provider === "kimi";
  return {
    capabilities: ["text", ...(providerVision ? ["vision" as const] : []), ...(providerVideo ? ["video" as const] : []), "structured_output", "streaming"],
    source: hasProviderMetadata ? "provider" : "unknown",
  };
}

function purposesFor(capabilities: AiCapability[]): AiConnectionPurpose[] {
  return (["text", "vision", "speech", "transcription", "realtime"] as AiConnectionPurpose[]).filter((purpose) => capabilities.includes(purpose));
}

function normalizeModel(provider: ApiProvider, raw: RawModel, source: JsonObject, updatedAt: string): AiModelDirectoryEntry {
  const resolved = modelCapabilities(provider, raw.id, source);
  const verified = getProviderModelCatalog(provider, undefined, true).find((model) => model.id === raw.id);
  const rawStatus = raw.status?.toLowerCase();
  const status = rawStatus === "deprecated" || rawStatus === "retired" || source.archived === true || verified?.lifecycle === "deprecated"
    ? "deprecated"
    : rawStatus === "preview" || rawStatus === "experimental"
      ? "preview"
      : rawStatus
        ? "active"
        : "unknown";
  const modalityGroup = resolved.capabilities.includes("speech")
    ? "speech"
    : resolved.capabilities.includes("transcription") && !resolved.capabilities.includes("text")
      ? "transcription"
      : resolved.capabilities.includes("vision")
        ? "multimodal"
        : "text";
  return {
    id: raw.id,
    label: raw.label || raw.id,
    purposes: purposesFor(resolved.capabilities),
    capabilities: resolved.capabilities,
    status,
    source: "official_api",
    capabilitySource: resolved.source,
    supportedGenerationMethods: raw.supportedGenerationMethods,
    generationProtocol: verified?.generationProtocol
      ?? (raw.supportedGenerationMethods?.includes("generateContent") ? "google_generate_content" : undefined),
    family: raw.id,
    modalityGroup,
    contextWindow: raw.contextWindow ?? verified?.contextWindow,
    maxOutputTokens: raw.maxOutputTokens ?? verified?.maxOutputTokens,
    supportsStreaming: resolved.capabilities.includes("streaming"),
    supportsStructuredOutput: resolved.capabilities.includes("structured_output"),
    updatedAt,
  };
}

function extractPage(provider: ApiProvider, payload: unknown): { rows: JsonObject[]; next?: DirectoryCursor } {
  const object = objectValue(payload) ?? {};
  if (provider === "google") {
    const rows = Array.isArray(object.models) ? object.models.filter((item): item is JsonObject => Boolean(objectValue(item))) : [];
    const token = typeof object.nextPageToken === "string" ? object.nextPageToken : undefined;
    return { rows, next: token ? { token } : undefined };
  }
  if (provider === "minimax") {
    const rows = Array.isArray(object.data) ? object.data.filter((item): item is JsonObject => Boolean(objectValue(item))) : [];
    const token = object.has_more === true && typeof object.last_id === "string" ? object.last_id : undefined;
    return { rows, next: token ? { token } : undefined };
  }
  if (provider === "anthropic") {
    const rows = Array.isArray(object.data) ? object.data.filter((item): item is JsonObject => Boolean(objectValue(item))) : [];
    const token = object.has_more === true && typeof object.last_id === "string" ? object.last_id : undefined;
    return { rows, next: token ? { token } : undefined };
  }
  if (provider === "qwen") {
    const output = objectValue(object.output) ?? {};
    const rows = Array.isArray(output.models) ? output.models.filter((item): item is JsonObject => Boolean(objectValue(item))) : [];
    const page = Number(output.page_no ?? 1);
    const size = Number(output.page_size ?? rows.length);
    const total = Number(output.total ?? rows.length);
    return { rows, next: Number.isFinite(total) && page * size < total ? { page: page + 1 } : undefined };
  }
  const values = Array.isArray(payload) ? payload : object.data;
  return { rows: Array.isArray(values) ? values.filter((item): item is JsonObject => Boolean(objectValue(item))) : [] };
}

function rawModel(provider: ApiProvider, item: JsonObject): RawModel | undefined {
  const id = provider === "google"
    ? String(item.name ?? "").replace(/^models\//, "")
    : provider === "qwen"
      ? String(item.model_name ?? "")
      : String(item.id ?? "");
  if (!id) return undefined;
  const supportedGenerationMethods = stringArray(item.supportedGenerationMethods);
  if (provider === "google" && !supportedGenerationMethods?.includes("generateContent")) return undefined;
  if (provider === "mistral" && objectValue(item.capabilities)?.completion_chat === false) return undefined;
  return {
    id,
    label: String(item.displayName ?? item.display_name ?? item.model_name ?? item.name ?? item.id ?? id),
    status: String(item.stage ?? item.status ?? ""),
    capabilities: item,
    supportedGenerationMethods,
    contextWindow: Number(item.inputTokenLimit ?? item.context_length ?? item.max_context_length ?? item.context_window) || undefined,
    maxOutputTokens: Number(item.outputTokenLimit ?? item.max_tokens) || undefined,
  };
}

/** 读取完整官方目录；重复游标和超量分页会安全终止。 */
export async function fetchProviderModelDirectory(input: AiModelsRequest, fetcher: typeof fetch = fetch): Promise<AiModelsResult> {
  const fetchedAt = new Date().toISOString();
  const transport = new HttpProviderTransport(fetcher);
  const collected = new Map<string, AiModelDirectoryEntry>();
  const seenCursors = new Set<string>();
  let cursor: DirectoryCursor | undefined;
  let complete = true;

  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const response = await transport.listModels({
      url: providerModelDirectoryUrl(input, cursor),
      headers: providerModelDirectoryHeaders(input.provider, input.apiKey),
    });
    if (!response.ok) throw new ProviderDirectoryHttpError(input.provider, response);
    const payload = await response.json() as unknown;
    const page = extractPage(input.provider, payload);
    for (const item of page.rows) {
      const raw = rawModel(input.provider, item);
      if (!raw) continue;
      collected.set(raw.id, normalizeModel(input.provider, raw, item, fetchedAt));
    }
    if (!page.next) break;
    const cursorKey = JSON.stringify(page.next);
    if (seenCursors.has(cursorKey)) {
      complete = false;
      break;
    }
    seenCursors.add(cursorKey);
    cursor = page.next;
    if (pageIndex === 19) complete = false;
  }

  return {
    models: [...collected.values()].sort((left, right) => left.label.localeCompare(right.label)),
    fetchedAt,
    complete,
  };
}
