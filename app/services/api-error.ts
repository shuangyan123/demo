import type { AiProviderFailure } from "./ai-provider-failure.ts";

export type ClientApiErrorPayload = {
  code?: string;
  message?: string;
  requestId?: string;
  retryable?: boolean;
  failure?: AiProviderFailure;
  /** 旧接口在迁移期可能仍返回 error 字段。 */
  error?: string;
};

/**
 * 只接受本机 API 的结构化 JSON 错误。
 * HTML/纯文本可能是框架错误页、代理响应或上游正文，不能进入 UI、诊断或持久化。
 */
export async function readApiErrorPayload(response: Response, fallback: string): Promise<ClientApiErrorPayload> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json() as ClientApiErrorPayload;
      return { ...payload, message: payload.message || payload.error || fallback };
    } catch {
      return { message: fallback };
    }
  }
  return { message: fallback };
}

export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await readApiErrorPayload(response, fallback);
  return payload.message || fallback;
}
