import type { AiGenerateRequest } from "../../../services/api-client";

/** 厂商运行 mapper 只返回请求增量，不负责 endpoint、鉴权或响应解析。 */
export type ProviderRuntimeRequestMapping = {
  requestFields?: Record<string, unknown>;
  generationFields?: Record<string, unknown>;
  outputFields?: Record<string, unknown>;
  headers?: Record<string, string>;
  omitTemperature?: boolean;
};

export type ProviderRuntimeMapper = (input: AiGenerateRequest) => ProviderRuntimeRequestMapping;
