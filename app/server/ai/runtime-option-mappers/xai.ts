import type { ProviderRuntimeMapper } from "./types";
import { runtimeContext } from "./runtime-context.ts";

/** Grok 4.5 在 Responses 请求中使用 reasoning.effort；多代理模型不在本 mapper 中声明。 */
export const mapXaiRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor) return {};
  return {
    requestFields: {
      ...(typeof values.reasoning === "string" ? { reasoning: { effort: values.reasoning } } : {}),
      ...(values.speed === "priority" ? { service_tier: "priority" } : {}),
    },
    omitTemperature: values.reasoning !== undefined,
  };
};
