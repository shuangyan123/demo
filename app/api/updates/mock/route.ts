import { readMockUpdate } from "../../../server/updates/mock-source.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 此接口只有模拟公告，没有安装包；场景仅由本地启动环境选择，不接受请求参数。 */
export function GET(request: Request): Response {
  // Main 总会为打包子进程重新生成 runtime token。即使父环境指定场景，也只返回关闭状态。
  const scenario = process.env.REVIEW_DESKTOP_RUNTIME_TOKEN === undefined
    ? process.env.RECALL_UPDATE_MOCK_SCENARIO : undefined;
  const result = new URL(request.url).search ? { status: 400, source: '{"code":"parameters_rejected"}' }
    : readMockUpdate(scenario);
  return new Response(result.source, { status: result.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
