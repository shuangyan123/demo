/** 为每类本机凭据生成稳定 AAD，防止密文被复制到其他记录后继续解密。 */
export const secretContext = {
  aiConnection: (connectionId: string) => `ai-connection:${connectionId}:api-key`,
  legacyAiSetting: () => "ai-connection:legacy-default:api-key",
  quotaCredential: (configId: string, credentialKey: string) => `quota:${configId}:${credentialKey}`,
  quotaLegacyCredential: (configId: string) => `quota:${configId}:legacy`,
  mcpToken: (profileId: string) => `mcp:${profileId}:bearer-token`,
  fenbiCookie: () => "fenbi:default:cookie",
} as const;
