import { safeFetchAcquisition } from "../../../server/acquisition/safe-fetch.ts";
import { acquisitionOrigins } from "../../../server/acquisition/origin-policy.ts";
import { apiErrorResponse, apiJsonResponse, readRouteJson } from "../../../server/http/route-security.ts";

type AcquisitionFetchRequest = { url?: string; allowedOrigins?: string[] };

/** 外部资料安全抓取端点；不返回 Cookie、请求头或其他运行期敏感信息。 */
export async function POST(request: Request) {
  try {
    const body = await readRouteJson<AcquisitionFetchRequest>(request, 64 * 1024);
    if (typeof body.url !== "string" || !body.url || !Array.isArray(body.allowedOrigins) || !body.allowedOrigins.every(value => typeof value === "string")) {
      return apiErrorResponse(undefined, { code: "invalid_acquisition_request", message: "缺少来源 URL 或允许域名", status: 400 });
    }
    const result = await safeFetchAcquisition({ url: body.url, allowedOrigins: acquisitionOrigins(body.allowedOrigins) });
    return apiJsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "来源抓取失败";
    const status = /只允许|允许域名|禁止访问|必须提供/.test(message) ? 403 : 422;
    return apiErrorResponse(error, { code: "acquisition_fetch_failed", message, status, retryable: status >= 500 });
  }
}
