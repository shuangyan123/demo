import type { AiGenerateRequest, AiGenerateResult, AiSpeechRequest, ChatMessage, ChatMessageContent } from "../../services/api-client";
import { getProviderContract } from "../../services/provider-contracts.ts";

type ProviderHttpRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

type JsonRecord = Record<string, unknown>;
export type SpeechParseMode = "binary" | "google_pcm" | "minimax" | "qwen" | "doubao";

// 安全读取普通对象，避免直接信任外部厂商返回值。
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

// 统一移除 base URL 末尾斜杠，防止 endpoint 出现双斜杠。
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

// 兼容用户把完整 endpoint 填进 Base URL 的情况，只在缺少目标路径时追加。
function appendEndpoint(baseUrl: string, endpoint: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith(endpoint) ? normalized : `${normalized}${endpoint}`;
}

// 构造通用 Bearer 鉴权头；本地自定义服务可不启用鉴权，此时不发送空 Authorization。
function bearerHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function textFromContent(content: ChatMessageContent): string {
  return typeof content === "string" ? content : content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

function splitSystemMessages(messages: ChatMessage[]) {
  return {
    system: messages.filter((message) => message.role === "system").map((message) => textFromContent(message.content)).join("\n\n"),
    conversation: messages.filter((message) => message.role !== "system"),
  };
}

// 把聊天内容转换成 Responses API 使用的 input_text/input_image 结构。
function toResponsesContent(content: ChatMessageContent): unknown {
  if (typeof content === "string") return content;
  return content.map((item) =>
    item.type === "text" ? { type: "input_text", text: item.text } : { type: "input_image", image_url: item.image_url.url },
  );
}

// 把统一消息转换为 Gemini generateContent 的 parts 结构。
function toGeminiParts(content: ChatMessageContent): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((item) => {
    if (item.type === "text") return { text: item.text };
    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(item.image_url.url);
    return dataUrl
      ? { inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } }
      : { fileData: { fileUri: item.image_url.url } };
  });
}

// 把统一消息转换为 Anthropic Messages 的文本和图片块。
function toAnthropicContent(content: ChatMessageContent): unknown {
  if (typeof content === "string") return content;
  return content.map((item) => {
    if (item.type === "text") return { type: "text", text: item.text };
    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(item.image_url.url);
    return dataUrl
      ? { type: "image", source: { type: "base64", media_type: dataUrl[1], data: dataUrl[2] } }
      : { type: "image", source: { type: "url", url: item.image_url.url } };
  });
}

function buildResponsesRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  return {
    url: appendEndpoint(input.baseUrl, "/responses"),
    headers: bearerHeaders(input.apiKey),
    body: {
      model: input.model,
      input: conversation.map((message) => ({ role: message.role, content: toResponsesContent(message.content) })),
      instructions: system || undefined,
      max_output_tokens: input.maxOutputTokens,
      temperature: input.temperature ?? 0.1,
    },
  };
}

function buildGoogleRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  return {
    url: `${normalizeBaseUrl(input.baseUrl)}/models/${encodeURIComponent(input.model)}:generateContent`,
    headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
    body: {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: conversation.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) })),
      generationConfig: {
        maxOutputTokens: input.maxOutputTokens,
        temperature: input.temperature ?? 0.1,
      },
    },
  };
}

function buildAnthropicRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  return {
    url: appendEndpoint(input.baseUrl, "/messages"),
    headers: { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: {
      model: input.model,
      max_tokens: input.maxOutputTokens ?? 1024,
      system: system || undefined,
      messages: conversation.map((message) => ({ role: message.role, content: toAnthropicContent(message.content) })),
      temperature: input.temperature ?? 0.1,
    },
  };
}

function buildChatCompletionsRequest(input: AiGenerateRequest): ProviderHttpRequest {
  return {
    url: appendEndpoint(input.baseUrl, "/chat/completions"),
    headers: bearerHeaders(input.apiKey),
    body: {
      model: input.model,
      messages: input.messages,
      max_tokens: input.maxOutputTokens,
      temperature: input.temperature ?? 0.1,
    },
  };
}

// 服务端根据厂商契约选择原生协议，客户端不再传递 endpoint 或响应字段知识。
export function buildGenerateProviderRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const format = getProviderContract(input.provider).apiFormat;
  if (format === "responses") return buildResponsesRequest(input);
  if (format === "google_generate_content") return buildGoogleRequest(input);
  if (format === "anthropic_messages") return buildAnthropicRequest(input);
  return buildChatCompletionsRequest(input);
}

function usageResult(inputTokens: unknown, outputTokens: unknown, totalTokens: unknown) {
  return {
    inputTokens: Number(inputTokens) || undefined,
    outputTokens: Number(outputTokens) || undefined,
    totalTokens: Number(totalTokens) || undefined,
  };
}

// 兼容各厂商响应，并归一化文本及 token 用量。
export function parseGenerateProviderResponse(input: AiGenerateRequest, payload: unknown, headers: Headers): AiGenerateResult {
  const root = asRecord(payload);
  const format = getProviderContract(input.provider).apiFormat;
  if (format === "responses") {
    const output = Array.isArray(root.output) ? root.output : [];
    const nestedText = output
      .flatMap((item) => (Array.isArray(asRecord(item).content) ? (asRecord(item).content as unknown[]) : []))
      .map((item) => asRecord(item).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
    const usage = asRecord(root.usage);
    return {
      content: typeof root.output_text === "string" ? root.output_text : nestedText,
      requestId: headers.get("x-request-id") ?? (typeof root.id === "string" ? root.id : undefined),
      usage: usageResult(usage.input_tokens, usage.output_tokens, usage.total_tokens),
    };
  }
  if (format === "google_generate_content") {
    const candidate = asRecord(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
    const parts = asRecord(candidate.content).parts;
    const usage = asRecord(root.usageMetadata);
    return {
      content: (Array.isArray(parts) ? parts : []).map((part) => asRecord(part).text).filter((text): text is string => typeof text === "string").join(""),
      requestId: headers.get("x-request-id") ?? undefined,
      usage: usageResult(usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount),
    };
  }
  if (format === "anthropic_messages") {
    const content = Array.isArray(root.content) ? root.content : [];
    const usage = asRecord(root.usage);
    return {
      content: content.map((part) => asRecord(part).text).filter((text): text is string => typeof text === "string").join(""),
      requestId: headers.get("request-id") ?? (typeof root.id === "string" ? root.id : undefined),
      usage: usageResult(usage.input_tokens, usage.output_tokens, Number(usage.input_tokens) + Number(usage.output_tokens)),
    };
  }
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  const usage = asRecord(root.usage);
  return {
    content: typeof message.content === "string" ? message.content : "",
    requestId: headers.get("x-request-id") ?? (typeof root.id === "string" ? root.id : undefined),
    usage: usageResult(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens),
  };
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

// 构造各语音厂商原生请求；parseMode 决定响应音频如何归一化。
export function buildSpeechProviderRequest(input: AiSpeechRequest): ProviderHttpRequest & { parseMode: SpeechParseMode } {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const speed = Math.max(0.5, Math.min(2, input.speed ?? 1));
  if (input.provider === "google") {
    return {
      url: `${baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`,
      headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
      body: {
        contents: [{ parts: [{ text: input.style ? `${input.style}\n${input.text}` : input.text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceId } } },
        },
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
        language_boost: "auto",
        output_format: "hex",
        voice_setting: { voice_id: input.voiceId, speed, vol: 1, pitch: 0, emotion: input.style || "neutral" },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      },
      parseMode: "minimax",
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

// 把十六进制或 base64 音频文本转换成字节数组。
function decodeAudioText(value: string): Uint8Array {
  const normalized = value.trim();
  if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) {
    return Uint8Array.from({ length: normalized.length / 2 }, (_, index) => Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16));
  }
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

// Gemini TTS 返回 24kHz 单声道 16 位 PCM；浏览器播放前补齐 WAV 文件头。
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

// 解析原生语音 JSON；二进制响应由 Route Handler 直接透传。
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
  const response = await fetch(audioUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("通义语音音频下载失败");
  return new Uint8Array(await response.arrayBuffer());
}
