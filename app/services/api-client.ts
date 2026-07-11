import type { AiCapability, AiConnectionPurpose, ApiProvider } from "../types/review";
import { emitAiActivity } from "./ai-activity-events.ts";

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
};

export type AiGenerateRequest = {
  provider: ApiProvider;
  apiKey: string;
  baseUrl: string;
  maxOutputTokens?: number;
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  structuredOutput?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  providerOptions?: Record<string, string>;
  activity?: {
    runId?: string;
    conversationId?: string;
    projectId?: string;
    studyDomainId?: string;
    module?: string;
    purpose?: string;
    connectionLabel?: string;
  };
};

export type AiGenerateResult = {
  content: string;
  requestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export type AiGenerateStreamEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "usage"; requestId?: string; usage?: AiGenerateResult["usage"] }
  | { type: "done"; content: string; requestId?: string; usage?: AiGenerateResult["usage"] }
  | { type: "error"; message: string };

export type AiSpeechRequest = {
  provider: ApiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  voiceId: string;
  text: string;
  style?: string;
  speed?: number;
  providerOptions?: Record<string, string>;
};

/** 转写请求只在本次网络调用中携带音频 base64，调用完成后不得持久化音频。 */
export type AiTranscriptionRequest = {
  provider: ApiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  mimeType: string;
  audioBase64: string;
  providerOptions?: Record<string, string>;
};

export type AiTranscriptionResult = {
  text: string;
  requestId?: string;
};

export type AiModelDirectoryEntry = {
  id: string;
  label: string;
  purposes: AiConnectionPurpose[];
  capabilities: AiCapability[];
  status: "active" | "preview" | "deprecated" | "unknown";
  source: "official_api" | "static_catalog";
  family?: string;
  generation?: string;
  modalityGroup?: "text" | "multimodal" | "speech" | "transcription";
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  updatedAt: string;
};

export type AiModelsRequest = {
  provider: ApiProvider;
  apiKey: string;
  baseUrl: string;
};

export type AiModelsResult = {
  models: AiModelDirectoryEntry[];
  fetchedAt: string;
};

// 调用统一生成路由，客户端不再拼接各厂商 endpoint 或解析厂商响应。
export async function callAiGenerate(input: AiGenerateRequest): Promise<AiGenerateResult> {
  const runId = input.activity?.runId ?? crypto.randomUUID();
  const activityBase = {
    runId,
    conversationId: input.activity?.conversationId,
    projectId: input.activity?.projectId,
    studyDomainId: input.activity?.studyDomainId,
    module: input.activity?.module,
    purpose: input.activity?.purpose,
    connectionLabel: input.activity?.connectionLabel,
    model: input.model,
  };
  emitAiActivity({ ...activityBase, phase: "started", label: `${input.provider} · ${input.model}`, stepId: "prepare", text: "正在准备 AI 请求" });
  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    emitAiActivity({ ...activityBase, phase: "error", label: `${input.provider} · ${input.model}`, stepId: "error", text: text || `API 请求失败：${response.status}` });
    throw new Error(text || `API 请求失败：${response.status}`);
  }
  const result = (await response.json()) as AiGenerateResult;
  emitAiActivity({ ...activityBase, phase: "usage", label: `${input.provider} · ${input.model}`, stepId: "usage", text: result.usage?.totalTokens ? `${result.usage.totalTokens} tokens` : "厂商未返回用量", usage: result.usage });
  emitAiActivity({ ...activityBase, phase: "done", label: `${input.provider} · ${input.model}`, stepId: "done", text: "完成", usage: result.usage });
  return result;
}

/** 读取统一 SSE 流；每行只承载归一化事件，不暴露厂商原始响应。 */
export async function* callAiGenerateStream(input: AiGenerateRequest): AsyncGenerator<AiGenerateStreamEvent> {
  const runId = input.activity?.runId ?? crypto.randomUUID();
  const activityBase = {
    runId,
    conversationId: input.activity?.conversationId,
    projectId: input.activity?.projectId,
    studyDomainId: input.activity?.studyDomainId,
    module: input.activity?.module,
    purpose: input.activity?.purpose,
    connectionLabel: input.activity?.connectionLabel,
    model: input.model,
  };
  emitAiActivity({ ...activityBase, phase: "started", label: `${input.provider} · ${input.model}`, stepId: "prepare", text: "正在建立流式连接" });
  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, stream: true }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    emitAiActivity({ ...activityBase, phase: "error", label: `${input.provider} · ${input.model}`, stepId: "error", text: text || `API 请求失败：${response.status}` });
    throw new Error(text || `API 请求失败：${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const data = part.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data) continue;
      const event = JSON.parse(data) as AiGenerateStreamEvent;
      emitAiActivity({ ...activityBase, phase: event.type === "delta" ? "delta" : event.type === "error" ? "error" : event.type === "done" ? "done" : event.type === "usage" ? "usage" : "waiting", label: `${input.provider} · ${input.model}`, stepId: event.type === "delta" ? "stream" : event.type, text: "text" in event ? event.text : "message" in event ? event.message : event.type, usage: "usage" in event ? event.usage : undefined });
      yield event;
    }
  }
  if (buffer.trim()) {
    const data = buffer.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (data) {
      const event = JSON.parse(data) as AiGenerateStreamEvent;
      emitAiActivity({ ...activityBase, phase: event.type === "delta" ? "delta" : event.type === "error" ? "error" : event.type === "done" ? "done" : event.type === "usage" ? "usage" : "waiting", label: `${input.provider} · ${input.model}`, stepId: event.type === "delta" ? "stream" : event.type, text: "text" in event ? event.text : "message" in event ? event.message : event.type, usage: "usage" in event ? event.usage : undefined });
      yield event;
    }
  }
}

// 调用云端语音路由并返回临时音频 Blob；调用方负责撤销对应 object URL。
export async function callAiSpeech(input: AiSpeechRequest): Promise<Blob> {
  const response = await fetch("/api/ai/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `语音 API 请求失败：${response.status}`);
  }
  return response.blob();
}

/** 调用统一转写路由；浏览器录音在请求结束后由调用方立即释放。 */
export async function callAiTranscription(input: AiTranscriptionRequest): Promise<AiTranscriptionResult> {
  const response = await fetch("/api/ai/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `转写 API 请求失败：${response.status}`);
  }
  return response.json() as Promise<AiTranscriptionResult>;
}

/** 读取归一化厂商模型目录；调用方只能缓存公开模型元数据。 */
export async function callAiModels(input: AiModelsRequest): Promise<AiModelsResult> {
  const response = await fetch("/api/ai/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error((await response.text()) || `模型目录读取失败：${response.status}`);
  return response.json() as Promise<AiModelsResult>;
}
