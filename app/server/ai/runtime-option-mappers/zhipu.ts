import type { ProviderRuntimeMapper } from "./types.ts";
import { runtimeContext } from "./runtime-context.ts";

/** GLM-5.2+ 原样发送七档；旧 GLM 仅发送 thinking.type 开关。 */
export const mapZhipuRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor?.reasoning || typeof values.reasoning !== "string") return {};
  if (descriptor.reasoning.kind === "toggle") return { requestFields: { thinking: { type: values.reasoning } }, omitTemperature: values.reasoning === "enabled" };
  return {
    requestFields: { thinking: { type: "enabled" }, reasoning_effort: values.reasoning },
    omitTemperature: !["none", "minimal"].includes(values.reasoning),
  };
};
