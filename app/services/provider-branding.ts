import type { ApiProvider } from "../types/domains/ai-provider.ts";

/** 品牌资产的登记来源，Lobe Icons 仅作为用户指定的社区图标包，不冒充厂商官方品牌包。 */
export type ProviderBrandingAssetOrigin = "lobe-icons" | "official" | "text";

/** AI 厂商在所有选择器、连接和额度界面共用的品牌描述。 */
export type ProviderBranding = {
  label: string;
  iconPath?: string;
  mark: string;
  color: string;
  sourceUrl: string;
  assetSourceUrl?: string;
  assetChecksum?: string;
  assetOrigin: ProviderBrandingAssetOrigin;
  assetVersion?: string;
  themeVariant?: "single" | "adaptive";
  verifiedAt: string;
  licenseNote: string;
  renderMode?: "image" | "mask";
};

const VERIFIED_AT = "2026-07-15";
const LOBE_VERSION = "1.91.0";
const LOBE_SOURCE = "https://github.com/lobehub/lobe-icons";
const LOBE_LICENSE = "Lobe Icons 为 MIT 许可的社区品牌图标包；商标仍归各权利人所有，不表示厂商背书。";
const TEXT_LICENSE = "当前没有采用可核验的图形资产，使用规范文字缩写识别服务。";

type LobeBrandInput = {
  label: string;
  slug: string;
  checksum: string;
  mark: string;
  color: string;
  adaptive?: boolean;
  renderMode?: "image" | "mask";
};

/** 创建固定版本的本地 Lobe Icons 登记，禁止运行时访问 CDN。 */
function lobeBrand(input: LobeBrandInput): ProviderBranding {
  return {
    label: input.label,
    iconPath: `/provider-icons/lobe/${input.slug}.svg`,
    mark: input.mark,
    color: input.color,
    sourceUrl: LOBE_SOURCE,
    assetSourceUrl: `https://unpkg.com/@lobehub/icons-static-svg@${LOBE_VERSION}/icons/${input.slug}.svg`,
    assetChecksum: input.checksum,
    assetOrigin: "lobe-icons",
    assetVersion: LOBE_VERSION,
    themeVariant: input.adaptive ? "adaptive" : "single",
    verifiedAt: VERIFIED_AT,
    licenseNote: LOBE_LICENSE,
    renderMode: input.renderMode ?? "image",
  };
}

/** 创建文字回退品牌；只有 custom 使用应用通用图标。 */
function textBrand(label: string, mark: string, color: string, sourceUrl: string): ProviderBranding {
  return {
    label,
    mark,
    color,
    sourceUrl,
    assetOrigin: "text",
    verifiedAt: VERIFIED_AT,
    licenseNote: TEXT_LICENSE,
  };
}

/** 厂商品牌来源集中登记，同一厂商在所有界面只渲染同一份资产。 */
export const providerBranding: Record<ApiProvider, ProviderBranding> = {
  openai: lobeBrand({ label: "OpenAI", slug: "openai", checksum: "a595df6b423920c67a7f8f73c063e4bfb72d415948097b6cac063a2366bb5186", mark: "OA", color: "#111111", adaptive: true }),
  azure_openai: lobeBrand({ label: "Azure OpenAI", slug: "azureai-color", checksum: "89bef85d67f45984dba85f8d7e6a8ed91585f706c43f7236a89590d8f4940fde", mark: "Az", color: "#0078d4" }),
  google: lobeBrand({ label: "Google Gemini", slug: "gemini-color", checksum: "8ab0a9bafec11f7e69bcb9fc4ffd8f1bc927d1ddcbbb6ff36dee5ae8b5a9d602", mark: "G", color: "#8e75b2" }),
  anthropic: lobeBrand({ label: "Anthropic Claude", slug: "claude", checksum: "365a70a7eb3956d9b9a96086058ebe04e1dbd8e291a756ad964e8a283fbd6d38", mark: "A", color: "#d97757", adaptive: true, renderMode: "mask" }),
  xai: lobeBrand({ label: "xAI Grok", slug: "xai", checksum: "89eb7de9f0d02a41cfecd9109e253d7fd3529e27467dee4254faa67f3ac21451", mark: "x", color: "#111111", adaptive: true }),
  deepseek: lobeBrand({ label: "DeepSeek", slug: "deepseek-color", checksum: "deba5f98a5c1796e20fcac3149bcd7eb8a32f0bdd04d048819400b1f28bd1439", mark: "D", color: "#5786fe" }),
  qwen: lobeBrand({ label: "Qwen", slug: "qwen-color", checksum: "77f5768c66d08ce1d3d14e73373975c1bc0454be88c81523ddd0ffd7e2974029", mark: "Q", color: "#615ced" }),
  openrouter: lobeBrand({ label: "OpenRouter", slug: "openrouter", checksum: "c9e48eae623a76ff784877bad6f70f57c67811a05a4ab2450814c7d285b17d24", mark: "OR", color: "#111111", adaptive: true }),
  groq: lobeBrand({ label: "Groq", slug: "groq", checksum: "078d5cf6e7a54905040c15ddacf5ea33c13042fe7739e820cedc2096e4406651", mark: "Gq", color: "#f55036", adaptive: true }),
  mistral: lobeBrand({ label: "Mistral", slug: "mistral-color", checksum: "722f74b289d95486b43662fe24fa883b333701296f618406cd0ed502299170b6", mark: "M", color: "#fa520f" }),
  siliconflow: lobeBrand({ label: "SiliconFlow", slug: "siliconcloud-color", checksum: "a02d8d7ccb81739fbc720e2e5daaf149013dd5088605dc2dce1b71df0784d424", mark: "SF", color: "#4f46e5" }),
  zhipu: lobeBrand({ label: "智谱 GLM", slug: "zhipu-color", checksum: "8174e65ff71647d5c705c920c953a82bd723d9e3e42887bdd4ffc9dfe51207a0", mark: "GL", color: "#2454ff" }),
  kimi: lobeBrand({ label: "Moonshot Kimi", slug: "kimi-color", checksum: "74a7292aeb0220445d14c5d397d75760e2e8c6ed6a9e5fe4f3023471bf62a9ff", mark: "K", color: "#111827" }),
  doubao: lobeBrand({ label: "火山方舟 / 豆包", slug: "doubao-color", checksum: "3cd31ba03ae44b8c29561597a3b863809efecb13fcdfd08407a086df86a69b55", mark: "豆", color: "#3c8cff" }),
  baidu: lobeBrand({ label: "百度千帆", slug: "baiducloud-color", checksum: "2269f4c82a3a810f42691c82d0d5086961c2b684a2dcc1e7523cd9f8564e2f35", mark: "千", color: "#2932e1" }),
  tencent: lobeBrand({ label: "腾讯混元", slug: "hunyuan-color", checksum: "510e7bb438506b5aadfaf8b9551d1606efd5b4171161a64a64204c72a453658a", mark: "混", color: "#006eff" }),
  elevenlabs: lobeBrand({ label: "ElevenLabs", slug: "elevenlabs", checksum: "152a4a89fd5228924b6ccc91a72675966df35e3b69d1cf93a67b6866cf846584", mark: "11", color: "#111111", adaptive: true }),
  azure: lobeBrand({ label: "Azure AI Speech", slug: "azureai-color", checksum: "89bef85d67f45984dba85f8d7e6a8ed91585f706c43f7236a89590d8f4940fde", mark: "Az", color: "#0078d4" }),
  minimax: lobeBrand({ label: "MiniMax", slug: "minimax-color", checksum: "7f7187fa6d9b341ac5f22f6c5a970523afb439dc45566d64eb4f4b9b604d6b01", mark: "MM", color: "#e21680" }),
  custom: {
    ...textBrand("Local / Custom", "AI", "#8490a5", ""),
    iconPath: "/provider-icons/generic.svg",
    assetOrigin: "official",
    licenseNote: "应用自有通用图标，仅用于本地或自定义连接。",
  },
};

/** 获取厂商品牌描述。 */
export function getProviderBranding(provider: ApiProvider): ProviderBranding {
  return providerBranding[provider];
}
