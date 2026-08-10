import type {
  AiEffectiveCapability,
  CapabilitySupport,
  EffectiveCapabilityResolution,
  ModelCapabilityFactSource,
  ModelCapabilityProfile,
} from "../types/domains/ai-capability.ts";
import { AiCapabilityContractError } from "../types/domains/ai-capability.ts";
import type { ApiProvider } from "../types/domains/ai-provider.ts";
import type { AiCapability } from "../types/domains/ai-connection.ts";
import type { AiModelCatalogEntry } from "../types/domains/provider-catalog.ts";
import type { AiModelDirectoryEntry } from "./api-client.ts";
import { getAiModelRuntimeDescriptor } from "./model-runtime-descriptors.ts";
import { getProviderModelCatalog } from "./provider-contracts.ts";
import { getProviderProtocolCapabilityProfile } from "./provider-protocol-capabilities.ts";

const modelCapabilityKeys: AiCapability[] = [
  "text", "vision", "video", "tools", "structured_output", "speech", "transcription", "realtime", "streaming",
];

type ModelFact = Pick<AiModelCatalogEntry, "id" | "capabilities" | "contextWindow" | "maxOutputTokens" | "source" | "capabilitySource">
  | Pick<AiModelDirectoryEntry, "id" | "capabilities" | "contextWindow" | "maxOutputTokens" | "source" | "capabilitySource">;

function factSource(fact: ModelFact | undefined): ModelCapabilityFactSource {
  if (!fact) return "unknown";
  if (fact.source === "official_fallback" || fact.capabilitySource === "verified") return "verified-catalog";
  if (fact.capabilitySource === "provider") return "provider-metadata";
  if (fact.source === "manual") return "protocol-minimum";
  return "unknown";
}

function modelSupport(source: ModelCapabilityFactSource, fact: ModelFact | undefined, capability: AiCapability): CapabilitySupport {
  // 所有已选生成模型只确认当前协议最低限度的文本调用；这不推导任何可选能力。
  if (capability === "text" && (!fact || source === "protocol-minimum" || source === "unknown")) return "supported";
  if (!fact || source === "unknown" || source === "protocol-minimum") return "unknown";
  if (fact.capabilities.includes(capability)) return "supported";
  return source === "verified-catalog" ? "unsupported" : "unknown";
}

/** 静态 catalog 是已核验事实 owner；在线条目只能按其显式 capabilitySource 提升可信度。 */
export function resolveModelCapabilityProfile(
  provider: ApiProvider,
  modelId: string,
  discoveredFact?: AiModelDirectoryEntry,
): ModelCapabilityProfile {
  const verified = getProviderModelCatalog(provider, undefined, true).find((entry) => entry.id === modelId);
  const fact: ModelFact | undefined = verified ?? discoveredFact;
  const source = factSource(fact);
  const descriptor = getAiModelRuntimeDescriptor(provider, modelId);
  return {
    provider,
    modelId,
    source,
    capabilities: Object.fromEntries(modelCapabilityKeys.map((capability) => [capability, modelSupport(source, fact, capability)])) as Record<AiCapability, CapabilitySupport>,
    runtime: {
      reasoning: descriptor?.reasoning ? "supported" : "unknown",
      speed: descriptor?.speed ? "supported" : "unknown",
    },
    contextWindowTokens: fact?.contextWindow,
    maxOutputTokens: fact?.maxOutputTokens,
  };
}

/** 有效能力是模型事实与当前协议实现的保守交集，并保留不可用原因。 */
export function resolveEffectiveCapability(
  modelSupportValue: CapabilitySupport,
  protocolSupportValue: CapabilitySupport,
): EffectiveCapabilityResolution {
  if (modelSupportValue === "unsupported") return { support: "unsupported", reason: "model-capability-unsupported", modelSupport: modelSupportValue, protocolSupport: protocolSupportValue };
  if (protocolSupportValue === "unsupported") return { support: "unsupported", reason: "protocol-capability-unsupported", modelSupport: modelSupportValue, protocolSupport: protocolSupportValue };
  if (modelSupportValue === "unknown") return { support: "unknown", reason: "model-capability-unknown", modelSupport: modelSupportValue, protocolSupport: protocolSupportValue };
  if (protocolSupportValue === "unknown") return { support: "unknown", reason: "protocol-capability-unknown", modelSupport: modelSupportValue, protocolSupport: protocolSupportValue };
  return { support: "supported", reason: "available", modelSupport: modelSupportValue, protocolSupport: protocolSupportValue };
}

export function resolveEffectiveModelCapability(profile: ModelCapabilityProfile, capability: AiEffectiveCapability): EffectiveCapabilityResolution {
  const model = capability === "reasoning" || capability === "speed" ? profile.runtime[capability] : profile.capabilities[capability];
  const protocol = getProviderProtocolCapabilityProfile(profile.provider).capabilities[capability];
  return resolveEffectiveCapability(model, protocol);
}

export function assertEffectiveModelCapability(profile: ModelCapabilityProfile, capability: AiEffectiveCapability): void {
  const result = resolveEffectiveModelCapability(profile, capability);
  if (result.reason === "available") return;
  const label = capability === "vision" ? "多模态" : capability === "streaming" ? "流式输出" : capability === "structured_output" ? "结构化输出" : capability;
  const reason = result.reason === "model-capability-unsupported"
    ? `所选模型明确不支持${label}能力`
    : result.reason === "protocol-capability-unsupported"
      ? `当前连接协议暂不支持${label}能力`
      : `所选模型的${label}能力尚未验证`;
  throw new AiCapabilityContractError({ code: result.reason, capability, provider: profile.provider, modelId: profile.modelId, message: reason });
}
