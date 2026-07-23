import { FenbiAccountImportAdapter, FenbiAccountImportError } from "@/app/server/import/fenbi-account-import-adapter";
import type { FenbiSyncEvent, FenbiSyncScope, ImportDraft } from "@/app/types/review";
import { apiErrorResponse, createRequestId, readRouteJson } from "@/app/server/http/route-security";

export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(event: FenbiSyncEvent<ImportDraft>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** 以 SSE 返回同步阶段和草稿；响应结束后服务端内存中的 Cookie 随请求释放。 */
export async function POST(request: Request) {
  const requestId = createRequestId();
  let input: { cookie?: string; scope?: FenbiSyncScope };
  try {
    input = await readRouteJson(request, 64 * 1024);
  } catch (error) {
    return apiErrorResponse(error, { code: "invalid_fenbi_sync", message: "粉笔同步请求无效", status: 400 });
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const drafts = await new FenbiAccountImportAdapter().sync(
          input.cookie ?? "",
          input.scope ?? { wrongOnly: true, sinceDays: 30 },
          (progress) => {
            if (progress.stage) controller.enqueue(encodeEvent({ type: "stage", stage: progress.stage }));
            if (typeof progress.completed === "number") controller.enqueue(encodeEvent({ type: "progress", completed: progress.completed, total: progress.total }));
          },
          request.signal,
        );
        controller.enqueue(encodeEvent({ type: "drafts", drafts }));
        controller.enqueue(encodeEvent({ type: "done", parsed: drafts.length, duplicates: 0, pending: drafts.length }));
      } catch (error) {
        const known = error instanceof FenbiAccountImportError ? error : new FenbiAccountImportError("upstream_unavailable", "粉笔同步失败，请稍后重试。", 502);
        controller.enqueue(encodeEvent({ type: "error", code: known.code, message: known.message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}
