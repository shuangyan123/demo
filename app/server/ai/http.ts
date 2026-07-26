import { RouteSecurityError, apiErrorResponse, readRouteJson } from "../http/route-security.ts";

/** AI 路由统一返回结构化、脱敏错误。 */
export function aiRouteError(message: string, status = 500, code = "ai_route_error"): Response {
  return apiErrorResponse(new RouteSecurityError(code, message, status), {
    code,
    message,
    status,
  });
}

/** 安全读取有界 JSON；调用方仍负责业务字段校验。 */
export { readRouteJson as readAiRouteJson };

/** 只暴露上游状态码，不透传可能包含敏感信息的响应正文。 */
export function aiUpstreamError(label: string, status: number): Response {
  return aiRouteError(`${label}：${status}`, status, "ai_upstream_error");
}
