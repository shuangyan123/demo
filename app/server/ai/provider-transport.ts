import { GoogleGenAI, type Interactions } from "@google/genai";
import type { AiGenerateRequest } from "../../services/api-client.ts";
import { isOfficialGoogleApiBaseUrl } from "../../services/google-connection.ts";
import { getProviderAdapter } from "./provider-adapter-registry.ts";

const PROVIDER_TIMEOUT_MS = 60_000;

export type ProviderTransportContext = {
  signal?: AbortSignal;
};

export type ProviderModelListRequest = {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
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
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  private send(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    const request = getProviderAdapter(input.provider).buildGenerate(input);
    return this.fetcher(request.url, {
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
    return this.fetcher(input.url, {
      headers: input.headers,
      cache: "no-store",
      redirect: "error",
      signal: timeoutSignal(input.signal),
    });
  }
}

type GoogleRequestOptions = {
  timeout: number;
  maxRetries: number;
  fetchOptions: { signal: AbortSignal };
};

/** 可替换的 SDK 调用边界用于验证零重试和单次计费请求。 */
export type GoogleInteractionsInvoker = {
  create(input: Interactions.CreateModelInteractionParamsNonStreaming, options: GoogleRequestOptions): Promise<unknown>;
  createStream(input: Interactions.CreateModelInteractionParamsStreaming, options: GoogleRequestOptions): Promise<AsyncIterable<unknown>>;
};

function createGoogleInvoker(apiKey: string): GoogleInteractionsInvoker {
  const client = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
  return {
    create: (input, options) => client.interactions.create(input, options),
    createStream: async (input, options) => await client.interactions.create(
      { ...input, stream: true as const },
      options,
    ) as unknown as AsyncIterable<unknown>,
  };
}

function responseHeaders(value: unknown): Headers {
  const source = value && typeof value === "object"
    ? (value as { sdkHttpResponse?: { responseInternal?: Response } }).sdkHttpResponse?.responseInternal?.headers
    : undefined;
  const headers = new Headers({ "x-provider-transport": "google-sdk" });
  for (const name of ["x-request-id", "x-gemini-service-tier"]) {
    const header = source?.get(name);
    if (header) headers.set(name, header);
  }
  return headers;
}

function sdkErrorResponse(reason: unknown): Response {
  const error = reason && typeof reason === "object" ? reason as { message?: unknown; status?: unknown; name?: unknown } : {};
  const status = typeof error.status === "number" && error.status >= 400 && error.status <= 599 ? error.status : 502;
  return Response.json({
    error: {
      status: typeof error.name === "string" ? error.name : "SDK_ERROR",
      message: typeof error.message === "string" ? error.message : "Google Interactions SDK 请求失败",
    },
  }, { status });
}

function interactionParams(input: AiGenerateRequest): Interactions.InteractionCreateParams {
  const request = getProviderAdapter(input.provider).buildGenerate(input);
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  if (body.store !== false) throw new Error("Google Interactions 必须使用 store:false");
  return body as Interactions.InteractionCreateParams;
}

/** Google 官方主机的 Interactions 传输；每次调用都显式关闭 SDK 自动重试。 */
export class GoogleInteractionsSdkTransport implements ProviderTransport {
  private readonly httpTransport: HttpProviderTransport;
  private readonly invokerFactory: (apiKey: string) => GoogleInteractionsInvoker;

  constructor(
    invokerFactory: (apiKey: string) => GoogleInteractionsInvoker = createGoogleInvoker,
    fetcher?: typeof fetch,
  ) {
    this.invokerFactory = invokerFactory;
    this.httpTransport = new HttpProviderTransport(fetcher);
  }

  async generate(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    try {
      const signal = timeoutSignal(context?.signal);
      const value = await this.invokerFactory(input.apiKey).create(
        { ...interactionParams(input), stream: false } as Interactions.CreateModelInteractionParamsNonStreaming,
        { timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0, fetchOptions: { signal } },
      );
      const headers = responseHeaders(value);
      const payload = value && typeof value === "object" ? { ...(value as Record<string, unknown>), sdkHttpResponse: undefined } : value;
      return Response.json(payload, { headers });
    } catch (reason) {
      return sdkErrorResponse(reason);
    }
  }

  async stream(input: AiGenerateRequest, context?: ProviderTransportContext): Promise<Response> {
    try {
      const signal = timeoutSignal(context?.signal);
      const events = await this.invokerFactory(input.apiKey).createStream(
        { ...interactionParams(input), stream: true } as Interactions.CreateModelInteractionParamsStreaming,
        { timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0, fetchOptions: { signal } },
      );
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            controller.close();
          } catch (reason) {
            controller.error(reason);
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "Content-Type": "text/event-stream; charset=utf-8",
          "x-provider-transport": "google-sdk",
        },
      });
    } catch (reason) {
      return sdkErrorResponse(reason);
    }
  }

  listModels(input: ProviderModelListRequest): Promise<Response> {
    return this.httpTransport.listModels(input);
  }
}

export const httpProviderTransport = new HttpProviderTransport();
const googleInteractionsSdkTransport = new GoogleInteractionsSdkTransport();

/** 仅官方 Google Interactions 进入 SDK，其余连接保持现有 HTTP 行为。 */
export function getProviderTransport(input: AiGenerateRequest): ProviderTransport {
  return input.provider === "google"
    && input.generationProtocol === "google_interactions"
    && isOfficialGoogleApiBaseUrl(input.baseUrl)
    ? googleInteractionsSdkTransport
    : httpProviderTransport;
}
