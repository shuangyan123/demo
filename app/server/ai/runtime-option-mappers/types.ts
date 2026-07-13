import type { AiGenerateRequest } from "../../../services/api-client";

/** 厂商运行 mapper 只返回请求增量，不负责 endpoint、鉴权或响应解析。 */
export type ProviderRuntimeRequestMapping = {
  requestFields?: Record<string, unknown>;
  generationFields?: Record<string, unknown>;
  outputFields?: Record<string, unknown>;
  headers?: Record<string, string>;
  omitTemperature?: boolean;
  /** Claude 扩展思考需要把思考预算计入厂商的 max_tokens 上限。 */
  effectiveMaxOutputTokens?: number;
};

export type ProviderRuntimeMapper = (input: AiGenerateRequest) => ProviderRuntimeRequestMapping;
