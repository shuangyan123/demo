import type { AiGenerateRequest } from "../../../services/api-client";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues } from "../../../services/model-runtime-descriptors.ts";

/** 服务端再次按 descriptor 校验运行值，拒绝浏览器伪造未知厂商参数。 */
export function runtimeContext(input: AiGenerateRequest) {
  const descriptor = getAiModelRuntimeDescriptor(input.provider, input.model);
  return { descriptor, values: normalizeAiSelectedRuntimeValues(descriptor, input.runtime) };
}
