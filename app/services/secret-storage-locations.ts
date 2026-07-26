/** 共享密文存储位置，供仓储与一次性安全迁移使用，避免复制魔法字符串。 */
export const secretStorageLocations = {
  quotaConfigs: "review-workspace:ai-quota-plugin-configs",
  mcpSettings: "review-workspace:mcp-settings:v2",
  legacyMcpSettings: "review-workspace:mcp-settings:v1",
  fenbiCredential: "review-workspace:fenbi-import-credential",
} as const;
