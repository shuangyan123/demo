import type { ApiProvider } from "../types/review";

export type ProviderBranding = {
  label: string;
  iconPath: string;
  color: string;
};

const generic: ProviderBranding = { label: "AI 服务", iconPath: "/provider-icons/generic.svg", color: "#8490a5" };

/** 厂商品牌信息集中维护，连接与额度界面禁止自行绘制字母色块。 */
export const providerBranding: Record<ApiProvider, ProviderBranding> = {
  openai: { label: "OpenAI", iconPath: "/plugin-icons/openai.svg", color: "#10a37f" },
  azure_openai: { label: "Azure OpenAI", iconPath: "/provider-icons/generic.svg", color: "#0078d4" },
  google: { label: "Google Gemini", iconPath: "/provider-icons/google.svg", color: "#8e75b2" },
  anthropic: { label: "Anthropic", iconPath: "/provider-icons/anthropic.svg", color: "#191919" },
  xai: { label: "xAI", iconPath: "/provider-icons/xai.svg", color: "#000000" },
  deepseek: { label: "DeepSeek", iconPath: "/provider-icons/deepseek.svg", color: "#5786fe" },
  qwen: { label: "Qwen", iconPath: "/provider-icons/qwen.svg", color: "#ff6a00" },
  openrouter: { label: "OpenRouter", iconPath: "/provider-icons/openrouter.svg", color: "#94a3b8" },
  groq: { ...generic, label: "Groq" },
  mistral: { label: "Mistral", iconPath: "/provider-icons/mistral.svg", color: "#fa520f" },
  siliconflow: { ...generic, label: "SiliconFlow" },
  zhipu: { ...generic, label: "智谱 GLM" },
  kimi: { ...generic, label: "Moonshot Kimi" },
  doubao: { label: "火山方舟 / 豆包", iconPath: "/provider-icons/bytedance.svg", color: "#3c8cff" },
  baidu: { label: "百度千帆", iconPath: "/provider-icons/baidu.svg", color: "#2932e1" },
  tencent: { ...generic, label: "腾讯混元" },
  elevenlabs: { label: "ElevenLabs", iconPath: "/provider-icons/elevenlabs.svg", color: "#000000" },
  azure: { ...generic, label: "Azure Speech" },
  minimax: { label: "MiniMax", iconPath: "/provider-icons/minimax.svg", color: "#e21680" },
  custom: { ...generic, label: "自定义连接" },
};

export function getProviderBranding(provider: ApiProvider): ProviderBranding {
  return providerBranding[provider] ?? generic;
}
