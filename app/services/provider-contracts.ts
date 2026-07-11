import type { AiCapability, AiConnectionPurpose, AiModelCatalogEntry, ApiFormat, ApiProvider } from "../types/review";

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
  modelCatalog: AiModelCatalogEntry[];
  modelListStrategy: "official_api" | "static_catalog" | "manual";
  documentationUrl: string;
  verifiedAt: string;
  creatable: boolean;
  speechVoices?: Array<{ id: string; label: string }>;
};

const verifiedAt = "2026-07-09";
const openAiVoices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
const googleVoices = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];

function model(
  provider: ApiProvider,
  id: string,
  purposes: AiConnectionPurpose[],
  capabilities: AiCapability[],
  status: AiModelCatalogEntry["status"],
  documentationUrl?: string,
): AiModelCatalogEntry {
  return {
    id,
    label: id,
    provider,
    purposes,
    capabilities,
    status,
    source: documentationUrl ? "official" : "manual",
    documentationUrl,
    verifiedAt: documentationUrl ? verifiedAt : undefined,
  };
}

function modelsByPurpose(catalog: AiModelCatalogEntry[]): Partial<Record<AiConnectionPurpose, string[]>> {
  return catalog.reduce<Partial<Record<AiConnectionPurpose, string[]>>>((groups, entry) => {
    for (const purpose of entry.purposes) {
      groups[purpose] = [...(groups[purpose] ?? []), entry.id];
    }
    return groups;
  }, {});
}

function contract(input: Omit<ProviderContract, "models"> & { models?: Partial<Record<AiConnectionPurpose, string[]>> }): ProviderContract {
  return { ...input, models: input.models ?? modelsByPurpose(input.modelCatalog) };
}

const openAiCatalog = [
  model("openai", "gpt-5.5", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "recommended", "https://developers.openai.com/api/docs/models"),
  model("openai", "gpt-5.4", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "stable", "https://developers.openai.com/api/docs/models/gpt-5.4"),
  model("openai", "gpt-5.4-mini", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "stable", "https://developers.openai.com/api/docs/models/gpt-5.4-mini"),
  model("openai", "gpt-5.4-nano", ["text"], ["text", "structured_output", "streaming"], "stable", "https://developers.openai.com/api/docs/models/gpt-5.4-nano"),
  model("openai", "gpt-4o-mini", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "stable", "https://developers.openai.com/api/docs/models/gpt-4o-mini"),
  model("openai", "gpt-4o-mini-tts", ["speech"], ["speech"], "stable", "https://developers.openai.com/api/docs/models"),
];

const googleCatalog = [
  model("google", "gemini-3.5-flash", ["text", "vision", "transcription"], ["text", "vision", "transcription", "structured_output", "streaming"], "recommended", "https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash"),
  model("google", "gemini-3.1-pro-preview", ["text", "vision", "transcription"], ["text", "vision", "transcription", "structured_output", "streaming"], "preview", "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview"),
  model("google", "gemini-3.1-flash-lite", ["text", "vision", "transcription"], ["text", "vision", "transcription", "structured_output", "streaming"], "stable", "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite"),
  model("google", "gemini-2.5-flash", ["text", "vision", "transcription"], ["text", "vision", "transcription", "structured_output", "streaming"], "stable", "https://ai.google.dev/gemini-api/docs/models"),
  model("google", "gemini-2.5-flash-lite", ["text", "vision", "transcription"], ["text", "vision", "transcription", "structured_output", "streaming"], "stable", "https://ai.google.dev/gemini-api/docs/models"),
  model("google", "gemini-2.5-pro", ["text", "vision", "transcription"], ["text", "vision", "transcription", "structured_output", "streaming"], "stable", "https://ai.google.dev/gemini-api/docs/models"),
  model("google", "gemini-3.1-flash-tts-preview", ["speech"], ["speech"], "preview", "https://ai.google.dev/gemini-api/docs/models"),
];

const anthropicCatalog = [
  model("anthropic", "claude-opus-4-8", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "recommended", "https://platform.claude.com/docs/en/about-claude/models/overview"),
  model("anthropic", "claude-sonnet-5", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "stable", "https://platform.claude.com/docs/en/about-claude/models/overview"),
  model("anthropic", "claude-sonnet-4-6", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "stable", "https://platform.claude.com/docs/en/about-claude/models/overview"),
];

const deepSeekCatalog = [
  model("deepseek", "deepseek-v4-flash", ["text"], ["text", "structured_output", "streaming"], "recommended", "https://api-docs.deepseek.com/api/list-models"),
  model("deepseek", "deepseek-v4-pro", ["text"], ["text", "structured_output", "streaming"], "stable", "https://api-docs.deepseek.com/quick_start/pricing"),
];

export const providerContracts: ProviderContract[] = [
  contract({
    provider: "openai",
    label: "OpenAI",
    group: "commercial",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    apiFormat: "responses",
    capabilities: ["text", "vision", "structured_output", "speech", "transcription", "streaming"],
    modelCatalog: openAiCatalog,
    modelListStrategy: "official_api",
    documentationUrl: "https://developers.openai.com/api/docs/models",
    verifiedAt,
    creatable: true,
    speechVoices: openAiVoices.map((id) => ({ id, label: id })),
  }),
  contract({
    provider: "azure_openai",
    label: "Azure OpenAI",
    group: "commercial",
    baseUrl: "",
    model: "",
    apiFormat: "responses",
    capabilities: ["text", "vision", "structured_output", "streaming"],
    modelCatalog: [],
    modelListStrategy: "manual",
    documentationUrl: "https://learn.microsoft.com/en-us/azure/ai-services/openai/",
    verifiedAt: "",
    creatable: true,
  }),
  contract({
    provider: "google",
    label: "Google Gemini",
    group: "commercial",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.5-flash",
    apiFormat: "google_generate_content",
    capabilities: ["text", "vision", "structured_output", "speech", "transcription", "streaming"],
    modelCatalog: googleCatalog,
    modelListStrategy: "official_api",
    documentationUrl: "https://ai.google.dev/gemini-api/docs/models",
    verifiedAt,
    creatable: true,
    speechVoices: googleVoices.map((id) => ({ id, label: id })),
  }),
  contract({
    provider: "anthropic",
    label: "Anthropic Claude",
    group: "commercial",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-opus-4-8",
    apiFormat: "anthropic_messages",
    capabilities: ["text", "vision", "structured_output", "streaming"],
    modelCatalog: anthropicCatalog,
    modelListStrategy: "static_catalog",
    documentationUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
    verifiedAt,
    creatable: true,
  }),
  contract({
    provider: "xai",
    label: "xAI Grok",
    group: "commercial",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.5",
    apiFormat: "responses",
    capabilities: ["text", "vision", "structured_output", "streaming"],
    modelCatalog: [
      model("xai", "grok-4.5", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "recommended", "https://docs.x.ai/developers/models"),
    ],
    modelListStrategy: "official_api",
    documentationUrl: "https://docs.x.ai/developers/models",
    verifiedAt,
    creatable: true,
  }),
  contract({
    provider: "deepseek",
    label: "DeepSeek",
    group: "open_source",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiFormat: "chat_completions",
    capabilities: ["text", "structured_output", "streaming"],
    modelCatalog: deepSeekCatalog,
    modelListStrategy: "official_api",
    documentationUrl: "https://api-docs.deepseek.com/api/list-models",
    verifiedAt,
    creatable: true,
  }),
  contract({
    provider: "qwen",
    label: "Qwen / DashScope",
    group: "open_source",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-max",
    apiFormat: "chat_completions",
    capabilities: ["text", "vision", "structured_output", "streaming", "speech"],
    modelCatalog: [
      model("qwen", "qwen3-max", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "manual"),
      model("qwen", "qwen3-plus", ["text", "vision"], ["text", "vision", "structured_output", "streaming"], "manual"),
      model("qwen", "qwen-tts", ["speech"], ["speech"], "manual"),
    ],
    modelListStrategy: "manual",
    documentationUrl: "https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference",
    verifiedAt: "",
    creatable: true,
  }),
  ...[
    ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-5.5"],
    ["groq", "Groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"],
    ["mistral", "Mistral", "https://api.mistral.ai/v1", "mistral-large-latest"],
    ["siliconflow", "SiliconFlow", "https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4-Flash"],
    ["zhipu", "Zhipu GLM", "https://open.bigmodel.cn/api/paas/v4", "glm-4.5"],
    ["kimi", "Moonshot Kimi", "https://api.moonshot.cn/v1", "kimi-k2-latest"],
    ["doubao", "Volcengine Ark / Doubao", "https://ark.cn-beijing.volces.com/api/v3", "doubao-seed-1.6"],
    ["baidu", "Baidu Qianfan", "https://qianfan.baidubce.com/v2", "ernie-4.5-turbo"],
    ["tencent", "Tencent Hunyuan", "https://api.hunyuan.cloud.tencent.com/v1", "hunyuan-turbos-latest"],
  ].map(([provider, label, baseUrl, defaultModel]) => contract({
    provider: provider as ApiProvider,
    label,
    group: provider === "mistral" || provider === "siliconflow" ? "open_source" : "commercial",
    baseUrl,
    model: defaultModel,
    apiFormat: "chat_completions" as const,
    capabilities: ["text", "structured_output", "streaming"] as AiCapability[],
    modelCatalog: [
      model(provider as ApiProvider, defaultModel, ["text"], ["text", "structured_output", "streaming"], "manual"),
    ],
    modelListStrategy: "manual" as const,
    documentationUrl: "",
    verifiedAt: "",
    creatable: true,
  })),
  contract({
    provider: "elevenlabs",
    label: "ElevenLabs",
    group: "commercial",
    baseUrl: "https://api.elevenlabs.io/v1",
    model: "eleven_multilingual_v2",
    apiFormat: "chat_completions",
    capabilities: ["speech"],
    modelCatalog: [model("elevenlabs", "eleven_multilingual_v2", ["speech"], ["speech"], "stable", "https://elevenlabs.io/docs/api-reference/text-to-speech/convert")],
    modelListStrategy: "static_catalog",
    documentationUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
    verifiedAt,
    creatable: true,
  }),
  contract({
    provider: "azure",
    label: "Azure AI Speech",
    group: "speech",
    baseUrl: "",
    model: "",
    apiFormat: "azure_speech",
    capabilities: ["speech"],
    modelCatalog: [],
    modelListStrategy: "manual",
    documentationUrl: "https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech",
    verifiedAt,
    creatable: true,
  }),
  contract({
    provider: "minimax",
    label: "MiniMax",
    group: "speech",
    baseUrl: "https://api.minimax.io/v1",
    model: "speech-2.8-hd",
    apiFormat: "chat_completions",
    capabilities: ["text", "structured_output", "speech", "streaming"],
    modelCatalog: [
      model("minimax", "MiniMax-M2.7", ["text"], ["text", "structured_output", "streaming"], "recommended", "https://platform.minimax.io/docs/guides/models-intro"),
      model("minimax", "MiniMax-M2.7-highspeed", ["text"], ["text", "structured_output", "streaming"], "stable", "https://platform.minimax.io/docs/guides/models-intro"),
      model("minimax", "MiniMax-M2.5", ["text"], ["text", "structured_output", "streaming"], "stable", "https://platform.minimax.io/docs/guides/models-intro"),
      model("minimax", "speech-2.8-hd", ["speech"], ["speech"], "recommended", "https://platform.minimax.io/docs/guides/models-intro"),
      model("minimax", "speech-2.8-turbo", ["speech"], ["speech"], "stable", "https://platform.minimax.io/docs/guides/models-intro"),
    ],
    modelListStrategy: "manual",
    documentationUrl: "https://platform.minimax.io/docs/api-reference/speech-t2a-http",
    verifiedAt,
    creatable: true,
  }),
  contract({
    provider: "custom",
    label: "Local / Custom OpenAI compatible",
    group: "custom",
    baseUrl: "",
    model: "",
    apiFormat: "chat_completions",
    capabilities: ["text", "vision", "structured_output", "speech", "streaming"],
    modelCatalog: [],
    modelListStrategy: "manual",
    documentationUrl: "",
    verifiedAt: "",
    creatable: true,
  }),
];

export const creatableProviderContracts = providerContracts.filter((contract) => contract.creatable);

export function getProviderContract(provider: ApiProvider): ProviderContract {
  return providerContracts.find((item) => item.provider === provider) ?? providerContracts.find((item) => item.provider === "custom")!;
}

export function getProviderModels(provider: ApiProvider, purpose: AiConnectionPurpose): string[] {
  return getProviderContract(provider).models[purpose] ?? [];
}

export function getProviderModelCatalog(provider: ApiProvider, purpose?: AiConnectionPurpose): AiModelCatalogEntry[] {
  const catalog = getProviderContract(provider).modelCatalog;
  return purpose ? catalog.filter((entry) => entry.purposes.includes(purpose)) : catalog;
}
