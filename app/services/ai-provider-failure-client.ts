import type { AiGenerateRequest, AiGenerateStreamEvent } from "./api-client.ts";
import type { AiProviderFailure, AiProviderFailureCode } from "./ai-provider-failure.ts";
import { readApiErrorPayload, type ClientApiErrorPayload } from "./api-error.ts";
import type { ApiProvider } from "../types/domains/ai-provider.ts";

type FailureModule = typeof import("./ai-provider-failure.ts");

async function failureModule(): Promise<FailureModule> {
  return import("./ai-provider-failure.ts");
}

export async function throwClientProviderFailure(failure: AiProviderFailure): Promise<never> {
  const { AiProviderFailureError } = await failureModule();
  throw new AiProviderFailureError(failure);
}

function providerFailureFromPayload(
  input: AiGenerateRequest,
  payload: ClientApiErrorPayload,
  httpStatus: number,
  failureApi: FailureModule,
): AiProviderFailure | undefined {
  if (failureApi.isAiProviderFailure(payload.failure)) {
    return {
      ...payload.failure,
      httpStatus: payload.failure.httpStatus ?? httpStatus,
      requestId: payload.failure.requestId ?? payload.requestId,
    };
  }
  if (typeof payload.code !== "string" || !failureApi.aiProviderFailureCodes.includes(payload.code as AiProviderFailureCode)) return undefined;
  const code = payload.code as AiProviderFailureCode;
  return {
    code,
    provider: input.provider,
    retry: payload.retryable ? "after-delay" : "no",
    httpStatus,
    requestId: payload.requestId,
  };
}

export async function throwClientApiFailure(
  input: AiGenerateRequest,
  response: Response,
  fallback: string,
  knownPayload?: ClientApiErrorPayload,
): Promise<never> {
  const payload = knownPayload ?? await readApiErrorPayload(response, fallback);
  const failureApi = await failureModule();
  const failure = providerFailureFromPayload(input, payload, response.status, failureApi);
  if (failure) return throwClientProviderFailure(failure);
  throw new Error(payload.message || fallback);
}

export async function throwClientStreamFailure(input: AiGenerateRequest, event: Extract<AiGenerateStreamEvent, { type: "error" }>): Promise<never> {
  return throwClientStreamFailureForProvider(input.provider, event);
}

/** 供 feature 侧处理未来可直接暴露的归一化 stream error；不得把 typed failure 降级成 message-only Error。 */
export async function throwClientStreamFailureForProvider(provider: ApiProvider, event: Extract<AiGenerateStreamEvent, { type: "error" }>): Promise<never> {
  const failureApi = await failureModule();
  const failure = (failureApi.isAiProviderFailure(event.failure) ? event.failure : undefined)
    ?? (typeof event.code === "string" && failureApi.aiProviderFailureCodes.includes(event.code as AiProviderFailureCode)
      ? { code: event.code as AiProviderFailureCode, provider, retry: event.retryable ? "after-delay" : "no", requestId: event.requestId } satisfies AiProviderFailure
      : undefined);
  if (failure) return throwClientProviderFailure(failure);
  // 未知的 stream error 也必须保持在 typed failure 边界内，不能把厂商原文传播到 consumer。
  return throwClientProviderFailure({ code: "unknown", provider, retry: "no", requestId: event.requestId });
}
