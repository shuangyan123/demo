import type { AiModelDirectoryEntry, AiModelsRequest } from "../../../services/api-client";
import type { AiCapability, AiConnectionPurpose, ApiProvider } from "../../../types/review";
import { aiRouteError, aiUpstreamError, readAiRouteJson } from "../../../server/ai/http.ts";

type RawModel = { id: string; label: string; status?: string; capabilities?: Record<string, unknown>; contextWindow?: number; maxOutputTokens?: number };

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
  if (provider === "anthropic") return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** 按厂商已核验能力归一化模型，禁止用跨厂商通用正则虚报视觉能力。 */
function modelCapabilities(provider: ApiProvider, id: string, raw?: Record<string, unknown>): AiCapability[] {
  const value = id.toLowerCase();
  if (provider === "openai" || provider === "azure_openai") {
    if (value.includes("tts")) return ["speech"];
    if (value.includes("transcribe") || value.includes("whisper")) return ["transcription"];
    return value.includes("gpt-5") || value.includes("gpt-4o")
      ? ["text", "vision", "structured_output", "streaming"]
      : ["text", "structured_output", "streaming"];
  }
  if (provider === "google") return ["text", "vision", "transcription", "structured_output", "streaming"];
  if (provider === "anthropic") {
    const capabilities = raw?.capabilities as Record<string, unknown> | undefined;
    return ["text", ...(capabilities?.image_input !== false ? ["vision" as const] : []), "structured_output", "streaming"];
  }
  if (provider === "deepseek") return ["text", "structured_output", "streaming"];
  if (provider === "minimax") return value.startsWith("speech-") ? ["speech"] : value === "minimax-m3" ? ["text", "vision", "structured_output", "streaming"] : ["text", "structured_output", "streaming"];
  if (provider === "xai") return ["text", "vision", "structured_output", "streaming"];
  if (provider === "zhipu") {
    if (value.includes("tts")) return ["speech"];
    if (value.includes("asr")) return ["transcription"];
    if (value.includes("v") || value.includes("vision")) return ["text", "vision", "structured_output", "streaming"];
    return ["text", "structured_output", "streaming"];
  }
  return ["text"];
}

function purposesFor(capabilities: AiCapability[]): AiConnectionPurpose[] {
  return (["text", "vision", "speech", "transcription", "realtime"] as AiConnectionPurpose[]).filter((purpose) => capabilities.includes(purpose));
}

function normalizeModel(provider: ApiProvider, raw: RawModel, updatedAt: string): AiModelDirectoryEntry {
  const capabilities = modelCapabilities(provider, raw.id, raw.capabilities);
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
    const response = await fetch(`${normalizeBaseUrl(body.baseUrl)}/models`, { headers: providerHeaders(body.provider, body.apiKey), cache: "no-store" });
    if (!response.ok) return aiUpstreamError("官方模型目录请求失败", response.status);
    const payload = await response.json() as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> };
    const source = body.provider === "google" ? payload.models ?? [] : payload.data ?? [];
    const fetchedAt = new Date().toISOString();
    const models = source.flatMap((item): RawModel[] => {
      const id = body.provider === "google" ? String(item.name ?? "").replace(/^models\//, "") : String(item.id ?? "");
      if (!id) return [];
      return [{
        id,
        label: String(item.displayName ?? item.display_name ?? item.name ?? item.id ?? id),
        status: String(item.stage ?? item.status ?? ""),
        capabilities: item,
        contextWindow: Number(item.inputTokenLimit ?? item.context_window) || undefined,
        maxOutputTokens: Number(item.outputTokenLimit ?? item.max_tokens) || undefined,
      }];
    }).map((item) => normalizeModel(body.provider, item, fetchedAt)).sort((left, right) => left.label.localeCompare(right.label));
    return Response.json({ models, fetchedAt });
  } catch {
    return aiRouteError("模型目录请求失败");
  }
}
