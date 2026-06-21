import type { AiCapability, AiConnectionPurpose, ApiFormat, ApiProvider } from "../types/review";

export type ProviderGroup = "commercial" | "open_source" | "speech" | "custom" | "legacy";

export type ProviderContract = {
  provider: ApiProvider;
  label: string;
  group: ProviderGroup;
  baseUrl: string;
  model: string;
  apiFormat: ApiFormat;
  capabilities: AiCapability[];
  models: Partial<Record<AiConnectionPurpose, string[]>>;
  documentationUrl: string;
  verifiedAt: string;
  creatable: boolean;
  speechVoices?: Array<{ id: string; label: string }>;
};

const openAiVoices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
const googleVoices = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];

// 只把官方文档可确认的模型写入默认列表；无法实时核验的厂商保留空模型，要求用户手动填写。
export const providerContracts: ProviderContract[] = [
  {
    provider: "openai",
    label: "OpenAI",
    group: "commercial",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    apiFormat: "responses",
    capabilities: ["text", "vision", "structured_output", "speech", "streaming"],
    models: { text: ["gpt-5.5"], vision: ["gpt-5.5"], speech: ["gpt-4o-mini-tts"] },
    documentationUrl: "https://developers.openai.com/api/docs/guides/latest-model",
    verifiedAt: "2026-06-18",
    creatable: true,
    speechVoices: openAiVoices.map((id) => ({ id, label: id })),
  },
  {
    provider: "google",
    label: "Google Gemini",
    group: "commercial",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
    apiFormat: "google_generate_content",
    capabilities: ["text", "vision", "structured_output", "speech", "streaming"],
    models: {
      text: ["gemini-3.5-flash"],
      vision: ["gemini-3.5-flash"],
      speech: ["gemini-3.1-flash-tts-preview"],
    },
    documentationUrl: "https://ai.google.dev/gemini-api/docs/models",
    verifiedAt: "2026-06-18",
    creatable: true,
    speechVoices: googleVoices.map((id) => ({ id, label: id })),
  },
  {
    provider: "anthropic",
    label: "Anthropic Claude",
    group: "commercial",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-4-8",
    apiFormat: "anthropic_messages",
    capabilities: ["text", "vision", "structured_output", "streaming"],
    models: { text: ["claude-opus-4-8", "claude-sonnet-4-6"], vision: ["claude-opus-4-8", "claude-sonnet-4-6"] },
    documentationUrl: "https://docs.anthropic.com/en/docs/about-claude/models/overview",
    verifiedAt: "2026-06-18",
    creatable: true,
  },
  {
    provider: "xai",
    label: "xAI Grok",
    group: "commercial",
    baseUrl: "https://api.x.ai/v1",
    model: "",
    apiFormat: "chat_completions",
    capabilities: ["text", "vision", "structured_output", "streaming"],
    models: {},
    documentationUrl: "https://docs.x.ai/docs/models",
    verifiedAt: "",
    creatable: true,
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    group: "open_source",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiFormat: "chat_completions",
    capabilities: ["text", "structured_output", "streaming"],
    models: { text: ["deepseek-v4-pro", "deepseek-v4-flash"] },
    documentationUrl: "https://api-docs.deepseek.com/api/create-chat-completion",
    verifiedAt: "2026-06-18",
    creatable: true,
  },
  {
    provider: "qwen",
    label: "Qwen",
    group: "open_source",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "",
    apiFormat: "chat_completions",
    capabilities: ["text", "vision", "structured_output", "streaming"],
    models: {},
    documentationUrl: "https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference",
    verifiedAt: "",
    creatable: true,
  },
  {
    provider: "elevenlabs",
    label: "ElevenLabs",
    group: "speech",
    baseUrl: "https://api.elevenlabs.io/v1",
    model: "eleven_multilingual_v2",
    apiFormat: "chat_completions",
    capabilities: ["speech"],
    models: { speech: ["eleven_multilingual_v2"] },
    documentationUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    verifiedAt: "2026-06-18",
    creatable: true,
  },
  {
    provider: "azure",
    label: "Azure AI Speech",
    group: "speech",
    baseUrl: "",
    model: "",
    apiFormat: "azure_speech",
    capabilities: ["speech"],
    models: {},
    documentationUrl: "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech",
    verifiedAt: "2026-06-18",
    creatable: true,
  },
  {
    provider: "minimax",
    label: "MiniMax",
    group: "speech",
    baseUrl: "https://api.minimax.io/v1",
    model: "speech-2.8-hd",
    apiFormat: "chat_completions",
    capabilities: ["speech"],
    models: { speech: ["speech-2.8-hd", "speech-2.8-turbo"] },
    documentationUrl: "https://platform.minimax.io/docs/api-reference/speech-t2a-http",
    verifiedAt: "2026-06-18",
    creatable: true,
  },
  // 历史厂商不再出现在新建列表，但仍保留契约以读取旧连接和密文 Key。
  ...[
    ["zhipu", "智谱", "https://open.bigmodel.cn/api/paas/v4"],
    ["kimi", "Kimi", "https://api.moonshot.cn/v1"],
    ["doubao", "豆包 / 火山方舟", "https://ark.cn-beijing.volces.com/api/v3"],
  ].map(([provider, label, baseUrl]) => ({
    provider: provider as ApiProvider,
    label,
    group: "legacy" as const,
    baseUrl,
    model: "",
    apiFormat: provider === "doubao" ? ("responses" as const) : ("chat_completions" as const),
    capabilities: provider === "doubao" ? (["text", "vision", "structured_output", "speech", "streaming"] as AiCapability[]) : (["text", "vision", "structured_output", "streaming"] as AiCapability[]),
    models: {},
    documentationUrl: "",
    verifiedAt: "",
    creatable: false,
  })),
  {
    provider: "custom",
    label: "本地部署 / 自定义连接",
    group: "custom",
    baseUrl: "",
    model: "",
    apiFormat: "chat_completions",
    capabilities: ["text", "vision", "structured_output", "speech"],
    models: {},
    documentationUrl: "",
    verifiedAt: "",
    creatable: true,
  },
];

export const creatableProviderContracts = providerContracts.filter((contract) => contract.creatable);

// 根据厂商标识读取稳定契约，未知值统一回退到自定义连接。
export function getProviderContract(provider: ApiProvider): ProviderContract {
  return providerContracts.find((item) => item.provider === provider) ?? providerContracts.find((item) => item.provider === "custom")!;
}

// 返回某项能力已经由官方文档核验的模型；空数组表示需要用户自行填写。
export function getProviderModels(provider: ApiProvider, purpose: AiConnectionPurpose): string[] {
  return getProviderContract(provider).models[purpose] ?? [];
}
