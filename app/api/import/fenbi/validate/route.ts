import { FenbiAccountImportAdapter, FenbiAccountImportError } from "@/app/server/import/fenbi-account-import-adapter";
import { apiErrorResponse, apiJsonResponse, readRouteJson } from "@/app/server/http/route-security";

export const runtime = "nodejs";

/** 验证粉笔 Cookie；服务端不保存 Cookie，也不返回上游原始响应。 */
export async function POST(request: Request) {
  try {
    const input = await readRouteJson<{ cookie?: string }>(request, 64 * 1024);
    await new FenbiAccountImportAdapter().validate(input.cookie ?? "", request.signal);
    return apiJsonResponse({ valid: true });
  } catch (error) {
    const known = error instanceof FenbiAccountImportError ? error : new FenbiAccountImportError("upstream_unavailable", "粉笔验证失败，请稍后重试。", 502);
    return apiErrorResponse(error, {
      code: known.code,
      message: known.message,
      status: known.status,
      retryable: known.status === 429 || known.status >= 500,
    });
  }
}
