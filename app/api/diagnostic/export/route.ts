import { exportDiagnosticHistory } from "../../../server/diagnostic/history-export.ts";
import { apiErrorResponse, assertSameOrigin, RouteSecurityError } from "../../../server/http/route-security.ts";

export const runtime = "nodejs";

/** 无参数同源导出；桌面仍由既有 Main protocol / runtime-token proxy 保护。 */
export async function POST(request: Request): Promise<Response> {
  try {
    const site = request.headers.get("sec-fetch-site");
    // review-app fetch 不带 Fetch Metadata，Main 转发也移除 Origin；访问权限仍由既有 runtime-token proxy 校验。
    const desktopTransport = site === null && request.headers.get("origin") === null;
    if ((site !== "same-origin" && !desktopTransport)
      || request.headers.get("x-recall-export-intent") !== "diagnostic-history")
      throw new RouteSecurityError("export_origin_rejected", "无法确认导出请求来源", 403);
    assertSameOrigin(request);
    if (new URL(request.url).search)
      throw new RouteSecurityError("export_parameters_rejected", "导出不接受路径或记录参数", 400);
    // Next 的零字节 POST 也可能有 body stream；只读第一块，不信任 Content-Length 或缓冲任意输入。
    if (request.body) {
      const reader = request.body.getReader();
      try {
        if (!(await reader.read()).done) {
          await reader.cancel();
          throw new RouteSecurityError("export_parameters_rejected", "导出不接受路径或记录参数", 400);
        }
      } finally { reader.releaseLock(); }
    }
    const result = exportDiagnosticHistory();
    if (result.kind !== "exported") return apiErrorResponse(undefined, {
      code: `diagnostic_export_${result.kind}`, status: 503,
      message: result.kind === "busy" ? "学习记录正在保存，请稍后手动重试导出。"
        : "诊断学习历史无法完整读取，未生成导出文件。现有资料保持不变。",
    });
    return new Response(result.source, { headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      "x-content-type-options": "nosniff", "content-disposition": 'attachment; filename="recall-diagnostic-history-export.json"',
    } });
  } catch (error) {
    return apiErrorResponse(error, { code: "diagnostic_export_failed", message: "导出未完成，现有资料保持不变。", status: 503 });
  }
}
