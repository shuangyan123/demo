import { outboundFetch } from "../http/outbound-fetch.ts";
import type { AiSpeechRequest } from "../../services/api-client";

type ProviderHttpRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

type JsonRecord = Record<string, unknown>;
export type SpeechParseMode = "binary" | "google_pcm" | "minimax" | "qwen" | "doubao";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function appendEndpoint(baseUrl: string, endpoint: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith(endpoint) ? normalized : `${normalized}${endpoint}`;
}

function bearerHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

/** 构造各语音厂商原生请求；parseMode 决定响应音频如何归一化。 */
export function buildSpeechProviderRequest(input: AiSpeechRequest): ProviderHttpRequest & { parseMode: SpeechParseMode } {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const speed = Math.max(0.5, Math.min(2, input.speed ?? 1));
  if (input.provider === "google") {
    return {
      url: `${baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`,
      headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
      body: {
        contents: [{ parts: [{ text: input.style ? `${input.style}\n${input.text}` : input.text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceId } } } },
      },
      parseMode: "google_pcm",
    };
  }
  if (input.provider === "elevenlabs") {
    return {
      url: `${baseUrl}/text-to-speech/${encodeURIComponent(input.voiceId)}`,
      headers: { "xi-api-key": input.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: { text: input.text, model_id: input.model, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: input.style ? 0.35 : 0 } },
      parseMode: "binary",
    };
  }
  if (input.provider === "azure") {
    const language = input.providerOptions?.language || "zh-CN";
    const rate = `${Math.round((speed - 1) * 100)}%`;
    return {
      url: baseUrl,
      headers: {
        "Ocp-Apim-Subscription-Key": input.apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      },
      body: `<speak version="1.0" xml:lang="${escapeXml(language)}"><voice name="${escapeXml(input.voiceId)}"><prosody rate="${rate}">${escapeXml(input.text)}</prosody></voice></speak>`,
      parseMode: "binary",
    };
  }
  if (input.provider === "minimax") {
    return {
      url: appendEndpoint(baseUrl, "/t2a_v2"),
      headers: bearerHeaders(input.apiKey),
      body: {
        model: input.model,
        text: input.text,
        stream: false,
        language_boost: input.languageBoost || "auto",
        output_format: "hex",
        voice_setting: { voice_id: input.voiceId, speed, vol: input.volume ?? 1, pitch: input.pitch ?? 0, emotion: input.emotion || "neutral" },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      },
      parseMode: "minimax",
    };
  }
  if (input.provider === "zhipu") {
    return {
      url: appendEndpoint(baseUrl, "/audio/speech"),
      headers: bearerHeaders(input.apiKey),
      body: { model: input.model, voice: input.voiceId, input: input.text, speed, volume: input.volume ?? 1, response_format: "wav" },
      parseMode: "binary",
    };
  }
  if (input.provider === "qwen") {
    const nativeBase = baseUrl.replace(/\/compatible-mode\/v1$/, "");
    return {
      url: `${nativeBase}/api/v1/services/aigc/multimodal-generation/generation`,
      headers: bearerHeaders(input.apiKey),
      body: { model: input.model, input: { text: input.text, voice: input.voiceId, language_type: "Chinese", instructions: input.style || undefined } },
      parseMode: "qwen",
    };
  }
  if (input.provider === "doubao") {
    const options = input.providerOptions ?? {};
    return {
      url: options.speechEndpoint || "https://openspeech.bytedance.com/api/v1/tts",
      headers: { Authorization: `Bearer;${input.apiKey}`, "Content-Type": "application/json" },
      body: {
        app: { appid: options.appId || "", token: input.apiKey, cluster: options.cluster || "volcano_tts" },
        user: { uid: options.userId || "review-workspace" },
        audio: { voice_type: input.voiceId, encoding: "mp3", speed_ratio: speed },
        request: { reqid: crypto.randomUUID(), text: input.text, operation: "query" },
      },
      parseMode: "doubao",
    };
  }
  return {
    url: appendEndpoint(baseUrl, "/audio/speech"),
    headers: bearerHeaders(input.apiKey),
    body: { model: input.model, voice: input.voiceId, input: input.text, instructions: input.style || undefined, speed, response_format: "mp3" },
    parseMode: "binary",
  };
}

function decodeAudioText(value: string): Uint8Array {
  const normalized = value.trim();
  if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) {
    return Uint8Array.from({ length: normalized.length / 2 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
  }
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

function wrapPcmAsWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  writeText(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeText(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/** 解析原生语音 JSON；二进制响应由 Route Handler 直接透传。 */
export async function parseSpeechJsonResponse(parseMode: Exclude<SpeechParseMode, "binary">, payload: unknown): Promise<Uint8Array> {
  const root = asRecord(payload);
  if (parseMode === "minimax") {
    const audio = asRecord(root.data).audio;
    if (typeof audio !== "string") throw new Error("MiniMax 未返回音频数据");
    return decodeAudioText(audio);
  }
  if (parseMode === "doubao") {
    if (typeof root.data !== "string") throw new Error("豆包语音未返回音频数据");
    return decodeAudioText(root.data);
  }
  if (parseMode === "google_pcm") {
    const candidate = asRecord(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
    const parts = asRecord(candidate.content).parts;
    const data = asRecord(Array.isArray(parts) ? asRecord(parts[0]).inlineData : undefined).data;
    if (typeof data !== "string") throw new Error("Gemini TTS 未返回音频数据");
    return wrapPcmAsWav(decodeAudioText(data));
  }
  const audioUrl = asRecord(asRecord(root.output).audio).url;
  if (typeof audioUrl !== "string") throw new Error("通义语音未返回可下载音频");
  const response = await outboundFetch(audioUrl, { cache: "no-store", redirect: "error" }, { allowLoopback: false, allowPrivateNetwork: false, timeoutMs: 15_000 });
  if (!response.ok) { await response.body?.cancel(); throw new Error("通义语音音频下载失败"); }
  const limit = 16 * 1024 * 1024;
  if (Number(response.headers.get("content-length") ?? 0) > limit) { await response.body?.cancel(); throw new Error("语音下载超过安全上限"); }
  const chunks: Uint8Array[] = [];
  const reader = response.body?.getReader();
  let size = 0;
  if (!reader) throw new Error("语音下载内容为空");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("语音下载超过安全上限"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
