/** MCP 设置与发现摘要类型。 */
export type {
  McpDiscoveryResult,
  McpServerProfile,
  McpToolDescriptor,
  McpToolPermission,
} from "./legacy-review.ts";

export type McpCatalogEntry = {
  id: string;
  title: string;
  description: string;
  version: string;
  endpoint?: string;
  repositoryUrl?: string;
  updatedAt?: string;
  source: "recommended" | "registry";
  authMode: "none" | "bearer";
  toolAllowlist?: string[];
  compatibility: "streamable-http" | "local-process-required";
  riskLabel: string;
};

export type McpRegistryPage = {
  entries: McpCatalogEntry[];
  nextCursor?: string;
};
