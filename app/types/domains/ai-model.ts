import type { ApiProvider } from "./ai-provider.ts";

/** Google 文本生成按具体模型选择的官方协议。 */
export type AiGenerationProtocol =
  | "google_generate_content"
  | "google_interactions";

/** 模型运行选项的可持久化标量值。 */
export type AiModelRuntimeValue = string | number;

/** 单个运行选项；tooltip 只承载简短能力或资格提示。 */
export type AiModelRuntimeOption = {
  id: string;
  label: string;
  value: AiModelRuntimeValue;
  tooltip?: string;
};

/** 可输入的自定义推理预算闭区间。 */
export type AiModelRuntimeCustomRange = {
  min: number;
  max: number;
};

/** 预设档位型推理能力；此分支不接受任意数值。 */
type AiModelPresetReasoningDescriptor = {
  kind: "effort" | "toggle" | "adaptive" | "fixed";
  options: AiModelRuntimeOption[];
  defaultValue: AiModelRuntimeValue;
  customRange?: never;
};

/** 预算型推理能力；预设哨兵值与自定义整数范围分别校验。 */
type AiModelBudgetReasoningDescriptor = {
  kind: "budget";
  options: AiModelRuntimeOption[];
  defaultValue: number;
  customRange: AiModelRuntimeCustomRange;
};

/** 按 kind 判别的模型推理运行能力。 */
export type AiModelReasoningDescriptor = AiModelPresetReasoningDescriptor | AiModelBudgetReasoningDescriptor;

/**
 * 具体模型的已核验运行能力。
 * 未命中 descriptor 的在线或手动模型不得通过名称推断能力。
 */
export type AiModelRuntimeDescriptor = {
  provider: ApiProvider;
  modelId: string;
  reasoning?: AiModelReasoningDescriptor;
  speed?: {
    kind: "service_tier" | "fast_mode" | "paired_model";
    options: Array<Omit<AiModelRuntimeOption, "value"> & { value: string }>;
    defaultValue: string;
  };
  documentationUrl: string;
  verifiedAt: string;
};

/** 会话只持久化归一化运行值，不保存厂商请求字段。 */
export type AiSelectedRuntimeValues = {
  reasoning?: AiModelRuntimeValue;
  speed?: string;
};
