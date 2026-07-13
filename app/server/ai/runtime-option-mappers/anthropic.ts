import type { ProviderRuntimeMapper } from "./types";
import { runtimeContext } from "./runtime-context.ts";

/** Claude 新模型组合 adaptive thinking 与 output_config.effort，Fast 追加官方 beta header。 */
export const mapAnthropicRuntimeOptions: ProviderRuntimeMapper = (input) => {
  const { descriptor, values } = runtimeContext(input);
  if (!descriptor) return {};
  const reasoning = descriptor.reasoning;
  const requestFields: Record<string, unknown> = {};
  const outputFields: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  let effectiveMaxOutputTokens: number | undefined;
  if (reasoning?.kind === "adaptive" && typeof values.reasoning === "string") {
    requestFields.thinking = { type: "adaptive" };
    outputFields.effort = values.reasoning;
  } else if (reasoning?.kind === "budget" && typeof values.reasoning === "number") {
    requestFields.thinking = { type: "enabled", budget_tokens: values.reasoning };
    effectiveMaxOutputTokens = values.reasoning + (input.maxOutputTokens ?? 1024);
  }
  if (values.speed === "fast") {
    requestFields.speed = "fast";
    headers["anthropic-beta"] = "fast-mode-2026-02-01";
  }
  return {
    requestFields,
    outputFields,
    headers,
    omitTemperature: reasoning?.kind === "adaptive" || reasoning?.kind === "budget",
    effectiveMaxOutputTokens,
  };
};
