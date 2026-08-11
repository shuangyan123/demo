const SEPARATOR = "\u0000";

/** 当前应用会话内的精确 Server / Tool grant；不写入 localStorage、IndexedDB 或 Vault。 */
export const mcpSessionPermissionGrants = new Set<string>();

export function mcpSessionGrantKey(serverId: string, toolName: string): string {
  return `${serverId}${SEPARATOR}${toolName}`;
}

export function clearMcpSessionPermissions(serverId: string): void {
  const prefix = `${serverId}${SEPARATOR}`;
  for (const grant of mcpSessionPermissionGrants) {
    if (grant.startsWith(prefix)) mcpSessionPermissionGrants.delete(grant);
  }
}

export function retainMcpSessionPermissions(serverId: string, toolNames: readonly string[]): void {
  const prefix = `${serverId}${SEPARATOR}`;
  for (const grant of mcpSessionPermissionGrants) {
    if (grant.startsWith(prefix) && !toolNames.includes(grant.slice(prefix.length))) mcpSessionPermissionGrants.delete(grant);
  }
}
