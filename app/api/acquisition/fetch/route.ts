import { safeFetchAcquisition } from "../../../server/acquisition/safe-fetch";

type AcquisitionFetchRequest = { url?: string; allowedOrigins?: string[] };

/** 外部资料安全抓取端点；不返回 Cookie、请求头或其他运行期敏感信息。 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as AcquisitionFetchRequest;
    if (!body.url || !Array.isArray(body.allowedOrigins)) return Response.json({ error: "缺少来源 URL 或允许域名" }, { status: 400 });
    const result = await safeFetchAcquisition({ url: body.url, allowedOrigins: body.allowedOrigins });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "来源抓取失败";
    const status = /只允许|允许域名|禁止访问|必须提供/.test(message) ? 403 : 422;
    return Response.json({ error: message }, { status });
  }
}
