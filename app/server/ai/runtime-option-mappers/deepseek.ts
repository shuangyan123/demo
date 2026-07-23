import type { ProviderRuntimeMapper } from "./types.ts";
import { runtimeContext } from "./runtime-context.ts";

/** DeepSeek V4 只开放关闭、high 与 max，低兼容档不进入普通菜单。 */
export const mapDeepSeekRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor?.reasoning || typeof values.reasoning !== "string") return {};
  const disabled = values.reasoning === "disabled";
  return {
    requestFields: { thinking: { type: disabled ? "disabled" : "enabled" }, ...(!disabled ? { reasoning_effort: values.reasoning } : {}) },
    omitTemperature: !disabled,
  };
};
