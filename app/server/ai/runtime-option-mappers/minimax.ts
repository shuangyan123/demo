import type { ProviderRuntimeMapper } from "./types";
import { runtimeContext } from "./runtime-context.ts";

/** MiniMax M3 映射自适应思考与优先档；M2.x 高速由配对模型 ID 完成。 */
export const mapMiniMaxRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor) return {};
  return {
    requestFields: {
      ...(descriptor.reasoning?.kind === "adaptive" && typeof values.reasoning === "string" ? { thinking: { type: values.reasoning } } : {}),
      ...(values.speed === "priority" ? { service_tier: "priority" } : {}),
    },
    omitTemperature: values.reasoning === "adaptive",
  };
};
