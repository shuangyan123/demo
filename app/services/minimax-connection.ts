/** MiniMax 开放平台的服务区域。 */
export type MiniMaxRegion = "cn" | "global";

/** MiniMax Key 的计费来源；两类 Key 不应由字符串格式自动推断。 */
export type MiniMaxCredentialPlan = "pay_as_you_go" | "token_plan";

export const MINIMAX_ANTHROPIC_BASE_URLS: Record<MiniMaxRegion, string> = {
  cn: "https://api.minimaxi.com/anthropic",
  global: "https://api.minimax.io/anthropic",
};

/** 根据官方域名识别区域；未知代理地址回退到显式选择。 */
export function inferMiniMaxRegion(baseUrl: string, fallback: MiniMaxRegion = "cn"): MiniMaxRegion {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "api.minimaxi.com") return "cn";
    if (host === "api.minimax.io") return "global";
  } catch {
    // 表单校验会负责提示无效 URL，此处只保持纯归一化函数稳定。
  }
  return fallback;
}

/**
 * 将域名、/v1、/anthropic/v1 或完整 messages 地址统一为 Anthropic 兼容根地址。
 * 官方域名始终以区域选择为准，避免国内 Key 被误发往国际站。
 */
export function normalizeMiniMaxAnthropicBaseUrl(baseUrl: string, region?: MiniMaxRegion): string {
  const fallbackRegion = region ?? inferMiniMaxRegion(baseUrl);
  const trimmed = baseUrl.trim();
  if (!trimmed) return MINIMAX_ANTHROPIC_BASE_URLS[fallbackRegion];
  try {
    const url = new URL(trimmed);
    if (url.hostname === "api.minimaxi.com" || url.hostname === "api.minimax.io") {
      return MINIMAX_ANTHROPIC_BASE_URLS[region ?? inferMiniMaxRegion(trimmed)];
    }
    const pathname = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/messages$/, "")
      .replace(/\/v1$/, "")
      .replace(/\/anthropic$/, "");
    return `${url.origin}${pathname}/anthropic`.replace(/\/+$/, "");
  } catch {
    return trimmed
      .replace(/\/+$/, "")
      .replace(/\/messages$/, "")
      .replace(/\/v1$/, "")
      .replace(/\/anthropic$/, "") + "/anthropic";
  }
}

/** MiniMax 直连 REST 请求统一使用官方 Bearer 鉴权。 */
export function miniMaxBearerHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

/** MiniMax Anthropic-compatible 模型目录按官方规范使用独立 X-Api-Key。 */
export function miniMaxModelDirectoryHeaders(apiKey: string): Record<string, string> {
  return { "X-Api-Key": apiKey };
}

/**
 * 将 MiniMax 常见 HTTP 状态归一为可行动提示，避免把区域、套餐和余额问题都误报为鉴权失败。
 */
export function miniMaxFailureMessage(
  status: number,
  stage: "directory" | "generate",
  region: MiniMaxRegion,
  credentialPlan: MiniMaxCredentialPlan = "pay_as_you_go",
): string {
  const regionLabel = region === "cn" ? "中国大陆站" : "国际站";
  const planLabel = credentialPlan === "token_plan" ? "Token Plan" : "按量付费";
  if (status === 401) return `MiniMax Key 无效，或 Key 与${regionLabel}不匹配`;
  if (status === 402) return `MiniMax ${planLabel}余额不足`;
  if (status === 403) return `MiniMax Key 缺少${stage === "directory" ? "模型目录" : "模型调用"}权限，或 Key 类型与${planLabel}不匹配`;
  if (status === 404) return stage === "directory"
    ? `MiniMax ${regionLabel}模型目录地址不可用`
    : "MiniMax-M3 未开通，或所选模型不存在";
  if (status === 429) return "MiniMax 请求已被限流，请稍后重试";
  if (status >= 500) return "MiniMax 服务暂时不可用，请稍后重试";
  return `MiniMax ${stage === "directory" ? "模型目录" : "模型请求"}失败（${status}）`;
}
