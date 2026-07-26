import { aiRouteError, readAiRouteJson } from "../../../../server/ai/http";
import { appendGlmRealtimeAudio, drainGlmRealtimeEvents, stopGlmRealtimeRelay } from "../../../../server/ai/glm-realtime-relay";
import { apiJsonResponse, assertSameOrigin } from "../../../../server/http/route-security.ts";

const MAX_REALTIME_AUDIO_CHUNK_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request) {
  assertSameOrigin(request);
  const id = new URL(request.url).searchParams.get("sessionId");
  if (!id) return aiRouteError("缺少会话标识", 400);
  return apiJsonResponse({ events: drainGlmRealtimeEvents(id) });
}

export async function POST(request: Request) {
  try {
    const input = await readAiRouteJson(request, MAX_REALTIME_AUDIO_CHUNK_BYTES) as { sessionId?: string; pcmBase64?: string };
    if (!input.sessionId || !input.pcmBase64) return aiRouteError("缺少音频块", 400);
    appendGlmRealtimeAudio(input.sessionId, input.pcmBase64);
    return apiJsonResponse({ accepted: true });
  } catch (reason) { return aiRouteError(reason instanceof Error ? reason.message : "音频块发送失败", 400); }
}

export async function DELETE(request: Request) {
  assertSameOrigin(request);
  const id = new URL(request.url).searchParams.get("sessionId");
  if (id) stopGlmRealtimeRelay(id);
  return apiJsonResponse({ stopped: true });
}
