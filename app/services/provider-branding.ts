import type { ApiProvider } from "../types/review";

export type ProviderBranding = {
  label: string;
  iconPath?: string;
  mark: string;
  color: string;
  sourceUrl: string;
  verifiedAt: string;
  licenseNote: string;
};

const verifiedAt = "2026-07-14";
const nominativeNote = "仅用于准确识别兼容服务；商标归各自权利人所有，不表示厂商背书。";

function brand(input: Omit<ProviderBranding, "verifiedAt" | "licenseNote"> & Partial<Pick<ProviderBranding, "licenseNote">>): ProviderBranding {
  return { ...input, verifiedAt, licenseNote: input.licenseNote ?? nominativeNote };
}

/**
 * 厂商品牌来源集中登记。只有官方已公开且本地已有可用资产时使用图形标志；
 * 对明确限制第三方 Logo 的厂商使用文字缩写，避免用通用机器人图标冒充品牌。
 */
export const providerBranding: Record<ApiProvider, ProviderBranding> = {
  openai: brand({ label: "OpenAI", iconPath: "/plugin-icons/openai.svg", mark: "OA", color: "#10a37f", sourceUrl: "https://openai.com/brand/" }),
  azure_openai: brand({ label: "Azure OpenAI", mark: "Az", color: "#0078d4", sourceUrl: "https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks", licenseNote: "Microsoft 指南限制无授权 Logo 使用，因此使用产品文字缩写。" }),
  google: brand({ label: "Google Gemini", iconPath: "/provider-icons/google.svg", mark: "G", color: "#8e75b2", sourceUrl: "https://ai.google.dev/" }),
  anthropic: brand({ label: "Anthropic Claude", iconPath: "/provider-icons/anthropic.svg", mark: "A", color: "#191919", sourceUrl: "https://www.anthropic.com/" }),
  xai: brand({ label: "xAI Grok", iconPath: "/provider-icons/xai.svg", mark: "x", color: "#000000", sourceUrl: "https://x.ai/" }),
  deepseek: brand({ label: "DeepSeek", iconPath: "/provider-icons/deepseek.svg", mark: "D", color: "#5786fe", sourceUrl: "https://www.deepseek.com/" }),
  qwen: brand({ label: "Qwen", iconPath: "/provider-icons/qwen.svg", mark: "Q", color: "#ff6a00", sourceUrl: "https://qwen.ai/" }),
  openrouter: brand({ label: "OpenRouter", iconPath: "/provider-icons/openrouter.svg", mark: "OR", color: "#94a3b8", sourceUrl: "https://openrouter.ai/" }),
  groq: brand({ label: "Groq", mark: "Gq", color: "#f55036", sourceUrl: "https://groq.com/trademark-policy", licenseNote: "Groq 商标政策限制无授权 Logo 使用，因此使用产品文字缩写。" }),
  mistral: brand({ label: "Mistral", iconPath: "/provider-icons/mistral.svg", mark: "M", color: "#fa520f", sourceUrl: "https://mistral.ai/" }),
  siliconflow: brand({ label: "SiliconFlow", mark: "SF", color: "#4f46e5", sourceUrl: "https://siliconflow.cn/" }),
  zhipu: brand({ label: "智谱 GLM", iconPath: "/provider-icons/zhipu.svg", mark: "GL", color: "#2454ff", sourceUrl: "https://www.bigmodel.cn/" }),
  kimi: brand({ label: "Moonshot Kimi", mark: "K", color: "#111827", sourceUrl: "https://www.kimi.com/" }),
  doubao: brand({ label: "火山方舟 / 豆包", iconPath: "/provider-icons/bytedance.svg", mark: "豆", color: "#3c8cff", sourceUrl: "https://www.volcengine.com/product/ark" }),
  baidu: brand({ label: "百度千帆", iconPath: "/provider-icons/baidu.svg", mark: "千", color: "#2932e1", sourceUrl: "https://cloud.baidu.com/product/wenxinworkshop" }),
  tencent: brand({ label: "腾讯混元", mark: "混", color: "#006eff", sourceUrl: "https://cloud.tencent.com/product/hunyuan" }),
  elevenlabs: brand({ label: "ElevenLabs", iconPath: "/provider-icons/elevenlabs.svg", mark: "11", color: "#000000", sourceUrl: "https://elevenlabs.io/" }),
  azure: brand({ label: "Azure AI Speech", mark: "Az", color: "#0078d4", sourceUrl: "https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks", licenseNote: "Microsoft 指南限制无授权 Logo 使用，因此使用产品文字缩写。" }),
  minimax: brand({ label: "MiniMax", iconPath: "/provider-icons/minimax.svg", mark: "MM", color: "#e21680", sourceUrl: "https://www.minimax.io/" }),
  custom: brand({ label: "Local / Custom", iconPath: "/provider-icons/generic.svg", mark: "AI", color: "#8490a5", sourceUrl: "", licenseNote: "自定义连接使用应用通用图标。" }),
};

export function getProviderBranding(provider: ApiProvider): ProviderBranding {
  return providerBranding[provider];
}
