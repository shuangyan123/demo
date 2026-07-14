import type { AiModelDirectoryEntry, AiModelsRequest } from "../../../services/api-client";
import type { AiCapability, AiConnectionPurpose, ApiProvider } from "../../../types/review";
import { aiRouteError, aiUpstreamError, readAiRouteJson } from "../../../server/ai/http.ts";
import { getProviderModelCatalog } from "../../../services/provider-contracts.ts";

type RawModel = {
  id: string;
  label: string;
  status?: string;
  capabilities?: Record<string, unknown>;
  supportedGenerationMethods?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
};

function isRequest(value: unknown): value is AiModelsRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiModelsRequest>;
  return Boolean(input.provider && input.baseUrl && (input.apiKey || input.provider === "custom"));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function providerHeaders(provider: ApiProvider, apiKey: string): Record<string, string> {
  if (provider === "google") return { "x-goog-api-key": apiKey };
  if (provider === "anthropic" || provider === "minimax") return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** 返回厂商官方模型目录地址，避免把所有服务都假设成同一个 /models 形状。 */
function modelsUrl(provider: ApiProvider, baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (provider === "minimax") return `${normalized.replace(/\/v1$/, "/anthropic")}/v1/models`;
  return `${normalized}/models`;
}

/** 按厂商已核验能力归一化模型，禁止用跨厂商通用正则虚报视觉能力。 */
function modelCapabilities(provider: ApiProvider, id: string, raw?: Record<string, unknown>): { capabilities: AiCapability[]; source: AiModelDirectoryEntry["capabilitySource"] } {
  const verified = getProviderModelCatalog(provider).find((model) => model.id === id);
  if (verified) return { capabilities: verified.capabilities, source: "verified" };
  const value = id.toLowerCase();
  if (provider === "openai" || provider === "azure_openai") {
    if (value.includes("tts")) return { capabilities: ["speech"], source: "provider" };
    if (value.includes("transcribe") || value.includes("whisper")) return { capabilities: ["transcription"], source: "provider" };
    return { capabilities: ["text", "structured_output", "streaming"], source: "unknown" };
  }
  if (provider === "google") return { capabilities: ["text", "structured_output", "streaming"], source: "unknown" };
  if (provider === "anthropic") {
    const capabilities = raw?.capabilities as Record<string, unknown> | undefined;
    return { capabilities: ["text", ...(capabilities?.image_input === true ? ["vision" as const] : []), "structured_output", "streaming"], source: "provider" };
  }
  if (provider === "deepseek") return { capabilities: ["text", "structured_output", "streaming"], source: "provider" };
  if (provider === "minimax") return { capabilities: value.startsWith("speech-") ? ["speech"] : ["text", "structured_output", "streaming"], source: "unknown" };
  if (provider === "xai") return { capabilities: ["text", "structured_output", "streaming"], source: "unknown" };
  if (provider === "zhipu") {
    if (value.includes("tts")) return { capabilities: ["speech"], source: "provider" };
    if (value.includes("asr")) return { capabilities: ["transcription"], source: "provider" };
    return { capabilities: ["text", "structured_output", "streaming"], source: "unknown" };
  }
  return { capabilities: ["text"], source: "unknown" };
}

function purposesFor(capabilities: AiCapability[]): AiConnectionPurpose[] {
  return (["text", "vision", "speech", "transcription", "realtime"] as AiConnectionPurpose[]).filter((purpose) => capabilities.includes(purpose));
}

function normalizeModel(provider: ApiProvider, raw: RawModel, updatedAt: string): AiModelDirectoryEntry {
  const resolvedCapabilities = modelCapabilities(provider, raw.id, raw.capabilities);
  const capabilities = resolvedCapabilities.capabilities;
  const rawStatus = raw.status?.toLowerCase();
  const status = rawStatus === "deprecated" || rawStatus === "retired" ? "deprecated" : rawStatus === "preview" || rawStatus === "experimental" ? "preview" : rawStatus ? "active" : "unknown";
  const generation = raw.id.match(/(?:gpt-|gemini-|claude-[a-z]+-|grok-|deepseek-v|minimax-m|speech-|glm-)(\d+(?:[.-]\d+)?)/i)?.[1]?.replace("-", ".");
  const modalityGroup = capabilities.includes("speech") ? "speech" : capabilities.includes("transcription") && !capabilities.includes("text")
    ? "transcription" : capabilities.includes("vision") ? "multimodal" : "text";
  return {
    id: raw.id,
    label: raw.label || raw.id,
    purposes: purposesFor(capabilities),
    capabilities,
    status,
    source: "official_api",
    capabilitySource: resolvedCapabilities.source,
    supportedGenerationMethods: raw.supportedGenerationMethods,
    family: raw.id.replace(/(?:[-_.](?:pro|mini|nano|flash|lite|turbo|hd|highspeed|reasoning|non-reasoning|preview|latest))+$/gi, ""),
    generation,
    modalityGroup,
    contextWindow: raw.contextWindow,
    maxOutputTokens: raw.maxOutputTokens,
    supportsStreaming: capabilities.includes("streaming"),
    supportsStructuredOutput: capabilities.includes("structured_output"),
    updatedAt,
  };
}

/** 代理六家厂商官方模型目录；响应只包含公开且归一化的模型元数据。 */
export async function POST(request: Request) {
  try {
    const body = await readAiRouteJson(request);
    if (!isRequest(body)) return aiRouteError("缺少有效的模型目录连接参数", 400);
    const response = await fetch(modelsUrl(body.provider, body.baseUrl), { headers: providerHeaders(body.provider, body.apiKey), cache: "no-store" });
    if (!response.ok) return aiUpstreamError("官方模型目录请求失败", response.status);
    const payload = await response.json() as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> };
    const source = body.provider === "google" ? payload.models ?? [] : payload.data ?? [];
    const fetchedAt = new Date().toISOString();
    const models = source.flatMap((item): RawModel[] => {
      const id = body.provider === "google" ? String(item.name ?? "").replace(/^models\//, "") : String(item.id ?? "");
      if (!id) return [];
      const supportedGenerationMethods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods.filter((method): method is string => typeof method === "string")
        : undefined;
      // Google 目录同时包含嵌入、Live 与其他专用模型；生成目录只接收 generateContent。
      if (body.provider === "google" && !supportedGenerationMethods?.includes("generateContent")) return [];
      return [{
        id,
        label: String(item.displayName ?? item.display_name ?? item.name ?? item.id ?? id),
        status: String(item.stage ?? item.status ?? ""),
        capabilities: item,
        supportedGenerationMethods,
        contextWindow: Number(item.inputTokenLimit ?? item.context_window) || undefined,
        maxOutputTokens: Number(item.outputTokenLimit ?? item.max_tokens) || undefined,
      }];
    }).map((item) => normalizeModel(body.provider, item, fetchedAt)).sort((left, right) => left.label.localeCompare(right.label));
    return Response.json({ models, fetchedAt });
  } catch {
    return aiRouteError("模型目录请求失败");
  }
}
