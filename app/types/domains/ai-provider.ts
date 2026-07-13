/**
 * AI 厂商标识的稳定领域类型。
 *
 * 活跃厂商与历史兼容厂商共用这一联合，避免模型运行领域反向依赖兼容总表。
 */
export type ApiProvider =
  | "openai"
  | "azure_openai"
  | "google"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "qwen"
  | "openrouter"
  | "groq"
  | "mistral"
  | "elevenlabs"
  | "azure"
  | "minimax"
  | "zhipu"
  | "kimi"
  | "doubao"
  | "siliconflow"
  | "baidu"
  | "tencent"
  | "custom";
