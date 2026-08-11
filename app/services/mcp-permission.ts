import type { McpToolPermission } from "../types/domains/mcp.ts";

export type McpExecutionMode = "interactive" | "scheduled";
export type McpPermissionDecision = "allowed" | "confirmation_required" | "denied";
export type McpPersistedToolPermission = Exclude<McpToolPermission, "allow_session">;

/** 每次真实 MCP 调用都必须明确声明调用模式与当前确认状态。 */
export type McpExecutionContext = {
  mode: McpExecutionMode;
  confirmed: boolean;
};

/** 旧快照中的 allow_session 不能在 reload 后恢复为授权，只能安全降级为 ask。 */
export function normalizeMcpPersistedPermission(value: unknown): McpPersistedToolPermission {
  if (value === "deny" || value === "allow_scheduled") return value;
  return "ask";
}

/**
 * MCP permission core 保持纯函数：不读取存储、凭据或网络，也不依赖 UI。
 * allow_session 由 sessionGrantPresent 表达，避免把持久化策略和会话状态混在一起。
 */
export function decideMcpToolPermission(input: {
  policy: McpPersistedToolPermission;
  sessionGrantPresent: boolean;
  mode: McpExecutionMode;
  confirmed: boolean;
}): McpPermissionDecision {
  if (input.policy === "deny") return "denied";

  if (input.mode === "scheduled") {
    return input.policy === "allow_scheduled" ? "allowed" : "denied";
  }

  if (input.sessionGrantPresent) return "allowed";
  return input.confirmed ? "allowed" : "confirmation_required";
}
