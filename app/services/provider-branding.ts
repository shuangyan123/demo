import type { ApiProvider } from "../types/review";

export type ProviderBranding = {
  label: string;
  iconPath?: string;
  mark: string;
  color: string;
  sourceUrl: string;
  assetSourceUrl?: string;
  assetChecksum?: string;
  themeVariant?: "single" | "adaptive";
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
  openai: brand({ label: "OpenAI", mark: "OA", color: "#111111", sourceUrl: "https://openai.com/brand/", licenseNote: "官方标志下载包含不可裁切的安全留白；当前使用文字缩写，避免继续使用非官方仿制图标。" }),
  azure_openai: brand({ label: "Azure OpenAI", mark: "Az", color: "#0078d4", sourceUrl: "https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks", licenseNote: "Microsoft 指南限制无授权 Logo 使用，因此使用产品文字缩写。" }),
  google: brand({ label: "Google Gemini", iconPath: "/provider-icons/google.svg", mark: "G", color: "#8e75b2", sourceUrl: "https://ai.google.dev/", assetSourceUrl: "https://ai.google.dev/", assetChecksum: "2bbf76d70a46c5232054f7ba11cc8cd4ffed5044c13fb2910c7f643ca0f12f5d", themeVariant: "single" }),
  anthropic: brand({ label: "Anthropic Claude", iconPath: "/provider-icons/anthropic.svg", mark: "A", color: "#191919", sourceUrl: "https://www.anthropic.com/", assetSourceUrl: "https://www.anthropic.com/", assetChecksum: "ed85801f453d8cdca14078a757b70424d38b7744c2724747181078dd7368dac0", themeVariant: "single" }),
  xai: brand({ label: "xAI Grok", iconPath: "/provider-icons/xai.svg", mark: "x", color: "#000000", sourceUrl: "https://x.ai/", assetSourceUrl: "https://x.ai/", assetChecksum: "fbf71fe10e5e6d9331be75719cdf0afc9d26862cb65212a90ce64c65f766ca5d", themeVariant: "single" }),
  deepseek: brand({ label: "DeepSeek", iconPath: "/provider-icons/deepseek.svg", mark: "D", color: "#5786fe", sourceUrl: "https://www.deepseek.com/", assetSourceUrl: "https://www.deepseek.com/", assetChecksum: "862be0efea20dc8b0e81489cc29aae4581494824191457608bf0837cfc98d0ca", themeVariant: "single" }),
  qwen: brand({ label: "Qwen", iconPath: "/provider-icons/qwen.svg", mark: "Q", color: "#ff6a00", sourceUrl: "https://qwen.ai/", assetSourceUrl: "https://qwen.ai/", assetChecksum: "c5859e5e8865a67f2bd7f1951d11c2d90b63ce27d8354a34ad2b283fc47ecd5d", themeVariant: "single" }),
  openrouter: brand({ label: "OpenRouter", iconPath: "/provider-icons/openrouter.svg", mark: "OR", color: "#c8ff00", sourceUrl: "https://openrouter.ai/brand", assetSourceUrl: "https://openrouter.ai/brand/v2/openrouter-glyph-dark.svg", assetChecksum: "21e68f0a39714b93fca39a29e6676558323d42be0b851adb1363d3d8dd23e22e", themeVariant: "single" }),
  groq: brand({ label: "Groq", mark: "Gq", color: "#f55036", sourceUrl: "https://groq.com/trademark-policy", licenseNote: "Groq 商标政策限制无授权 Logo 使用，因此使用产品文字缩写。" }),
  mistral: brand({ label: "Mistral", iconPath: "/provider-icons/mistral.svg", mark: "M", color: "#fa520f", sourceUrl: "https://mistral.ai/", assetSourceUrl: "https://mistral.ai/cms-media/api/media/file/icon-m-flower.svg", assetChecksum: "c0aedb861efc7c0ad9faaeb17176fc1c1cab4d1a70aa3bcc06812450977ba04a", themeVariant: "single" }),
  siliconflow: brand({ label: "SiliconFlow", mark: "SF", color: "#4f46e5", sourceUrl: "https://siliconflow.cn/" }),
  zhipu: brand({ label: "智谱 GLM", iconPath: "/provider-icons/zhipu.svg", mark: "GL", color: "#2454ff", sourceUrl: "https://www.bigmodel.cn/", assetSourceUrl: "https://www.bigmodel.cn/", assetChecksum: "4dd428d70a6e0b33a19e3c957bf0b1b5945560295f64a7c47f70c00dd0785a76", themeVariant: "single" }),
  kimi: brand({ label: "Moonshot Kimi", mark: "K", color: "#111827", sourceUrl: "https://www.kimi.com/" }),
  doubao: brand({ label: "火山方舟 / 豆包", iconPath: "/provider-icons/bytedance.svg", mark: "豆", color: "#3c8cff", sourceUrl: "https://www.volcengine.com/product/ark", assetSourceUrl: "https://www.volcengine.com/product/ark", assetChecksum: "c3e9a728c21ecf000927c6539784fef7ddff6b1d4148f60a9093631cf8d8df68", themeVariant: "single" }),
  baidu: brand({ label: "百度千帆", iconPath: "/provider-icons/baidu.svg", mark: "千", color: "#2932e1", sourceUrl: "https://cloud.baidu.com/product/wenxinworkshop", assetSourceUrl: "https://cloud.baidu.com/product/wenxinworkshop", assetChecksum: "d13d77ff36eb92c0e639c948f561327caa3cada9773d983ea33ffa34fa44e2c1", themeVariant: "single" }),
  tencent: brand({ label: "腾讯混元", mark: "混", color: "#006eff", sourceUrl: "https://cloud.tencent.com/product/hunyuan" }),
  elevenlabs: brand({ label: "ElevenLabs", iconPath: "/provider-icons/elevenlabs.svg", mark: "11", color: "#000000", sourceUrl: "https://elevenlabs.io/", assetSourceUrl: "https://elevenlabs.io/icon.svg", assetChecksum: "a8ccade64d9d38696c6f47a17ad1eb6d941d687bea0adc7af9b2ccce0e26c29a", themeVariant: "single" }),
  azure: brand({ label: "Azure AI Speech", mark: "Az", color: "#0078d4", sourceUrl: "https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks", licenseNote: "Microsoft 指南限制无授权 Logo 使用，因此使用产品文字缩写。" }),
  minimax: brand({ label: "MiniMax", iconPath: "/provider-icons/minimax.svg", mark: "MM", color: "#e21680", sourceUrl: "https://www.minimaxi.com/", assetSourceUrl: "https://www.minimaxi.com/", assetChecksum: "6dd6e9935ca13874afde71471b835830ef917bbaac4ceff34f589d4c98c10d73", themeVariant: "single" }),
  custom: brand({ label: "Local / Custom", iconPath: "/provider-icons/generic.svg", mark: "AI", color: "#8490a5", sourceUrl: "", licenseNote: "自定义连接使用应用通用图标。" }),
};

export function getProviderBranding(provider: ApiProvider): ProviderBranding {
  return providerBranding[provider];
}
