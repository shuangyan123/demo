const SEPARATOR = "\u0000";

/** 当前应用会话内的精确 Server / Tool grant；不写入 localStorage、IndexedDB 或 Vault。 */
const grants = new Set<string>();

function mcpSessionGrantKey(serverId: string, toolName: string): string {
  return `${serverId}${SEPARATOR}${toolName}`;
}

export function hasMcpSessionPermission(serverId: string, toolName: string): boolean {
  return grants.has(mcpSessionGrantKey(serverId, toolName));
}

export function grantMcpSessionPermission(serverId: string, toolName: string): void {
  grants.add(mcpSessionGrantKey(serverId, toolName));
}

export function revokeMcpSessionPermission(serverId: string, toolName: string): void {
  grants.delete(mcpSessionGrantKey(serverId, toolName));
}

export function clearMcpSessionPermissions(serverId: string): void {
  const prefix = `${serverId}${SEPARATOR}`;
  for (const grant of grants) {
    if (grant.startsWith(prefix)) grants.delete(grant);
  }
}

export function retainMcpSessionPermissions(serverId: string, toolNames: readonly string[]): void {
  const prefix = `${serverId}${SEPARATOR}`;
  for (const grant of grants) {
    if (grant.startsWith(prefix) && !toolNames.includes(grant.slice(prefix.length))) grants.delete(grant);
  }
}

/** 仅供 contract test 做确定性清理；生产业务不得调用。 */
export function clearAllMcpSessionPermissionsForTest(): void {
  grants.clear();
}
