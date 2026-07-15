type GoogleErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ reason?: string; fieldViolations?: Array<{ field?: string; description?: string }> }>;
  };
};

/** 移除 URL、疑似凭据和控制字符，只保留当前测试卡需要的简短诊断。 */
function sanitizeGoogleErrorText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/AIza[\w-]{20,}/g, "[KEY]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/** 将 Google 标准错误包络归一化为不泄露请求内容的可行动提示。 */
export async function googleUpstreamFailureMessage(response: Response, fallbackStage = "请求"): Promise<string> {
  let payload: GoogleErrorPayload = {};
  try {
    payload = JSON.parse(await response.text()) as GoogleErrorPayload;
  } catch {
    // 非 JSON 响应只使用状态码，禁止把代理 HTML 或原始正文展示给用户。
  }
  const error = payload.error;
  const status = error?.status?.toUpperCase();
  const violation = error?.details?.flatMap((detail) => detail.fieldViolations ?? [])[0];
  const detail = sanitizeGoogleErrorText(violation?.description ?? error?.message ?? "");
  const suffix = detail ? `：${detail}` : "";

  if (response.status === 400 || status === "INVALID_ARGUMENT") return `Google 参数不兼容${suffix}`;
  if (response.status === 401 || status === "UNAUTHENTICATED") return `Google API Key 无效或已失效${suffix}`;
  if (response.status === 403 || status === "PERMISSION_DENIED") return `Google API Key 无权访问所选模型或项目${suffix}`;
  if (response.status === 404 || status === "NOT_FOUND") return `Google 模型或 API 地址不存在${suffix}`;
  if (response.status === 429 || status === "RESOURCE_EXHAUSTED") return `Google 配额不足或请求过于频繁${suffix}`;
  if (response.status >= 500) return `Google 服务暂时不可用（${response.status}）`;
  return `Google ${fallbackStage}失败（${response.status}）${suffix}`;
}
