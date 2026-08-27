import type { McpToolPermission } from "../types/domains/mcp.ts";

export type McpExecutionMode = "interactive" | "scheduled";
export type McpPermissionDecision = "allowed" | "confirmation_required" | "denied";
export type McpPersistedToolPermission = Exclude<McpToolPermission, "allow_session">;

export type McpPermissionSummaryInput = {
  profiles: readonly unknown[];
  discovery: Readonly<Record<string, {
    toolDescriptors?: ReadonlyArray<{ permission: McpToolPermission }>;
  }>>;
};

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

const MCP_PERMISSION_LABELS: Record<McpToolPermission, string> = {
  ask: "每次询问",
  allow_session: "本次会话允许",
  allow_scheduled: "允许已安排任务",
  deny: "禁止",
};

/** 将当前 MCP 工具策略压缩为 Composer 可读的真实状态，不创建新的授权级别。 */
export function summarizeMcpPermission(input: McpPermissionSummaryInput): string {
  const permissions = Object.values(input.discovery)
    .flatMap((discovery) => discovery.toolDescriptors ?? [])
    .map((tool) => tool.permission);
  if (!permissions.length) return input.profiles.length ? "未发现工具" : "未配置";
  const distinct = new Set(permissions);
  return distinct.size === 1 ? MCP_PERMISSION_LABELS[permissions[0]!] : "按工具设置";
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
