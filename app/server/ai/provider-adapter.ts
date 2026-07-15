import type { AiGenerateRequest, AiGenerateResult, AiGenerateStreamEvent, AiSpeechRequest, AiTranscriptionRequest, AiTranscriptionResult, ChatMessage, ChatMessageContent } from "../../services/api-client";
import { getProviderContract } from "../../services/provider-contracts.ts";
import { normalizeGoogleApiBaseUrl, normalizeGoogleInteractionsBaseUrl } from "../../services/google-connection.ts";
import { miniMaxBearerHeaders, normalizeMiniMaxAnthropicBaseUrl } from "../../services/minimax-connection.ts";
import { mapProviderRuntimeOptions } from "./runtime-option-mappers/index.ts";

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
  return content.map((item) => {
    if (item.type === "text") return { type: "input_text", text: item.text };
    if (item.type === "video_url") return { type: "input_video", video_url: item.video_url.url };
    return { type: "input_image", image_url: item.image_url.url };
  });
}

// 把统一消息转换为 Gemini generateContent 的 parts 结构。
function toGeminiParts(content: ChatMessageContent): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((item) => {
    if (item.type === "text") return { text: item.text };
    const mediaUrl = item.type === "video_url" ? item.video_url.url : item.image_url.url;
    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(mediaUrl);
    return dataUrl
      ? { inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } }
      : { fileData: { fileUri: mediaUrl } };
  });
}

/** 将统一内容转换为 Interactions API 的 text/image/video 内容块。 */
function toGoogleInteractionContent(content: ChatMessageContent): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((item) => {
    if (item.type === "text") return { type: "text", text: item.text };
    const mediaUrl = item.type === "video_url" ? item.video_url.url : item.image_url.url;
    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(mediaUrl);
    if (dataUrl) return { type: item.type === "video_url" ? "video" : "image", mime_type: dataUrl[1], data: dataUrl[2] };
    return { type: item.type === "video_url" ? "video" : "image", uri: mediaUrl };
  });
}

// 把统一消息转换为 Anthropic Messages 的文本和图片块。
function toAnthropicContent(content: ChatMessageContent): unknown {
  if (typeof content === "string") return content;
  return content.map((item) => {
    if (item.type === "text") return { type: "text", text: item.text };
    const kind = item.type === "video_url" ? "video" : "image";
    const mediaUrl = item.type === "video_url" ? item.video_url.url : item.image_url.url;
    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(mediaUrl);
    return dataUrl
      ? { type: kind, source: { type: "base64", media_type: dataUrl[1], data: dataUrl[2] } }
      : { type: kind, source: { type: "url", url: mediaUrl } };
  });
}

function buildResponsesRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  const runtime = mapProviderRuntimeOptions(input.provider, input);
  return {
    url: appendEndpoint(input.baseUrl, "/responses"),
    headers: { ...bearerHeaders(input.apiKey), ...runtime.headers },
    body: {
      model: input.model,
      input: conversation.map((message) => ({ role: message.role, content: toResponsesContent(message.content) })),
      instructions: system || undefined,
      max_output_tokens: input.maxOutputTokens,
      ...(input.structuredOutput ? { text: { format: { type: "json_schema", name: input.structuredOutput.name, schema: input.structuredOutput.schema, strict: input.structuredOutput.strict ?? true } } } : {}),
      ...(input.stream ? { stream: true } : {}),
      ...runtime.requestFields,
      ...(!runtime.omitTemperature ? { temperature: input.temperature ?? 0.1 } : {}),
    },
  };
}

function buildGoogleGenerateContentRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  const runtime = mapProviderRuntimeOptions(input.provider, input);
  return {
    url: `${normalizeGoogleApiBaseUrl(input.baseUrl)}/models/${encodeURIComponent(input.model)}:${input.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
    headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json", ...runtime.headers },
    body: {
      ...runtime.requestFields,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: conversation.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) })),
      generationConfig: {
        maxOutputTokens: input.maxOutputTokens,
        ...(!runtime.omitTemperature ? { temperature: input.temperature ?? 0.1 } : {}),
        ...runtime.generationFields,
        ...(input.structuredOutput ? { responseMimeType: "application/json", responseJsonSchema: input.structuredOutput.schema } : {}),
      },
    },
  };
}

/** 构造无服务端历史留存的 Google Interactions 请求。 */
function buildGoogleInteractionsRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  const runtime = mapProviderRuntimeOptions(input.provider, input);
  const generationFields = runtime.generationFields ?? {};
  const thinkingConfig = asRecord(generationFields.thinkingConfig);
  const generationConfig = {
    ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
    ...(typeof thinkingConfig.thinkingLevel === "string" ? { thinking_level: thinkingConfig.thinkingLevel } : {}),
    ...(typeof thinkingConfig.thinkingBudget === "number" ? { thinking_budget: thinkingConfig.thinkingBudget } : {}),
    ...(!runtime.omitTemperature && input.temperature !== undefined ? { temperature: input.temperature } : {}),
  };
  const inputSteps = conversation.map((message) => ({
    type: message.role === "assistant" ? "model_output" : "user_input",
    content: toGoogleInteractionContent(message.content),
  }));
  return {
    url: `${normalizeGoogleInteractionsBaseUrl(input.baseUrl)}/interactions`,
    headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json", ...runtime.headers },
    body: {
      model: input.model,
      input: inputSteps.length === 1 && inputSteps[0].type === "user_input" ? inputSteps[0].content : inputSteps,
      store: false,
      ...(system ? { system_instruction: system } : {}),
      ...(Object.keys(generationConfig).length ? { generation_config: generationConfig } : {}),
      ...(runtime.requestFields?.serviceTier === "priority" ? { service_tier: "priority" } : {}),
      ...(input.structuredOutput ? { response_format: [{ type: "text", mime_type: "application/json", schema: input.structuredOutput.schema }] } : {}),
      ...(input.stream ? { stream: true } : {}),
    },
  };
}

function buildAnthropicRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const { system, conversation } = splitSystemMessages(input.messages);
  const runtime = mapProviderRuntimeOptions(input.provider, input);
  const baseUrl = input.provider === "minimax"
    ? normalizeMiniMaxAnthropicBaseUrl(input.baseUrl, input.providerOptions?.region === "global" ? "global" : "cn")
    : input.baseUrl;
  const endpoint = input.provider === "minimax" ? "/v1/messages" : "/messages";
  return {
    url: appendEndpoint(baseUrl, endpoint),
    headers: input.provider === "minimax"
      ? { ...miniMaxBearerHeaders(input.apiKey), ...runtime.headers }
      : { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json", ...runtime.headers },
    body: {
      model: input.model,
      max_tokens: runtime.effectiveMaxOutputTokens ?? input.maxOutputTokens ?? 1024,
      system: system || undefined,
      messages: conversation.map((message) => ({ role: message.role, content: toAnthropicContent(message.content) })),
      ...(input.stream ? { stream: true } : {}),
      ...runtime.requestFields,
      ...((input.provider === "anthropic" && (input.structuredOutput || Object.keys(runtime.outputFields ?? {}).length)) ? { output_config: { ...(input.structuredOutput ? { format: { type: "json_schema", schema: input.structuredOutput.schema } } : {}), ...runtime.outputFields } } : {}),
      ...(!runtime.omitTemperature ? { temperature: input.temperature ?? 0.1 } : {}),
    },
  };
}

function buildChatCompletionsRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const isMiniMax = input.provider === "minimax";
  const runtime = mapProviderRuntimeOptions(input.provider, input);
  return {
    url: appendEndpoint(input.baseUrl, "/chat/completions"),
    headers: { ...bearerHeaders(input.apiKey), ...runtime.headers },
    body: {
      model: input.model,
      messages: input.messages,
      ...(isMiniMax ? { max_completion_tokens: input.maxOutputTokens } : { max_tokens: input.maxOutputTokens }),
      ...(input.structuredOutput ? { response_format: input.provider === "deepseek" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: input.structuredOutput.name, schema: input.structuredOutput.schema, strict: input.structuredOutput.strict ?? true } } } : {}),
      ...runtime.requestFields,
      ...(input.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      ...(!runtime.omitTemperature ? { temperature: input.temperature ?? 0.1 } : {}),
    },
  };
}

// 服务端根据厂商契约选择原生协议，客户端不再传递 endpoint 或响应字段知识。
export function buildGenerateProviderRequest(input: AiGenerateRequest): ProviderHttpRequest {
  const format = getProviderContract(input.provider).apiFormat;
  if (format === "responses") return buildResponsesRequest(input);
  if (input.provider === "google") {
    return input.generationProtocol === "google_interactions"
      ? buildGoogleInteractionsRequest(input)
      : buildGoogleGenerateContentRequest(input);
  }
  if (format === "anthropic_messages") return buildAnthropicRequest(input);
  return buildChatCompletionsRequest(input);
}

/** 构造 Gemini 音频理解请求；转写文本由服务端统一提取，厂商原始响应不外泄。 */
export function buildTranscriptionProviderRequest(input: AiTranscriptionRequest): ProviderHttpRequest {
  if (input.provider !== "google") throw new Error("当前仅支持 Google Gemini 录音转写");
  return {
    url: `${normalizeBaseUrl(input.baseUrl)}/models/${encodeURIComponent(input.model)}:generateContent`,
    headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
    body: {
      contents: [{
        role: "user",
        parts: [
          { text: "请逐字转写这段中文语音。只返回转写文本，不要解释、标题、时间戳或 Markdown。" },
          { inlineData: { mimeType: input.mimeType, data: input.audioBase64 } },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    },
  };
}

/** 解析 Gemini 文字 parts，保证转写 API 只返回脱离厂商结构的短文本。 */
export function parseTranscriptionProviderResponse(payload: unknown, headers: Headers): AiTranscriptionResult {
  const root = asRecord(payload);
  const candidate = asRecord(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
  const parts = asRecord(candidate.content).parts;
  const text = (Array.isArray(parts) ? parts : []).map((part) => asRecord(part).text).filter((value): value is string => typeof value === "string").join("").trim();
  if (!text) throw new Error("Gemini 未返回转写文本");
  return { text, requestId: headers.get("x-request-id") ?? undefined };
}

function usageResult(inputTokens: unknown, outputTokens: unknown, totalTokens: unknown) {
  return {
    inputTokens: Number(inputTokens) || undefined,
    outputTokens: Number(outputTokens) || undefined,
    totalTokens: Number(totalTokens) || undefined,
  };
}

/** 只归一化厂商确认的实际档位，不保留完整响应或计费对象。 */
function actualSpeedFromResponse(input: AiGenerateRequest, root: JsonRecord, headers: Headers): string | undefined {
  if (input.provider === "google") return headers.get("x-gemini-service-tier") ?? undefined;
  const usage = asRecord(root.usage);
  const nestedUsage = asRecord(asRecord(root.message).usage);
  for (const value of [usage.speed, usage.service_tier, nestedUsage.speed, nestedUsage.service_tier, root.service_tier]) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

// 兼容各厂商响应，并归一化文本及 token 用量。
export function parseGenerateProviderResponse(input: AiGenerateRequest, payload: unknown, headers: Headers): AiGenerateResult {
  const root = asRecord(payload);
  const format = getProviderContract(input.provider).apiFormat;
  const actualSpeed = actualSpeedFromResponse(input, root, headers);
  if (input.provider === "google" && input.generationProtocol === "google_interactions") {
    const steps = Array.isArray(root.steps) ? root.steps : [];
    const content = steps
      .filter((step) => asRecord(step).type === "model_output")
      .flatMap((step) => Array.isArray(asRecord(step).content) ? asRecord(step).content as unknown[] : [])
      .map((part) => asRecord(part).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
    const usage = asRecord(root.usage);
    return {
      content: typeof root.output_text === "string" ? root.output_text : content,
      requestId: typeof root.id === "string" ? root.id : headers.get("x-request-id") ?? undefined,
      usage: usageResult(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens),
      ...(actualSpeed ? { actualSpeed } : {}),
      generationProtocol: "google_interactions",
    };
  }
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
      ...(actualSpeed ? { actualSpeed } : {}),
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
      ...(actualSpeed ? { actualSpeed } : {}),
      ...(input.generationProtocol ? { generationProtocol: "google_generate_content" as const } : {}),
    };
  }
  if (format === "anthropic_messages") {
    const content = Array.isArray(root.content) ? root.content : [];
    const usage = asRecord(root.usage);
    return {
      content: content.map((part) => asRecord(part).text).filter((text): text is string => typeof text === "string").join(""),
      requestId: headers.get("request-id") ?? (typeof root.id === "string" ? root.id : undefined),
      usage: usageResult(usage.input_tokens, usage.output_tokens, Number(usage.input_tokens) + Number(usage.output_tokens)),
      ...(actualSpeed ? { actualSpeed } : {}),
    };
  }
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  const usage = asRecord(root.usage);
  return {
    content: typeof message.content === "string" ? message.content : "",
    requestId: headers.get("x-request-id") ?? (typeof root.id === "string" ? root.id : undefined),
    usage: usageResult(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens),
    ...(actualSpeed ? { actualSpeed } : {}),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function usageFromRecord(record: JsonRecord, kind: "openai" | "google" | "anthropic" | "chat"): AiGenerateResult["usage"] | undefined {
  if (!Object.keys(record).length) return undefined;
  if (kind === "google") return usageResult(record.promptTokenCount, record.candidatesTokenCount, record.totalTokenCount);
  if (kind === "anthropic") return usageResult(record.input_tokens, record.output_tokens, Number(record.input_tokens) + Number(record.output_tokens));
  if (kind === "chat") return usageResult(record.prompt_tokens, record.completion_tokens, record.total_tokens);
  return usageResult(record.input_tokens, record.output_tokens, record.total_tokens);
}

/** 把厂商流式事件归一为应用内部事件，避免 UI 依赖厂商私有字段。 */
export function parseGenerateProviderStreamEvent(input: AiGenerateRequest, payload: unknown, headers: Headers): AiGenerateStreamEvent[] {
  const root = asRecord(payload);
  const format = getProviderContract(input.provider).apiFormat;
  if (input.provider === "google" && input.generationProtocol === "google_interactions") {
    const eventType = stringValue(root.type) || stringValue(root.event_type);
    const delta = asRecord(root.delta);
    if (eventType === "step.delta" && delta.type === "text" && typeof delta.text === "string") {
      return [{ type: "delta", text: delta.text }];
    }
    if (eventType === "interaction.completed") {
      const interaction = asRecord(root.interaction);
      const usage = usageFromRecord(asRecord(interaction.usage), "chat");
      return [{ type: "usage", requestId: stringValue(interaction.id) || headers.get("x-request-id") || undefined, usage, actualSpeed: stringValue(interaction.service_tier) || undefined }];
    }
    return [];
  }
  if (format === "responses") {
    const eventType = stringValue(root.type);
    if (eventType === "response.output_text.delta") return [{ type: "delta", text: stringValue(root.delta) }];
    const response = asRecord(root.response);
    const usage = usageFromRecord(asRecord(response.usage), "openai");
    const actualSpeed = actualSpeedFromResponse(input, response, headers);
    if (eventType === "response.completed") {
      return [{ type: "usage", requestId: stringValue(response.id) || headers.get("x-request-id") || undefined, usage, ...(actualSpeed ? { actualSpeed } : {}) }];
    }
    return [];
  }
  if (format === "google_generate_content") {
    const candidate = asRecord(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
    const parts = asRecord(candidate.content).parts;
    const text = (Array.isArray(parts) ? parts : []).map((part) => stringValue(asRecord(part).text)).join("");
    const usage = usageFromRecord(asRecord(root.usageMetadata), "google");
    const actualSpeed = actualSpeedFromResponse(input, root, headers);
    return [...(text ? [{ type: "delta" as const, text }] : []), ...(usage ? [{ type: "usage" as const, requestId: headers.get("x-request-id") ?? undefined, usage, ...(actualSpeed ? { actualSpeed } : {}) }] : [])];
  }
  if (format === "anthropic_messages") {
    const eventType = stringValue(root.type);
    const delta = asRecord(root.delta);
    if (eventType === "content_block_delta") return [{ type: "delta", text: stringValue(delta.text) }];
    const usage = usageFromRecord(asRecord(delta.usage), "anthropic");
    const actualSpeed = actualSpeedFromResponse(input, root, headers);
    return usage || actualSpeed ? [{ type: "usage", requestId: (headers.get("request-id") ?? stringValue(asRecord(root.message).id)) || undefined, usage, ...(actualSpeed ? { actualSpeed } : {}) }] : [];
  }
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const delta = asRecord(asRecord(choices[0]).delta);
  const text = stringValue(delta.content);
  const usage = usageFromRecord(asRecord(root.usage), "chat");
  const actualSpeed = actualSpeedFromResponse(input, root, headers);
  return [...(text ? [{ type: "delta" as const, text }] : []), ...(usage || actualSpeed ? [{ type: "usage" as const, requestId: (headers.get("x-request-id") ?? stringValue(root.id)) || undefined, usage, ...(actualSpeed ? { actualSpeed } : {}) }] : [])];
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
