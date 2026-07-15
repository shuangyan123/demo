import type { ProviderRuntimeMapper } from "./types";
import { runtimeContext } from "./runtime-context.ts";

/** Gemini 3.x 使用 thinkingLevel，2.5 使用 thinkingBudget；Priority 位于请求顶层。 */
export const mapGoogleRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor?.reasoning && !descriptor?.speed) return { omitTemperature: true };
  const thinkingConfig = descriptor.reasoning?.kind === "budget" && typeof values.reasoning === "number"
    ? { thinkingBudget: values.reasoning }
    : typeof values.reasoning === "string" ? { thinkingLevel: values.reasoning } : undefined;
  return {
    requestFields: values.speed === "priority" ? { serviceTier: "priority" } : {},
    generationFields: thinkingConfig ? { thinkingConfig } : {},
    omitTemperature: true,
  };
};
