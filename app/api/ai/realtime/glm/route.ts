import { aiRouteError, readAiRouteJson } from "../../../../server/ai/http";
import { appendGlmRealtimeAudio, drainGlmRealtimeEvents, stopGlmRealtimeRelay } from "../../../../server/ai/glm-realtime-relay";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("sessionId");
  if (!id) return aiRouteError("缺少会话标识", 400);
  return Response.json({ events: drainGlmRealtimeEvents(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const input = await readAiRouteJson(request) as { sessionId?: string; pcmBase64?: string };
    if (!input.sessionId || !input.pcmBase64) return aiRouteError("缺少音频块", 400);
    appendGlmRealtimeAudio(input.sessionId, input.pcmBase64);
    return Response.json({ accepted: true });
  } catch (reason) { return aiRouteError(reason instanceof Error ? reason.message : "音频块发送失败", 400); }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("sessionId");
  if (id) stopGlmRealtimeRelay(id);
  return Response.json({ stopped: true });
}
