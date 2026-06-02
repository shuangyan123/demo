import type { ApiProvider } from "../types/review";

export type ProviderPreset = {
  provider: ApiProvider;
  label: string;
  baseUrl: string;
  model: string;
};

export const providerPresets: ProviderPreset[] = [
  { provider: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { provider: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { provider: "qwen", label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-max" },
  { provider: "zhipu", label: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4v-flash" },
  { provider: "kimi", label: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k-vision-preview" },
  { provider: "doubao", label: "豆包", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-1.5-vision-pro" },
  { provider: "custom", label: "自定义", baseUrl: "", model: "" },
];

export type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export type ChatMessage = {
  role: "system" | "user";
  content: ChatMessageContent;
};

// 通过本地 Next API route 代理 OpenAI-compatible 请求，避免浏览器直接跨域调用厂商接口。
export async function callOpenAiCompatibleApi(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
}) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API 请求失败：${response.status}`);
  }

  return (await response.json()) as { content: string };
}
