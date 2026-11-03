import type { AiGenerateRequest } from "../../services/api-client.ts";
import { outboundFetch } from "../http/outbound-fetch.ts";
import { networkPolicyFromProviderOptions, type OutboundNetworkPolicy } from "../http/outbound-network-policy.ts";
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
  private readonly fetcher: typeof fetch;

  constructor(fetcher?: typeof fetch) {
    this.fetcher = fetcher ?? outboundFetch;
  }

  private send(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    const request = getProviderAdapter(input.provider).buildGenerate(input);
    const fetcher: typeof fetch = this.fetcher === outboundFetch ? (url, init) => outboundFetch(url, init, networkPolicyFromProviderOptions(input.providerOptions)) : this.fetcher;
    return fetcher(request.url, {
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
    const fetcher: typeof fetch = this.fetcher === outboundFetch ? (url, init) => outboundFetch(url, init, input.networkPolicy) : this.fetcher;
    return fetcher(input.url, {
      headers: input.headers,
      cache: "no-store",
      redirect: "error",
      signal: timeoutSignal(input.signal),
    });
  }
}

export const httpProviderTransport = new HttpProviderTransport();

/** Interactions 复用已有 wire adapter，确保实际连接经过同一安全边界；不自动重试或 fallback。 */
export function getProviderTransport(input: AiGenerateRequest): ProviderTransport {
  void input;
  return httpProviderTransport;
}
