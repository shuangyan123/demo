import type { ProviderRuntimeMapper } from "./types.ts";
import { runtimeContext } from "./runtime-context.ts";

/** OpenAI Responses：推理强度进入 reasoning.effort，速度进入 service_tier。 */
export const mapOpenAiRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor) return {};
  return {
    requestFields: {
      ...(typeof values.reasoning === "string" ? { reasoning: { effort: values.reasoning } } : {}),
      ...(values.speed === "priority" ? { service_tier: "priority" } : {}),
    },
    omitTemperature: values.reasoning !== undefined && values.reasoning !== "none",
  };
};
