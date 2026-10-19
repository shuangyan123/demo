import { outboundFetch } from "../../../../server/http/outbound-fetch.ts";
import { aiRouteError, readAiRouteJson } from "../../../../server/ai/http";
import { startGlmRealtimeRelay } from "../../../../server/ai/glm-realtime-relay";
import { apiJsonResponse } from "../../../../server/http/route-security.ts";

type SessionRequest = { provider: "openai" | "google" | "zhipu"; apiKey: string; model: string; voiceId: string };

/** 创建短期实时会话；长期 Key 只用于本次服务端交换，不写入响应或日志。 */
export async function POST(request: Request) {
  try {
    const input = await readAiRouteJson(request) as Partial<SessionRequest>;
    if (!input.provider || !input.apiKey || !input.model || !input.voiceId) return aiRouteError("缺少实时语音会话参数", 400);
    if (input.provider === "zhipu") return apiJsonResponse({ provider: input.provider, relaySessionId: await startGlmRealtimeRelay(input as SessionRequest) });
    const url = input.provider === "openai" ? "https://api.openai.com/v1/realtime/client_secrets" : "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
    const response = await outboundFetch(url, {
      method: "POST",
      headers: input.provider === "openai" ? { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" } : { "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(input.provider === "openai"
        ? { session: { type: "realtime", model: input.model, audio: { output: { voice: input.voiceId } } } }
        : { uses: 1, expireTime: new Date(Date.now() + 60_000).toISOString(), newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(), liveConnectConstraints: { model: `models/${input.model}` } }),
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    }, { allowLoopback: false, allowPrivateNetwork: false });
    if (!response.ok) { await response.body?.cancel(); return aiRouteError(`临时凭据创建失败（${response.status}）`, response.status); }
    const payload = await response.json() as Record<string, unknown>;
    const token = input.provider === "openai" ? (payload.value ?? (payload.client_secret as Record<string, unknown> | undefined)?.value) : payload.name;
    if (typeof token !== "string") return aiRouteError("厂商未返回临时凭据", 502);
    return apiJsonResponse({ provider: input.provider, token, expiresIn: 60 });
  } catch { return aiRouteError("实时语音会话创建失败"); }
}
