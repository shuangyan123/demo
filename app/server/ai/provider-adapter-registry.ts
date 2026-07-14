import type { AiGenerateRequest, AiGenerateResult, AiGenerateStreamEvent } from "../../services/api-client";
import type { AiCapability, ApiProvider } from "../../types/review";
import { buildGenerateProviderRequest, parseGenerateProviderResponse, parseGenerateProviderStreamEvent } from "./provider-adapter.ts";

type ProviderHttpRequest = { url: string; headers: Record<string, string>; body: unknown };

/** 服务端厂商适配器统一边界；业务路由只依赖归一化输入输出。 */
export type ProviderAdapter = {
  provider: ApiProvider;
  protocol: "responses" | "interactions" | "messages" | "chat_completions";
  capabilities: AiCapability[];
  buildGenerate: (input: AiGenerateRequest) => ProviderHttpRequest;
  parseGenerate: (input: AiGenerateRequest, payload: unknown, headers: Headers) => AiGenerateResult;
  parseStream: (input: AiGenerateRequest, payload: unknown, headers: Headers) => AiGenerateStreamEvent[];
};

const definitions: Array<Pick<ProviderAdapter, "provider" | "protocol" | "capabilities">> = [
  { provider: "openai", protocol: "responses", capabilities: ["text", "vision", "structured_output", "streaming"] },
  { provider: "google", protocol: "interactions", capabilities: ["text", "vision", "structured_output", "streaming", "speech", "transcription", "realtime"] },
  { provider: "anthropic", protocol: "messages", capabilities: ["text", "vision", "structured_output", "streaming"] },
  { provider: "deepseek", protocol: "chat_completions", capabilities: ["text", "structured_output", "streaming"] },
  { provider: "zhipu", protocol: "chat_completions", capabilities: ["text", "vision", "structured_output", "streaming", "speech", "transcription", "realtime"] },
  { provider: "minimax", protocol: "messages", capabilities: ["text", "vision", "video", "tools", "structured_output", "streaming", "speech"] },
  { provider: "xai", protocol: "responses", capabilities: ["text", "vision", "structured_output", "streaming"] },
];

/** 七家已核验厂商共享路由契约，协议差异由具体请求构造和解析器处理。 */
export const providerAdapterRegistry = new Map<ApiProvider, ProviderAdapter>(definitions.map((definition) => [definition.provider, {
  ...definition,
  buildGenerate: buildGenerateProviderRequest,
  parseGenerate: parseGenerateProviderResponse,
  parseStream: parseGenerateProviderStreamEvent,
}]));

const compatibilityAdapter: ProviderAdapter = {
  provider: "custom",
  protocol: "chat_completions",
  capabilities: ["text", "vision", "structured_output", "streaming"],
  buildGenerate: buildGenerateProviderRequest,
  parseGenerate: parseGenerateProviderResponse,
  parseStream: parseGenerateProviderStreamEvent,
};

/** 未核验厂商不得静默进入七家原生适配路径。 */
export function getProviderAdapter(provider: ApiProvider): ProviderAdapter {
  return providerAdapterRegistry.get(provider) ?? { ...compatibilityAdapter, provider };
}
