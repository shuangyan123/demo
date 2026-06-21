import type { ApiProvider } from "../types/review";

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
  temperature?: number;
  providerOptions?: Record<string, string>;
};

export type AiGenerateResult = {
  content: string;
  requestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

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

// 调用统一生成路由，客户端不再拼接各厂商 endpoint 或解析厂商响应。
export async function callAiGenerate(input: AiGenerateRequest): Promise<AiGenerateResult> {
  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API 请求失败：${response.status}`);
  }
  return (await response.json()) as AiGenerateResult;
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
