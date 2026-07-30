/** Obsidian 同步与知识演进领域类型。 */
export type {
  KnowledgeEvolutionGenerationDiagnostic,
  KnowledgeEvolutionGenerationResult,
  KnowledgeEvolutionMode,
  KnowledgeEvolutionProposal,
  KnowledgeEvolutionSourceType,
  KnowledgeEvolutionStatus,
  ObsidianConnectionRecovery,
  ObsidianGraphEdge,
  ObsidianGraphNode,
  ObsidianGraphSnapshot,
  ObsidianNoteMapping,
  ObsidianPermissionState,
  ObsidianSyncReport,
  ObsidianSyncStatus,
  ObsidianVaultConfig,
  ObsidianVaultSnapshot,
} from "./legacy-review.ts";

/** 应用级 Obsidian 监听运行时只暴露可序列化状态，不暴露目录句柄或文件路径。 */
export type ObsidianSyncRuntimeStatus =
  | "paused"
  | "watching"
  | "syncing"
  | "needs-permission"
  | "conflict"
  | "error";

export type ObsidianSyncRuntimeSnapshot = {
  status: ObsidianSyncRuntimeStatus;
  mode: "observer" | "polling" | "none";
  revision: number;
  lastSyncedAt?: string;
  errorMessage?: string;
};
