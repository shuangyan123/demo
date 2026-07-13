import type { ApiProvider } from "../types/review";

export type ConversationSpeedMode = "standard" | "priority";

/** 只把官方明确支持的会话速度映射为厂商参数，其他厂商保持标准请求。 */
export function speedProviderOptions(provider: ApiProvider, speedMode?: ConversationSpeedMode): Record<string, string> {
  if (speedMode !== "priority") return {};
  return provider === "openai" || provider === "google" ? { serviceTier: "priority" } : {};
}
