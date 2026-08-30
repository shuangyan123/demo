import type { ApiProvider } from "../types/domains/ai-provider.ts";
import { getProviderContract } from "./provider-contracts.ts";

export type ProviderShortcut = { label: "官网" | "API Console" | "API 文档"; url: string };

/** 只允许代码内审计过的官方 HTTPS 入口；连接地址和模型响应不能生成外链。 */
const providerOfficialLinks: Partial<Record<ApiProvider, { website?: string; console?: string }>> = {
  openai: { website: "https://openai.com/", console: "https://platform.openai.com/" },
  google: { website: "https://ai.google.dev/", console: "https://aistudio.google.com/" },
  anthropic: { website: "https://www.anthropic.com/", console: "https://console.anthropic.com/" },
  xai: { website: "https://x.ai/", console: "https://console.x.ai/" },
  deepseek: { website: "https://www.deepseek.com/", console: "https://platform.deepseek.com/" },
  qwen: { website: "https://www.alibabacloud.com/product/model-studio", console: "https://bailian.console.aliyun.com/" },
  minimax: { website: "https://www.minimax.io/", console: "https://platform.minimax.io/" },
  zhipu: { website: "https://www.bigmodel.cn/", console: "https://open.bigmodel.cn/" },
};

export function getProviderShortcuts(provider: ApiProvider): ProviderShortcut[] {
  const official = providerOfficialLinks[provider];
  const documentationUrl = getProviderContract(provider).documentationUrl;
  return [
    ...(official?.website ? [{ label: "官网" as const, url: official.website }] : []),
    ...(official?.console ? [{ label: "API Console" as const, url: official.console }] : []),
    ...(documentationUrl ? [{ label: "API 文档" as const, url: documentationUrl }] : []),
  ];
}
