import { decideMcpToolPermission, normalizeMcpPersistedPermission, type McpExecutionContext } from "./mcp-permission.ts";
import { hasMcpSessionPermission } from "./mcp-session-permission-store.ts";
import type { McpServerProfile } from "../types/domains/mcp.ts";
import type { McpSettingsSnapshot } from "./mcp-settings-repository.ts";
import { isUiReviewRecordId } from "./workspace-data-scope.ts";
import { isUiReviewRuntimeActive } from "./ui-review-runtime-guard.ts";

type McpExecutionDependencies = {
  readSnapshot: () => McpSettingsSnapshot;
  tokenFor: (profile: McpServerProfile) => Promise<string>;
  requestJson: (path: string, payload: Record<string, unknown>) => Promise<{ result: unknown }>;
};

function permissionError(context: McpExecutionContext, decision: "confirmation_required" | "denied"): Error {
  if (context.mode === "scheduled") return new Error("MCP 工具未获得定时任务授权");
  if (decision === "confirmation_required") return new Error("MCP 工具需要本次用户确认");
  return new Error("MCP 工具已被禁止");
}

/** 真实 MCP 调用的最终边界；只在调用发生时加载，且拒绝先于凭据和网络。 */
export async function executeMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  context: McpExecutionContext,
  dependencies: McpExecutionDependencies,
): Promise<unknown> {
  if (isUiReviewRuntimeActive() || isUiReviewRecordId(serverId)) throw new Error("UI 审查 MCP 不允许调用外部工具。");

  const snapshot = dependencies.readSnapshot();
  const profile = snapshot.profiles.find((item) => item.id === serverId);
  if (!profile?.enabled) throw new Error("MCP Server 未启用，已阻止工具调用");
  const discovery = snapshot.discovery[serverId];
  if (discovery?.status !== "ready") throw new Error("MCP Server 尚未通过连接发现");
  const tool = discovery.toolDescriptors?.find((item) => item.name === toolName);
  if (!tool) throw new Error("MCP 工具不存在或已从 Server 移除");

  const decision = decideMcpToolPermission({
    policy: normalizeMcpPersistedPermission(tool.permission),
    sessionGrantPresent: hasMcpSessionPermission(serverId, toolName),
    mode: context.mode,
    confirmed: context.confirmed,
  });
  if (decision !== "allowed") throw permissionError(context, decision);

  const response = await dependencies.requestJson("/api/mcp/call", {
    endpoint: profile.endpoint,
    token: await dependencies.tokenFor(profile),
    allowPrivateNetwork: profile.allowPrivateNetwork === true,
    tool: toolName,
    arguments: args,
  });
  return response.result;
}
