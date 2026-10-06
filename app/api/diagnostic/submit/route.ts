import { apiErrorResponse, assertSameOrigin, RouteSecurityError } from "../../../server/http/route-security.ts";
import { commitDiagnosticSubmission } from "../../../server/diagnostic/assessment-submission.ts";

export const runtime = "nodejs";

function assertDiagnosticOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin")
    throw new RouteSecurityError("cross_origin_request", "拒绝跨来源请求", 403);
  // 全站 no-referrer 使原生 POST 的 Origin 为 null；只认浏览器不可由网页伪造的完整同源导航元数据。
  if (request.headers.get("origin") === "null") {
    if (site === "same-origin" && request.headers.get("sec-fetch-mode") === "navigate"
      && request.headers.get("sec-fetch-dest") === "document") return;
    throw new RouteSecurityError("cross_origin_request", "拒绝无法确认来源的表单", 403);
  }
  assertSameOrigin(request);
}

/** 小型原生 form body 仍有 streaming 上限；重复字段与所有 authority 字段都拒绝。 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertDiagnosticOrigin(request);
    if (request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded")
      throw new RouteSecurityError("invalid_form", "提交格式无效", 400);
    if (!request.body) throw new RouteSecurityError("invalid_form", "提交内容缺失", 400);
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); throw new RouteSecurityError("payload_too_large", "提交内容过长", 413); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    const form = new URLSearchParams(body);
    const fields = [...form.keys()];
    if (fields.length !== 2 || !form.has("sessionId") || !form.has("selectedOptionId"))
      throw new RouteSecurityError("invalid_form", "提交字段无效", 400);
    const sessionId = form.get("sessionId")!;
    const result = commitDiagnosticSubmission({ sessionId, selectedOptionId: form.get("selectedOptionId")! });
    if (result.kind !== "submitted") return apiErrorResponse(undefined, { code: "submission_rejected",
      message: "本次提交未完成，请重新开始。", status: result.kind === "rejected" ? 409 : 503 });
    return new Response(null, { status: 303, headers: {
      location: `/diagnostic?session=${encodeURIComponent(sessionId)}`, "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
  } catch (error) {
    return apiErrorResponse(error, { code: "invalid_submission", message: "无法处理本次提交。", status: 400 });
  }
}
