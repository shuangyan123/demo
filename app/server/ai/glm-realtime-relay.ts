import WebSocket from "ws";
import type { RealtimeVoiceEvent } from "../../types/domains/voice.ts";

type RelaySession = { socket: WebSocket; events: RealtimeVoiceEvent[]; touchedAt: number };
const sessions = new Map<string, RelaySession>();
const MAX_EVENT_QUEUE = 120;

function sanitizeError(reason: unknown): string {
  return (reason instanceof Error ? reason.message : "GLM 实时连接失败").replace(/Bearer\s+\S+/gi, "Bearer [已过滤]").slice(0, 240);
}

function normalizeGlmEvent(value: unknown): RealtimeVoiceEvent[] {
  if (!value || typeof value !== "object") return [];
  const event = value as Record<string, unknown>;
  const type = String(event.type ?? "");
  if (type.includes("audio") && typeof event.delta === "string") return [{ type: "audio", pcmBase64: event.delta, sampleRate: 24000 }];
  if (type.includes("transcript") && typeof event.transcript === "string") return [{ type: "transcript", role: type.includes("input") ? "user" : "assistant", text: event.transcript, final: type.includes("done") }];
  if (type.includes("error")) return [{ type: "error", message: sanitizeError(event.message) }];
  return [];
}

function enqueue(session: RelaySession, event: RealtimeVoiceEvent): void {
  session.events.push(event);
  if (session.events.length > MAX_EVENT_QUEUE) session.events.splice(0, session.events.length - MAX_EVENT_QUEUE);
}

/** GLM 浏览器不能设置 WebSocket Authorization，因此由本地单实例进程持有短生命周期上游连接。 */
export function startGlmRealtimeRelay(input: { apiKey: string; model: string; voiceId: string }): string {
  cleanupGlmRealtimeRelays();
  const id = crypto.randomUUID();
  const socket = new WebSocket("wss://open.bigmodel.cn/api/paas/v4/realtime", { headers: { Authorization: `Bearer ${input.apiKey}` } });
  const session: RelaySession = { socket, events: [{ type: "setup" }], touchedAt: Date.now() };
  sessions.set(id, session);
  socket.on("open", () => {
    socket.send(JSON.stringify({ type: "session.update", session: { model: input.model, voice: input.voiceId, modalities: ["audio", "text"] } }));
    enqueue(session, { type: "connected" });
  });
  socket.on("message", (data) => {
    session.touchedAt = Date.now();
    try { for (const event of normalizeGlmEvent(JSON.parse(data.toString()) as unknown)) enqueue(session, event); }
    catch { enqueue(session, { type: "error", message: "GLM 返回了无法解析的实时事件" }); }
  });
  socket.on("error", (reason) => enqueue(session, { type: "error", message: sanitizeError(reason) }));
  socket.on("close", () => enqueue(session, { type: "ended" }));
  return id;
}

export function appendGlmRealtimeAudio(id: string, pcmBase64: string): void {
  const session = sessions.get(id);
  if (!session || session.socket.readyState !== WebSocket.OPEN) throw new Error("GLM 实时会话未连接");
  if (pcmBase64.length > 512_000) throw new Error("单个音频块超过容量限制");
  session.touchedAt = Date.now();
  session.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcmBase64 }));
}

export function drainGlmRealtimeEvents(id: string): RealtimeVoiceEvent[] {
  const session = sessions.get(id);
  if (!session) return [{ type: "ended" }];
  session.touchedAt = Date.now();
  return session.events.splice(0);
}

export function stopGlmRealtimeRelay(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.socket.close();
  sessions.delete(id);
}

export function cleanupGlmRealtimeRelays(now = Date.now()): void {
  for (const [id, session] of sessions) if (now - session.touchedAt > 120_000) stopGlmRealtimeRelay(id);
}
