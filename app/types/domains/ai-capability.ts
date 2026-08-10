import type { AiModelRuntimeValue, AiSelectedRuntimeValues } from "./ai-model.ts";
import type { ApiProvider } from "./ai-provider.ts";
import type { AiCapability } from "./ai-connection.ts";

/** 能力事实必须区分未知与明确不支持；未知不得自动放行。 */
export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type AiRuntimeCapability = "reasoning" | "speed";
export type AiEffectiveCapability = AiCapability | AiRuntimeCapability;

export type ModelCapabilityFactSource = "verified-catalog" | "provider-metadata" | "protocol-minimum" | "unknown";

export type ModelCapabilityProfile = {
  provider: ApiProvider;
  modelId: string;
  source: ModelCapabilityFactSource;
  capabilities: Record<AiCapability, CapabilitySupport>;
  runtime: Record<AiRuntimeCapability, CapabilitySupport>;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
};

export type ProviderProtocol = "responses" | "model_routed" | "messages" | "chat_completions";

export type ProtocolCapabilityProfile = {
  provider: ApiProvider;
  protocol: ProviderProtocol;
  capabilities: Record<AiEffectiveCapability, CapabilitySupport>;
};

export type EffectiveCapabilityReason =
  | "available"
  | "model-capability-unsupported"
  | "model-capability-unknown"
  | "protocol-capability-unsupported"
  | "protocol-capability-unknown";

export type EffectiveCapabilityResolution = {
  support: CapabilitySupport;
  reason: EffectiveCapabilityReason;
  modelSupport: CapabilitySupport;
  protocolSupport: CapabilitySupport;
};

export type AiCapabilityFailureCode = Exclude<EffectiveCapabilityReason, "available">;
export type AiRuntimeFailureCode = "runtime-capability-unsupported" | "runtime-capability-unknown" | "invalid-runtime-value";

export type AiRuntimeValidationFailure = {
  status: "invalid";
  code: AiRuntimeFailureCode;
  option: AiRuntimeCapability;
  requestedValue: AiModelRuntimeValue;
};

export type AiRuntimeValidationResult =
  | { status: "valid"; values: AiSelectedRuntimeValues }
  | AiRuntimeValidationFailure;

/** 只承载稳定分类和安全元数据，不包含凭据、请求正文或厂商原始响应。 */
export class AiCapabilityContractError extends Error {
  readonly code: AiCapabilityFailureCode | AiRuntimeFailureCode;
  readonly capability: AiEffectiveCapability;
  readonly provider: ApiProvider;
  readonly modelId: string;

  constructor(input: {
    code: AiCapabilityFailureCode | AiRuntimeFailureCode;
    capability: AiEffectiveCapability;
    provider: ApiProvider;
    modelId: string;
    message: string;
  }) {
    super(input.message);
    this.name = "AiCapabilityContractError";
    this.code = input.code;
    this.capability = input.capability;
    this.provider = input.provider;
    this.modelId = input.modelId;
  }
}
