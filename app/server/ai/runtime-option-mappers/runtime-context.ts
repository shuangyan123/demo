import type { AiGenerateRequest } from "../../../services/api-client";
import { AiCapabilityContractError } from "../../../types/domains/ai-capability.ts";
import { getAiModelRuntimeDescriptor, validateAiSelectedRuntimeValues } from "../../../services/model-runtime-descriptors.ts";

/** 服务端再次按 descriptor 校验运行值，拒绝浏览器伪造未知厂商参数。 */
export function runtimeContext(input: AiGenerateRequest) {
  const descriptor = getAiModelRuntimeDescriptor(input.provider, input.model);
  const validation = validateAiSelectedRuntimeValues(descriptor, input.runtime);
  if (validation.status === "invalid") {
    throw new AiCapabilityContractError({
      code: validation.code,
      capability: validation.option,
      provider: input.provider,
      modelId: input.model,
      message: validation.code === "invalid-runtime-value" ? "运行值不在所选模型允许范围内" : "所选模型的运行能力不可安全确认",
    });
  }
  return { descriptor, values: validation.values };
}
