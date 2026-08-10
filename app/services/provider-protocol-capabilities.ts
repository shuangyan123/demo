import type { AiEffectiveCapability, CapabilitySupport, ProtocolCapabilityProfile, ProviderProtocol } from "../types/domains/ai-capability.ts";
import type { ApiProvider } from "../types/domains/ai-provider.ts";
import type { AiCapability } from "../types/domains/ai-connection.ts";

const capabilityKeys: AiEffectiveCapability[] = [
  "text", "vision", "video", "tools", "structured_output", "speech", "transcription", "realtime", "streaming", "reasoning", "speed",
];

type ProtocolDefinition = {
  provider: ApiProvider;
  protocol: ProviderProtocol;
  supported: AiEffectiveCapability[];
  unknown?: AiEffectiveCapability[];
};

const nativeDefinitions: ProtocolDefinition[] = [
  { provider: "openai", protocol: "responses", supported: ["text", "vision", "structured_output", "streaming", "reasoning", "speed"] },
  { provider: "google", protocol: "model_routed", supported: ["text", "vision", "structured_output", "streaming", "speech", "transcription", "realtime", "reasoning", "speed"] },
  { provider: "anthropic", protocol: "messages", supported: ["text", "vision", "structured_output", "streaming", "reasoning", "speed"] },
  { provider: "deepseek", protocol: "chat_completions", supported: ["text", "structured_output", "streaming", "reasoning"] },
  { provider: "zhipu", protocol: "chat_completions", supported: ["text", "vision", "structured_output", "streaming", "speech", "transcription", "realtime", "reasoning"] },
  { provider: "minimax", protocol: "messages", supported: ["text", "vision", "video", "tools", "structured_output", "streaming", "speech", "reasoning", "speed"] },
  { provider: "xai", protocol: "responses", supported: ["text", "vision", "structured_output", "streaming", "reasoning", "speed"] },
];

const compatibilityDefinition: Omit<ProtocolDefinition, "provider"> = {
  protocol: "chat_completions",
  supported: ["text", "vision", "structured_output", "streaming"],
  unknown: ["reasoning", "speed"],
};

function toProfile(definition: ProtocolDefinition): ProtocolCapabilityProfile {
  const supported = new Set(definition.supported);
  const unknown = new Set(definition.unknown ?? []);
  return {
    provider: definition.provider,
    protocol: definition.protocol,
    capabilities: Object.fromEntries(capabilityKeys.map((capability) => [
      capability,
      supported.has(capability) ? "supported" : unknown.has(capability) ? "unknown" : "unsupported",
    ])) as Record<AiEffectiveCapability, CapabilitySupport>,
  };
}

export const nativeProviderProtocolProfiles = nativeDefinitions.map(toProfile);
const nativeProfiles = new Map(nativeProviderProtocolProfiles.map((profile) => [profile.provider, profile]));

/** 描述项目当前 adapter 能编码的协议能力，不声称任一具体模型具备同等能力。 */
export function getProviderProtocolCapabilityProfile(provider: ApiProvider): ProtocolCapabilityProfile {
  return nativeProfiles.get(provider) ?? toProfile({ ...compatibilityDefinition, provider });
}

export function getSupportedProtocolCapabilities(provider: ApiProvider): AiCapability[] {
  const profile = getProviderProtocolCapabilityProfile(provider);
  return (capabilityKeys.filter((capability): capability is AiCapability => !["reasoning", "speed"].includes(capability))
    .filter((capability) => profile.capabilities[capability] === "supported"));
}
