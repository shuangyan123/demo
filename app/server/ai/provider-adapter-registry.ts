import type { AiGenerateRequest, AiGenerateResult, AiGenerateStreamEvent } from "../../services/api-client";
import type { AiProviderFailure } from "../../services/ai-provider-failure.ts";
import type { AiCapability } from "../../types/domains/ai-connection.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import { buildGenerateProviderRequest, parseGenerateProviderResponse, parseGenerateProviderStreamEvent } from "./provider-adapter.ts";
import { parseProviderFailure } from "./provider-failure.ts";
import { getProviderProtocolCapabilityProfile, getSupportedProtocolCapabilities, nativeProviderProtocolProfiles } from "../../services/provider-protocol-capabilities.ts";

export type ProviderHttpRequest = { url: string; headers: Record<string, string>; body: unknown };
export type ProviderStreamCompletion = "event" | "sentinel" | "eof";

function streamCompletion(input: AiGenerateRequest): ProviderStreamCompletion {
  if (input.provider === "google") return input.generationProtocol === "google_interactions" ? "event" : "eof";
  const protocol = getProviderProtocolCapabilityProfile(input.provider).protocol;
  if (protocol === "responses" || protocol === "messages") return "event";
  return "sentinel";
}

/** 服务端厂商适配器统一边界；业务路由只依赖归一化输入输出。 */
export type ProviderAdapter = {
  provider: ApiProvider;
  protocol: import("../../types/domains/ai-capability.ts").ProviderProtocol;
  capabilities: AiCapability[];
  buildGenerate: (input: AiGenerateRequest) => ProviderHttpRequest;
  parseGenerate: (input: AiGenerateRequest, payload: unknown, headers: Headers) => AiGenerateResult;
  parseStream: (input: AiGenerateRequest, payload: unknown, headers: Headers) => AiGenerateStreamEvent[];
  parseFailure: (input: AiGenerateRequest, response: Response) => Promise<AiProviderFailure>;
  streamCompletion: (input: AiGenerateRequest) => ProviderStreamCompletion;
};

const definitions: Array<Pick<ProviderAdapter, "provider" | "protocol" | "capabilities">> = nativeProviderProtocolProfiles.map((profile) => ({
  provider: profile.provider,
  protocol: profile.protocol,
  capabilities: getSupportedProtocolCapabilities(profile.provider),
}));

/** 七家已核验厂商共享路由契约，协议差异由具体请求构造和解析器处理。 */
export const providerAdapterRegistry = new Map<ApiProvider, ProviderAdapter>(definitions.map((definition) => [definition.provider, {
  ...definition,
  buildGenerate: buildGenerateProviderRequest,
  parseGenerate: parseGenerateProviderResponse,
  parseStream: parseGenerateProviderStreamEvent,
  parseFailure: parseProviderFailure,
  streamCompletion,
}]));

const compatibilityAdapter: ProviderAdapter = {
  provider: "custom",
  protocol: getProviderProtocolCapabilityProfile("custom").protocol,
  capabilities: getSupportedProtocolCapabilities("custom"),
  buildGenerate: buildGenerateProviderRequest,
  parseGenerate: parseGenerateProviderResponse,
  parseStream: parseGenerateProviderStreamEvent,
  parseFailure: parseProviderFailure,
  streamCompletion,
};

/** 未核验厂商不得静默进入七家原生适配路径。 */
export function getProviderAdapter(provider: ApiProvider): ProviderAdapter {
  return providerAdapterRegistry.get(provider) ?? { ...compatibilityAdapter, provider };
}
