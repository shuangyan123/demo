import type { AiModelDirectoryEntry, AiModelsRequest } from "../../../services/api-client";

function isRequest(value: unknown): value is AiModelsRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<AiModelsRequest>;
  return Boolean(input.provider && input.baseUrl && (input.apiKey || input.provider === "custom"));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function inferCapabilities(id: string): AiModelDirectoryEntry["capabilities"] {
  const value = id.toLowerCase();
  if (/tts|speech/.test(value)) return ["speech"];
  if (/gemini/.test(value)) return ["text", "vision", "transcription"];
  if (/gpt-5|gpt-4o|claude|vision|vl|qwen3/.test(value)) return ["text", "vision"];
  return ["text"];
}

/** 代理厂商官方 models API，只返回公开模型 ID 和归一化能力。 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRequest(body)) return new Response("缺少有效的模型目录连接参数", { status: 400 });
    const url = `${normalizeBaseUrl(body.baseUrl)}/models`;
    const headers: Record<string, string> = body.provider === "google"
      ? { "x-goog-api-key": body.apiKey }
      : body.provider === "anthropic"
        ? { "x-api-key": body.apiKey, "anthropic-version": "2023-06-01" }
        : body.apiKey
          ? { Authorization: `Bearer ${body.apiKey}` }
          : {};
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) return new Response(`官方模型目录请求失败（${response.status}）`, { status: response.status });
    const payload = await response.json() as {
      data?: Array<{ id?: string; display_name?: string }>;
      models?: Array<{ name?: string; displayName?: string }>;
    };
    const source = body.provider === "google"
      ? (payload.models ?? []).map((model) => ({ id: model.name?.replace(/^models\//, "") ?? "", label: model.displayName ?? model.name ?? "" }))
      : (payload.data ?? []).map((model) => ({ id: model.id ?? "", label: model.display_name ?? model.id ?? "" }));
    const models = source
      .filter((model) => model.id)
      .map((model): AiModelDirectoryEntry => ({ ...model, capabilities: inferCapabilities(model.id), source: "official_api" }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return Response.json({ models, fetchedAt: new Date().toISOString() });
  } catch {
    return new Response("模型目录请求失败", { status: 500 });
  }
}
