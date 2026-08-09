import packageJson from "../../package.json" with { type: "json" };

export type LocalDataClass = "authoritative" | "configuration" | "credential-security" | "derived" | "ephemeral" | "external-user-owned";
export type LocalDataRecoveryLevel = "R0" | "R1" | "R2" | "R3" | "R4";
export type LocalDataBackupDisposition = "included" | "excluded";

export type LocalDataStorePolicy = {
  backup: LocalDataBackupDisposition;
  dataClass: LocalDataClass;
  reason: string;
  recoveryLevel: LocalDataRecoveryLevel;
};

const authoritative = (reason: string): LocalDataStorePolicy => ({ backup: "included", dataClass: "authoritative", reason, recoveryLevel: "R3" });
const configuration = (reason: string): LocalDataStorePolicy => ({ backup: "included", dataClass: "configuration", reason, recoveryLevel: "R3" });

/**
 * review_workspace v16 的每个真实表都必须在此显式归类。导出允许列表由本表派生，
 * 契约测试再与 Dexie 运行时 schema 对照，避免新增业务表被静默漏掉。
 */
export const CORE_DATA_STORE_POLICIES = {
  mistakes: authoritative("用户错题事实"),
  attempts: authoritative("错题复盘历史"),
  importJobs: authoritative("导入审计记录"),
  apiSettings: { backup: "excluded", dataClass: "credential-security", reason: "旧连接兼容表包含密文，只保留本机迁移读取", recoveryLevel: "R2" },
  apiConnectionProfiles: configuration("导出时仅保留脱敏连接元数据，凭据必须重新配置"),
  apiConnectionDefaults: configuration("默认能力选择"),
  appearanceSettings: configuration("用户外观设置"),
  personalizationSettings: configuration("角色、记忆与个性化设置"),
  knowledgeEntries: authoritative("用户知识资料"),
  knowledgeAttempts: authoritative("知识训练历史"),
  knowledgeMistakeLinks: authoritative("知识与错题关联"),
  knowledgeInternalizationDrafts: authoritative("待确认知识内化草稿"),
  importBatches: authoritative("导入批次"),
  importDrafts: authoritative("未确认导入草稿"),
  interviewQuestions: authoritative("面试题库"),
  interviewQuestionSets: authoritative("面试题组"),
  interviewPracticePlans: authoritative("面试训练计划"),
  interviewSessions: authoritative("面试会话"),
  interviewTurns: authoritative("面试回合"),
  interviewEvaluations: authoritative("面试评分"),
  interviewLinks: authoritative("面试与学习资料关联"),
  tutoringSessions: authoritative("辅导会话"),
  tutoringTurns: authoritative("辅导回合"),
  tutoringPlans: authoritative("辅导复练计划"),
  tutoringLinks: authoritative("辅导与学习资料关联"),
  obsidianVaultConfigs: { backup: "excluded", dataClass: "external-user-owned", reason: "包含宿主目录授权；恢复后必须重新选择或授权 Vault", recoveryLevel: "R4" },
  obsidianNoteMappings: authoritative("仅备份应用侧映射与三方哈希，不包含 Vault 正文"),
  knowledgeEvolutionProposals: authoritative("待确认知识演进提案与有限证据"),
  automationDefinitions: configuration("用户已安排定义与授权范围"),
  automationRuns: authoritative("已安排运行收件箱与审计摘要"),
  aiProjects: authoritative("对话项目"),
  aiConversationFolders: authoritative("对话目录"),
  aiConversations: authoritative("对话元数据与可见摘要"),
  aiConversationAttachments: authoritative("附件元数据与可见摘要，不含原始字节"),
  aiConversationMessages: authoritative("用户可见对话消息"),
  aiConversationRunSteps: authoritative("脱敏工具步骤与运行摘要"),
} satisfies Record<string, LocalDataStorePolicy>;

export const CORE_BACKUP_TABLE_NAMES = Object.entries(CORE_DATA_STORE_POLICIES)
  .filter(([, policy]) => policy.backup === "included")
  .map(([table]) => table);

export const LOCAL_STORAGE_DATA_POLICIES = [
  { pattern: "review-workspace:ai-quota-plugin-configs", backup: "excluded", dataClass: "credential-security", recoveryLevel: "R2", reason: "包含加密额度凭据；恢复后重新配置" },
  { pattern: "review-workspace:mcp-settings:v1|v2", backup: "excluded", dataClass: "credential-security", recoveryLevel: "R2", reason: "包含加密 Bearer；恢复后重新配置" },
  { pattern: "review-workspace:fenbi-import-credential", backup: "excluded", dataClass: "credential-security", recoveryLevel: "R2", reason: "包含加密 Cookie；恢复后重新配置" },
  { pattern: "review_workspace_crypto_key_v1", backup: "excluded", dataClass: "credential-security", recoveryLevel: "R2", reason: "旧可导出主密钥只用于安全迁移" },
  { pattern: "review-workspace:ai-quota-snapshots", backup: "excluded", dataClass: "derived", recoveryLevel: "R1", reason: "可重新读取的额度快照" },
  { pattern: "review_provider_models_v4:*", backup: "excluded", dataClass: "derived", recoveryLevel: "R1", reason: "可重新发现的模型目录缓存" },
  { pattern: "review_connection_test_model_v1:*", backup: "excluded", dataClass: "configuration", recoveryLevel: "R2", reason: "连接测试偏好，不影响业务恢复" },
  { pattern: "review-workspace:sidebar:v1", backup: "excluded", dataClass: "configuration", recoveryLevel: "R2", reason: "可重新设置的界面偏好" },
  { pattern: "review_settings_plugins_v1", backup: "excluded", dataClass: "configuration", recoveryLevel: "R2", reason: "可重新设置的内置插件启停偏好" },
  { pattern: "review-workspace:ui-review-*", backup: "excluded", dataClass: "ephemeral", recoveryLevel: "R0", reason: "开发审查运行状态，不属于生产用户资产" },
] as const satisfies readonly (LocalDataStorePolicy & { pattern: string })[];

export const NON_CORE_DATA_STORE_POLICIES = {
  "review_extensions.extensions": { backup: "included", dataClass: "configuration", recoveryLevel: "R3", reason: "已安装声明式扩展记录与受控资产" },
  "review_workspace_secure_keys.keys": { backup: "excluded", dataClass: "credential-security", recoveryLevel: "R2", reason: "不可导出 AES-GCM 主密钥" },
  "review_workspace_transfer.jobs": { backup: "excluded", dataClass: "ephemeral", recoveryLevel: "R0", reason: "仅用于完成提交或回滚的恢复暂存" },
  "versioned-localStorage": { backup: "excluded", dataClass: "configuration", recoveryLevel: "R2", reason: "当前 V2 不导出 localStorage；各键按上方策略重新配置或重建" },
  "obsidian-vault.files": { backup: "excluded", dataClass: "external-user-owned", recoveryLevel: "R4", reason: "Vault 正文由用户外部拥有，只能重新授权并对账" },
  "runtime.media-and-provider-events": { backup: "excluded", dataClass: "ephemeral", recoveryLevel: "R0", reason: "原始媒体与厂商事件只驻留当前运行内存" },
} as const satisfies Record<string, LocalDataStorePolicy>;

export const LOCAL_DATA_SCHEMA_VERSIONS = { review_extensions: 1, review_workspace: 16 } as const;
export const LOCAL_DATA_IMPORT_MAX_RECORDS = 1_000_000;
export const LOCAL_DATA_IMPORT_MAX_STORE_RECORDS = 250_000;

export type LocalDataExportManifestV2 = {
  app: { name: "review-workspace"; version: string };
  excludedCategories: Array<"credentials" | "master-keys" | "provider-raw-events" | "runtime-media" | "vault-content" | "vault-handles" | "versioned-local-storage">;
  includedStores: {
    review_extensions: ["extensions"];
    review_workspace: string[];
  };
  recordCounts: {
    review_extensions: { extensions: number };
    review_workspace: Record<string, number>;
    total: number;
  };
  schemaVersions: typeof LOCAL_DATA_SCHEMA_VERSIONS;
};

export function createLocalDataExportManifest(core: Record<string, unknown[]>, extensionCount: number): LocalDataExportManifestV2 {
  const coreCounts = Object.fromEntries(Object.entries(core).map(([table, records]) => [table, records.length]));
  return {
    app: { name: "review-workspace", version: packageJson.version },
    excludedCategories: ["credentials", "master-keys", "provider-raw-events", "runtime-media", "vault-content", "vault-handles", "versioned-local-storage"],
    includedStores: { review_extensions: ["extensions"], review_workspace: [...CORE_BACKUP_TABLE_NAMES] },
    recordCounts: {
      review_extensions: { extensions: extensionCount },
      review_workspace: coreCounts,
      total: Object.values(coreCounts).reduce((sum, count) => sum + count, extensionCount),
    },
    schemaVersions: LOCAL_DATA_SCHEMA_VERSIONS,
  };
}

export type LocalDataIntegrityIssue = {
  code: "dangling-reference" | "duplicate-primary-key" | "invalid-primary-key" | "invalid-record" | "invalid-reference";
  message: string;
  recordId?: string;
  table: string;
};

type ReferenceRule = {
  childTable: string;
  field: string;
  parentTable: string;
  optional?: boolean;
};

export const CRITICAL_REFERENCE_RULES: readonly ReferenceRule[] = [
  { childTable: "attempts", field: "mistakeId", parentTable: "mistakes" },
  { childTable: "knowledgeAttempts", field: "knowledgeId", parentTable: "knowledgeEntries" },
  { childTable: "knowledgeMistakeLinks", field: "mistakeId", parentTable: "mistakes" },
  { childTable: "knowledgeMistakeLinks", field: "knowledgeId", parentTable: "knowledgeEntries" },
  { childTable: "importDrafts", field: "batchId", parentTable: "importBatches" },
  { childTable: "interviewTurns", field: "sessionId", parentTable: "interviewSessions" },
  { childTable: "interviewEvaluations", field: "sessionId", parentTable: "interviewSessions" },
  { childTable: "tutoringTurns", field: "sessionId", parentTable: "tutoringSessions" },
  { childTable: "automationRuns", field: "automationId", parentTable: "automationDefinitions" },
  { childTable: "aiConversationFolders", field: "projectId", parentTable: "aiProjects" },
  { childTable: "aiConversationFolders", field: "parentId", parentTable: "aiConversationFolders", optional: true },
  { childTable: "aiConversations", field: "projectId", parentTable: "aiProjects" },
  { childTable: "aiConversations", field: "folderId", parentTable: "aiConversationFolders", optional: true },
  { childTable: "aiConversationMessages", field: "conversationId", parentTable: "aiConversations" },
  { childTable: "aiConversationAttachments", field: "conversationId", parentTable: "aiConversations" },
  { childTable: "aiConversationAttachments", field: "messageId", parentTable: "aiConversationMessages", optional: true },
  { childTable: "aiConversationRunSteps", field: "conversationId", parentTable: "aiConversations" },
] as const;

function primaryKeyFor(table: string, record: Record<string, unknown>): string | undefined {
  return table === "obsidianNoteMappings"
    ? typeof record.path === "string" && record.path ? record.path : undefined
    : typeof record.id === "string" && record.id ? record.id : undefined;
}

/** 返回全部关键完整性问题，供恢复 preflight 与只读 Health Check 共用。 */
export function inspectLocalDataIntegrity(core: Record<string, unknown[]>): LocalDataIntegrityIssue[] {
  const issues: LocalDataIntegrityIssue[] = [];
  for (const [table, records] of Object.entries(core)) {
    const keys = new Set<string>();
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        issues.push({ code: "invalid-record", message: `表 ${table} 含无效记录`, table });
        continue;
      }
      const item = record as Record<string, unknown>;
      const key = primaryKeyFor(table, item);
      if (!key) {
        issues.push({ code: "invalid-primary-key", message: `表 ${table} 含缺少唯一 ID 的记录`, table });
        continue;
      }
      if (keys.has(key)) issues.push({ code: "duplicate-primary-key", message: `表 ${table} 含重复 ID：${key}`, recordId: key, table });
      keys.add(key);
    }
  }

  for (const rule of CRITICAL_REFERENCE_RULES) {
    const parents = new Set((core[rule.parentTable] ?? []).flatMap((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return [];
      const key = primaryKeyFor(rule.parentTable, record as Record<string, unknown>);
      return key ? [key] : [];
    }));
    for (const record of core[rule.childTable] ?? []) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const item = record as Record<string, unknown>;
      const recordId = primaryKeyFor(rule.childTable, item);
      const reference = item[rule.field];
      if (rule.optional && (reference === undefined || reference === null || reference === "")) continue;
      if (typeof reference !== "string" || !reference) {
        issues.push({ code: "invalid-reference", message: `表 ${rule.childTable} 的 ${rule.field} 不是有效引用`, recordId, table: rule.childTable });
      } else if (!parents.has(reference)) {
        issues.push({ code: "dangling-reference", message: `表 ${rule.childTable} 含悬空关联：${rule.field}=${reference}`, recordId, table: rule.childTable });
      }
    }
  }
  return issues;
}

const SENSITIVE_FIELD = /^(?:accessToken|apiKey|authorization|conflictAppMarkdown|conflictVaultMarkdown|cookie|directoryHandle|encryptedCookie|encryptedCredentials|encryptedKey|encryptedToken|encryptedTokenIv|fullPrompt|hiddenReasoning|iv|maskedKey|password|privateKey|providerRawResponse|rawProviderResponse|refreshToken|thoughtSignature|token)$/i;

/** 恢复包不得仅凭 credentialsExcluded 声明获得信任。 */
export function findSensitiveRestoreFields(value: unknown, path = "$", matches: string[] = []): string[] {
  if (matches.length >= 10 || !value || typeof value !== "object") return matches;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length && matches.length < 10; index += 1) findSensitiveRestoreFields(value[index], `${path}[${index}]`, matches);
    return matches;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (SENSITIVE_FIELD.test(key)) matches.push(nextPath);
    else findSensitiveRestoreFields(item, nextPath, matches);
    if (matches.length >= 10) break;
  }
  return matches;
}
