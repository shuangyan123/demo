const DEFAULT_JSON_LIMIT_BYTES = 256 * 1024;
const AUTHORIZATION_BEARER_PATTERN = /authorization\s*[:=]\s*bearer\s+\S+/gi;
const BEARER_ERROR_PATTERN = /bearer\s+\S+/gi;
const SENSITIVE_ERROR_PATTERN = /(api[-_ ]?key|token|cookie|authorization)\s*[:=]\s*\S+/gi;

export type ApiErrorPayload = {
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
};

export class RouteSecurityError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    status: number,
    retryable = false,
  ) {
    super(message);
    this.name = "RouteSecurityError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** 为单次本机 API 调用生成不含业务数据的关联标识。 */
export function createRequestId(): string {
  return crypto.randomUUID();
}

/** 拒绝来自其他网页 Origin 的浏览器请求；无 Origin 的本机 CLI/内部调用保持兼容。 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let expected: string;
  try {
    expected = new URL(request.url).origin;
  } catch {
    throw new RouteSecurityError("invalid_request_url", "请求地址无效", 400);
  }
  if (origin !== expected) throw new RouteSecurityError("cross_origin_request", "拒绝跨来源请求", 403);
}

/** 读取有界 JSON，避免在解析前把超大请求体完整载入内存。 */
export async function readRouteJson<T = unknown>(
  request: Request,
  maxBytes = DEFAULT_JSON_LIMIT_BYTES,
): Promise<T> {
  assertSameOrigin(request);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RouteSecurityError("payload_too_large", "请求内容超过安全上限", 413);
  }
  if (!request.body) throw new RouteSecurityError("invalid_json", "请求缺少 JSON 内容", 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let source = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new RouteSecurityError("payload_too_large", "请求内容超过安全上限", 413);
    }
    source += decoder.decode(value, { stream: true });
  }
  source += decoder.decode();
  try {
    return JSON.parse(source) as T;
  } catch {
    throw new RouteSecurityError("invalid_json", "请求 JSON 格式无效", 400);
  }
}

/** 校验用户配置的外联地址，不允许协议注入或 URL 内嵌凭据。 */
export function validateOutboundHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new RouteSecurityError("invalid_endpoint", "外联地址无效", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new RouteSecurityError("invalid_endpoint", "外联地址只允许 HTTP(S)", 400);
  }
  if (url.username || url.password) {
    throw new RouteSecurityError("embedded_credentials", "外联地址不得包含用户名或密码", 400);
  }
  url.hash = "";
  return url;
}

/** 错误文本只保留可行动短消息，并遮蔽常见凭据形状。 */
export function sanitizeRouteMessage(message: string): string {
  return message
    .replace(AUTHORIZATION_BEARER_PATTERN, "Authorization: ***")
    .replace(BEARER_ERROR_PATTERN, "Bearer ***")
    .replace(SENSITIVE_ERROR_PATTERN, "$1: ***")
    .slice(0, 240);
}

/** 统一 API 错误结构和安全响应头。 */
export function apiErrorResponse(
  error: unknown,
  fallback: { code: string; message: string; status?: number; retryable?: boolean },
  requestId = createRequestId(),
): Response {
  const known = error instanceof RouteSecurityError ? error : undefined;
  const payload: ApiErrorPayload = {
    code: known?.code ?? fallback.code,
    message: sanitizeRouteMessage(known?.message ?? fallback.message),
    requestId,
    retryable: known?.retryable ?? fallback.retryable ?? false,
  };
  return Response.json(payload, {
    status: known?.status ?? fallback.status ?? 500,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}

/** 为成功 JSON 响应补齐关联标识和禁止缓存头。 */
export function apiJsonResponse(
  data: unknown,
  init: { status?: number; requestId?: string; cacheControl?: string } = {},
): Response {
  const requestId = init.requestId ?? createRequestId();
  return Response.json(data, {
    status: init.status,
    headers: {
      "cache-control": init.cacheControl ?? "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
    },
  });
}
