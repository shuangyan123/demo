import type { ApiProvider } from "../types/review";

export type AiReasoningOption = { id: string; label: string };
export type AiModelReasoningDescriptor = { parameter: "reasoning_effort" | "thinking_level" | "effort" | "thinking" | "automatic"; defaultValue: string; options: AiReasoningOption[]; readOnly?: boolean };

const effort = ["low", "medium", "high"].map((id) => ({ id, label: id === "low" ? "低" : id === "medium" ? "中" : "高" }));

/** 仅声明厂商官方支持的推理控制；没有公开控制项的模型不显示选择器。 */
export function getModelReasoningDescriptor(provider: ApiProvider, modelId: string): AiModelReasoningDescriptor | undefined {
  const id = modelId.toLowerCase();
  if (provider === "openai" && /gpt-5|o\d/.test(id)) return { parameter: "reasoning_effort", defaultValue: "medium", options: [...effort, { id: "xhigh", label: "极高" }] };
  if (provider === "xai" && id.includes("grok-4")) return { parameter: "reasoning_effort", defaultValue: "high", options: effort };
  if (provider === "google" && id.includes("gemini-3")) return { parameter: "thinking_level", defaultValue: "high", options: id.includes("flash") ? [{ id: "minimal", label: "最小" }, ...effort] : [{ id: "low", label: "低" }, { id: "high", label: "高" }] };
  if (provider === "anthropic" && /claude-(?:fable|sonnet|opus)/.test(id)) return { parameter: "effort", defaultValue: "high", options: [...effort, { id: "max", label: "最大" }] };
  if (provider === "deepseek" && id.includes("deepseek-v4")) return { parameter: "thinking", defaultValue: "enabled", options: [{ id: "disabled", label: "关闭思考" }, { id: "enabled", label: "开启思考" }] };
  if (provider === "zhipu" && /glm-(?:5|4\.)/.test(id)) return { parameter: "thinking", defaultValue: "enabled", options: [{ id: "disabled", label: "关闭思考" }, { id: "enabled", label: "开启思考" }] };
  if (provider === "minimax" && id === "minimax-m3") return { parameter: "automatic", defaultValue: "auto", options: [{ id: "auto", label: "自动交错思考" }], readOnly: true };
  return undefined;
}

/** 把统一会话选项映射为服务端 adapter 已识别的厂商参数。 */
export function reasoningProviderOptions(provider: ApiProvider, modelId: string, value?: string): Record<string, string> {
  const descriptor = getModelReasoningDescriptor(provider, modelId);
  if (!descriptor || descriptor.parameter === "automatic") return {};
  const selected = descriptor.options.some((option) => option.id === value) ? value! : descriptor.defaultValue;
  if (descriptor.parameter === "thinking") return { thinking: selected };
  if (descriptor.parameter === "thinking_level") return { thinkingLevel: selected };
  return { reasoningEffort: selected };
}
