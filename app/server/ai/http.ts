/** AI 路由统一返回纯文本错误，避免把异常对象、请求体或凭据序列化给客户端。 */
export function aiRouteError(message: string, status = 500): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 安全读取 JSON；调用方仍负责业务字段校验。 */
export async function readAiRouteJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
}

/** 只暴露上游状态码，不透传可能包含敏感信息的响应正文。 */
export function aiUpstreamError(label: string, status: number): Response {
  return aiRouteError(`${label}：${status}`, status);
}
