export type ClientApiErrorPayload = {
  code?: string;
  message?: string;
  requestId?: string;
  retryable?: boolean;
  /** 旧接口在迁移期可能仍返回 error 字段。 */
  error?: string;
};

/** 同时兼容结构化错误与历史纯文本错误，避免升级期间丢失可行动提示。 */
export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json() as ClientApiErrorPayload;
      return payload.message || payload.error || fallback;
    } catch {
      return fallback;
    }
  }
  const text = await response.text();
  return text || fallback;
}
