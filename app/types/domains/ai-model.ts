import type { ApiProvider } from "./ai-provider";

/** 模型运行选项的可持久化标量值。 */
export type AiModelRuntimeValue = string | number;

/** 单个运行选项；tooltip 只承载简短能力或资格提示。 */
export type AiModelRuntimeOption = {
  id: string;
  label: string;
  value: AiModelRuntimeValue;
  tooltip?: string;
};

/**
 * 具体模型的已核验运行能力。
 * 未命中 descriptor 的在线或手动模型不得通过名称推断能力。
 */
export type AiModelRuntimeDescriptor = {
  provider: ApiProvider;
  modelId: string;
  reasoning?: {
    kind: "effort" | "toggle" | "adaptive" | "budget" | "fixed";
    options: AiModelRuntimeOption[];
    defaultValue: AiModelRuntimeValue;
  };
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
