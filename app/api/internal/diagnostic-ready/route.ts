import { timingSafeEqual } from "node:crypto";
import { readDiagnosticRuntimeReadiness } from "../../../server/diagnostic/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** proxy 会去除通用 runtime header；本 endpoint 用独立 header 再验同一个 Main-owned 随机 token。
 * 无 desktop token 的普通 Web 不提供此入口；认证失败不读取 runtime。
 */
export function GET(request: Request): Response {
  const required = process.env.REVIEW_DESKTOP_RUNTIME_TOKEN;
  const supplied = request.headers.get("x-review-startup-token");
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (!required || !/^[A-Za-z0-9_-]{43}$/.test(required)) return new Response(null, { status: 404, headers });
  if (!supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(required)))
    return new Response(null, { status: 403, headers });
  const status = readDiagnosticRuntimeReadiness();
  return Response.json(status, { status: status.kind === "ready" ? 200 : 503, headers });
}
