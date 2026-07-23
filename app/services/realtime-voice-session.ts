"use client";

import { aiConnectionsRepository } from "./ai-connections-repository.ts";
import type { ApiConnectionProfile } from "../types/domains/ai-connection.ts";
import type { RealtimeVoiceEvent } from "../types/domains/voice.ts";
import { readApiErrorMessage } from "./api-error.ts";
import { fetchLocalApi } from "./local-runtime-diagnostics.ts";

type RealtimeHandle = { stop: () => Promise<void>; mute: (muted: boolean) => void };

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
}

function base64ToInt16(value: string): Int16Array {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Int16Array(bytes.buffer);
}

async function createPcmCapture(stream: MediaStream, onChunk: (base64: string) => void) {
  const context = new AudioContext();
  await context.audioWorklet.addModule("/audio-worklets/pcm-capture-processor.js");
  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, "pcm-capture-processor");
  const silent = context.createGain(); silent.gain.value = 0;
  processor.port.onmessage = (event) => onChunk(bytesToBase64(event.data as ArrayBuffer));
  source.connect(processor).connect(silent).connect(context.destination);
  return { context, processor };
}

function createPcmPlayer(sampleRate = 24000) {
  const context = new AudioContext({ sampleRate });
  let cursor = 0;
  return {
    play(base64: string) {
      const pcm = base64ToInt16(base64);
      const buffer = context.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 0x8000;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      cursor = Math.max(cursor, context.currentTime); source.start(cursor); cursor += buffer.duration;
    },
    interrupt() { cursor = context.currentTime; },
    close: () => context.close(),
  };
}

function geminiEvents(value: unknown): RealtimeVoiceEvent[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const content = root.serverContent as Record<string, unknown> | undefined;
  const output: RealtimeVoiceEvent[] = [];
  const inputText = (content?.inputTranscription as Record<string, unknown> | undefined)?.text;
  const outputText = (content?.outputTranscription as Record<string, unknown> | undefined)?.text;
  if (typeof inputText === "string") output.push({ type: "transcript", role: "user", text: inputText, final: Boolean(content?.turnComplete) });
  if (typeof outputText === "string") output.push({ type: "transcript", role: "assistant", text: outputText, final: Boolean(content?.turnComplete) });
  const parts = ((content?.modelTurn as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined) ?? [];
  for (const part of parts) { const data = (part.inlineData as Record<string, unknown> | undefined)?.data; if (typeof data === "string") output.push({ type: "audio", pcmBase64: data, sampleRate: 24000 }); }
  if (content?.interrupted) output.push({ type: "interrupted" });
  return output;
}

function normalizeOpenAiEvent(value: unknown): RealtimeVoiceEvent[] {
  if (!value || typeof value !== "object") return [];
  const event = value as Record<string, unknown>;
  const type = String(event.type ?? "");
  if (type === "conversation.item.input_audio_transcription.completed" && typeof event.transcript === "string") return [{ type: "transcript", role: "user", text: event.transcript, final: true }];
  if (type === "response.output_audio_transcript.done" && typeof event.transcript === "string") return [{ type: "transcript", role: "assistant", text: event.transcript, final: true }];
  if (type.includes("speech_started")) return [{ type: "interrupted" }];
  if (type === "error") return [{ type: "error", message: String((event.error as Record<string, unknown> | undefined)?.message ?? "实时语音发生错误").slice(0, 240) }];
  return [];
}

/** OpenAI Realtime 使用 WebRTC；长期密钥先在同源 Route Handler 中交换为 60 秒临时凭据。 */
export async function startRealtimeVoiceSession(input: { connection: ApiConnectionProfile; model: string; voiceId: string; onEvent: (event: RealtimeVoiceEvent) => void }): Promise<RealtimeHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const apiKey = await aiConnectionsRepository.resolveSecret(input.connection);
  const setup = await fetchLocalApi("/api/ai/realtime/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: input.connection.provider, apiKey, model: input.model, voiceId: input.voiceId }) });
  if (!setup.ok) { stream.getTracks().forEach((track) => track.stop()); throw new Error(await readApiErrorMessage(setup, "无法创建实时会话")); }
  const setupPayload = await setup.json() as { token?: string; relaySessionId?: string };
  const { token } = setupPayload;
  if (input.connection.provider === "google") {
    if (!token) { stream.getTracks().forEach((track) => track.stop()); throw new Error("未取得 Gemini 临时凭据"); }
    const player = createPcmPlayer();
    const socket = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`);
    let capture: Awaited<ReturnType<typeof createPcmCapture>> | undefined;
    socket.onopen = async () => {
      socket.send(JSON.stringify({ setup: { model: `models/${input.model}`, generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceId } } } }, inputAudioTranscription: {}, outputAudioTranscription: {} } }));
      capture = await createPcmCapture(stream, (data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data }] } }));
      });
      input.onEvent({ type: "connected" });
    };
    socket.onmessage = (event) => { try { for (const normalized of geminiEvents(JSON.parse(String(event.data)))) { if (normalized.type === "audio") player.play(normalized.pcmBase64); if (normalized.type === "interrupted") player.interrupt(); input.onEvent(normalized); } } catch { input.onEvent({ type: "error", message: "Gemini 返回了无法解析的实时事件" }); } };
    socket.onerror = () => input.onEvent({ type: "error", message: "Gemini Live WebSocket 连接失败" });
    return { mute: (muted) => stream.getAudioTracks().forEach((track) => { track.enabled = !muted; }), stop: async () => { socket.close(); capture?.processor.disconnect(); await capture?.context.close(); await player.close(); stream.getTracks().forEach((track) => track.stop()); input.onEvent({ type: "ended" }); } };
  }
  if (input.connection.provider === "zhipu") {
    const relaySessionId = setupPayload.relaySessionId;
    if (!relaySessionId) { stream.getTracks().forEach((track) => track.stop()); throw new Error("未取得 GLM 中继会话"); }
    const player = createPcmPlayer(); let stopped = false;
    const capture = await createPcmCapture(stream, (pcmBase64) => { void fetchLocalApi("/api/ai/realtime/glm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: relaySessionId, pcmBase64 }) }); });
    const poll = window.setInterval(async () => { if (stopped) return; try { const response = await fetchLocalApi(`/api/ai/realtime/glm?sessionId=${encodeURIComponent(relaySessionId)}`, { cache: "no-store" }); const payload = await response.json() as { events?: RealtimeVoiceEvent[] }; for (const event of payload.events ?? []) { if (event.type === "audio") player.play(event.pcmBase64); if (event.type === "interrupted") player.interrupt(); input.onEvent(event); } } catch { input.onEvent({ type: "error", message: "GLM 中继事件读取失败" }); } }, 150);
    input.onEvent({ type: "connected" });
    return { mute: (muted) => stream.getAudioTracks().forEach((track) => { track.enabled = !muted; }), stop: async () => { stopped = true; window.clearInterval(poll); await fetchLocalApi(`/api/ai/realtime/glm?sessionId=${encodeURIComponent(relaySessionId)}`, { method: "DELETE" }); capture.processor.disconnect(); await capture.context.close(); await player.close(); stream.getTracks().forEach((track) => track.stop()); input.onEvent({ type: "ended" }); } };
  }
  if (!token) { stream.getTracks().forEach((track) => track.stop()); throw new Error("未取得临时凭据"); }
  const peer = new RTCPeerConnection();
  const remoteAudio = new Audio();
  remoteAudio.autoplay = true;
  peer.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; };
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  const channel = peer.createDataChannel("oai-events");
  channel.onopen = () => input.onEvent({ type: "connected" });
  channel.onmessage = (event) => {
    try { for (const normalized of normalizeOpenAiEvent(JSON.parse(String(event.data)) as unknown)) input.onEvent(normalized); }
    catch { input.onEvent({ type: "error", message: "无法解析实时语音事件" }); }
  };
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const response = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(input.model)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" }, body: offer.sdp });
  if (!response.ok) { peer.close(); stream.getTracks().forEach((track) => track.stop()); throw new Error((await response.text()) || "OpenAI WebRTC 建连失败"); }
  await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
  input.onEvent({ type: "setup" });
  return {
    mute: (muted) => stream.getAudioTracks().forEach((track) => { track.enabled = !muted; }),
    stop: async () => { channel.close(); peer.close(); stream.getTracks().forEach((track) => track.stop()); remoteAudio.srcObject = null; input.onEvent({ type: "ended" }); },
  };
}
