import { policyFetch } from "../http/policy-fetch.ts";
import { networkPolicyFromProviderOptions, type OutboundNetworkPolicy } from "../http/outbound-network-policy.ts";
import type { AiGenerateRequest } from "../../services/api-client.ts";
import { getProviderAdapter } from "./provider-adapter-registry.ts";

const PROVIDER_TIMEOUT_MS = 60_000;

export type ProviderTransportContext = {
  signal?: AbortSignal;
};

export type ProviderModelListRequest = {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  networkPolicy?: OutboundNetworkPolicy;
};

/**
 * 厂商网络传输层。适配器负责协议映射，传输层只负责请求、取消和流式字节。
 */
export interface ProviderTransport {
  generate(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response>;
  stream(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response>;
  listModels(input: ProviderModelListRequest): Promise<Response>;
}

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** 原生 HTTP 传输保留自定义代理和兼容厂商的完整 URL 语义。 */
export class HttpProviderTransport implements ProviderTransport {
  private readonly fetcher?: typeof fetch;

  constructor(fetcher?: typeof fetch) {
    this.fetcher = fetcher;
  }

  private send(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    const request = getProviderAdapter(input.provider).buildGenerate(input);
    return (this.fetcher ?? ((url, init) => policyFetch(url, init, networkPolicyFromProviderOptions(input.providerOptions))))(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      cache: "no-store",
      redirect: "error",
      signal: timeoutSignal(context?.signal),
    });
  }

  generate(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    return this.send({ ...input, stream: false }, context);
  }

  stream(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    return this.send({ ...input, stream: true }, context);
  }

  listModels(input: ProviderModelListRequest): Promise<Response> {
    return (this.fetcher ?? ((url, init) => policyFetch(url, init, input.networkPolicy)))(input.url, {
      headers: input.headers,
      cache: "no-store",
      redirect: "error",
      signal: timeoutSignal(input.signal),
    });
  }
}

export const httpProviderTransport = new HttpProviderTransport();

/** SDK 将 fetchOptions 转为 Request 时丢失 dispatcher；同一 Interactions 协议统一走可绑定的 HTTP 适配器。 */
export function getProviderTransport(): ProviderTransport {
  return httpProviderTransport;
}
