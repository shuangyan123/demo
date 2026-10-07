import { CORE_DATA_STORE_POLICIES, LOCAL_STORAGE_DATA_POLICIES, NON_CORE_DATA_STORE_POLICIES, type LocalDataStorePolicy } from "./local-data-reliability.ts";

export type StorageDomainPolicy = Readonly<{
  domainId: string;
  owner: string;
  storageClass: "managed-durable" | "bootstrap" | "protected-security" | "external" | "ephemeral" | "diagnostics";
  rootType: "chromium-profile" | "managed-files" | "os-bootstrap" | "external" | "os-protected" | "runtime" | "runtime-resources" | "os-logs";
  physicalUnit: string;
  implementation: "current" | "reserved";
  backup: Readonly<{ current: "included" | "sanitized" | "excluded" | "not-implemented"; relevant: boolean }>;
  reset: Readonly<{ current: "covered" | "not-covered" | "not-implemented"; relevant: boolean }>;
  migration: Readonly<{ policy: "profile-unit" | "protected-profile-unit" | "managed-files" | "reference-only" | "excluded" | "block-unresolved"; relevant: boolean }>;
  sensitivity: "user-data" | "protected" | "public";
  regenerable: boolean;
}>;

// 这里只补 logical ownership；backup authority 继续来自既有 policies，不复制第二份白名单。
const coreOwners = {
  mistakes: "review", attempts: "review", importJobs: "import", apiSettings: "ai-config",
  apiConnectionProfiles: "ai-config", apiConnectionDefaults: "ai-config", appearanceSettings: "appearance",
  personalizationSettings: "personalization", knowledgeEntries: "knowledge", knowledgeAttempts: "knowledge",
  knowledgeMistakeLinks: "knowledge", knowledgeInternalizationDrafts: "knowledge", importBatches: "import", importDrafts: "import",
  interviewQuestions: "interview", interviewQuestionSets: "interview", interviewPracticePlans: "interview",
  interviewSessions: "interview", interviewTurns: "interview", interviewEvaluations: "interview", interviewLinks: "interview",
  tutoringSessions: "tutoring", tutoringTurns: "tutoring", tutoringPlans: "tutoring", tutoringLinks: "tutoring",
  obsidianVaultConfigs: "vault-app-state", obsidianNoteMappings: "vault-app-state", knowledgeEvolutionProposals: "knowledge",
  automationDefinitions: "automation", automationRuns: "automation", aiProjects: "conversation", aiConversationFolders: "conversation",
  aiConversations: "conversation", aiConversationAttachments: "conversation", aiConversationMessages: "conversation", aiConversationRunSteps: "conversation",
} satisfies Record<keyof typeof CORE_DATA_STORE_POLICIES, string>;

const localStorageOwners = {
  "review-workspace:desktop-credentials:v1": "credential-envelopes",
  "review-workspace:credential-migration:v1": "credential-migration",
  "review-workspace:credential-cleanup:v1": "credential-cleanup",
  "review-workspace:ai-quota-plugin-configs": "quota-credentials",
  "review-workspace:mcp-settings:v1|v2": "mcp-credentials",
  "review-workspace:fenbi-import-credential": "fenbi-credentials",
  "review_workspace_crypto_key_v1": "legacy-secure-key",
  "review-workspace:ai-quota-snapshots": "quota-snapshots",
  "review_provider_models_v4:*": "provider-model-cache",
  "review_connection_test_model_v1:*": "ai-config",
  "review-workspace:sidebar:v1": "appearance",
  "review-workspace:study-module-preferences:v1": "study-module-preferences",
  "review_settings_plugins_v1": "extension-preferences",
  "review-workspace:ui-review-*": "ui-review-runtime",
} satisfies Record<(typeof LOCAL_STORAGE_DATA_POLICIES)[number]["pattern"], string>;

type Metadata = Pick<StorageDomainPolicy, "owner" | "rootType" | "physicalUnit"> & Partial<Pick<StorageDomainPolicy,
  "storageClass" | "regenerable" | "implementation" | "sensitivity">> & { resetCovered?: boolean; resetRelevant?: boolean;
    backupCurrent?: StorageDomainPolicy["backup"]["current"]; resetCurrent?: StorageDomainPolicy["reset"]["current"];
    migration?: StorageDomainPolicy["migration"]["policy"] };
const nonCoreMetadata = {
  "review_extensions.extensions": { owner: "extensions", rootType: "chromium-profile", physicalUnit: "chromium-profile", resetCovered: true },
  "review_workspace_secure_keys.keys": { owner: "secure-key", rootType: "chromium-profile", physicalUnit: "chromium-profile", resetCovered: true },
  "review_workspace_transfer.jobs": { owner: "restore-transfer", rootType: "chromium-profile", physicalUnit: "chromium-profile", resetRelevant: true, migration: "block-unresolved" },
  "versioned-localStorage": { owner: "local-storage", rootType: "chromium-profile", physicalUnit: "chromium-profile", resetCovered: true },
  "obsidian-vault.files": { owner: "user-vault", rootType: "external", physicalUnit: "external-vault", migration: "reference-only" },
  "runtime.media-and-provider-events": { owner: "runtime", rootType: "runtime", physicalUnit: "process-memory" },
  "storage.bootstrap": { owner: "host-storage", rootType: "os-bootstrap", physicalUnit: "os-bootstrap", storageClass: "bootstrap", resetRelevant: true, migration: "excluded" },
  "storage.profile-identity": { owner: "host-storage", rootType: "chromium-profile", physicalUnit: "chromium-profile", storageClass: "bootstrap", resetRelevant: true, migration: "profile-unit" },
  "desktop.vault-reference": { owner: "vault-app-state", rootType: "chromium-profile", physicalUnit: "chromium-profile", migration: "reference-only" },
  "external.user-files": { owner: "user-files", rootType: "external", physicalUnit: "external-files", migration: "excluded" },
  "host.os-secrets": { owner: "os-credential-protection", rootType: "os-protected", physicalUnit: "os-protection", migration: "excluded" },
  "chromium.cache": { owner: "chromium", rootType: "chromium-profile", physicalUnit: "chromium-profile", regenerable: true, migration: "excluded" },
  "workspace.session": { owner: "workspace-session", rootType: "chromium-profile", physicalUnit: "chromium-profile" },
  "fenbi.session": { owner: "fenbi-session", rootType: "chromium-profile", physicalUnit: "chromium-profile" },
  "next.cache": { owner: "next-runtime", rootType: "runtime-resources", physicalUnit: "installed-runtime", regenerable: true },
  "runtime.temporary-state": { owner: "runtime", rootType: "runtime", physicalUnit: "process-memory", regenerable: false },
  "desktop.runtime-log": { owner: "desktop-runtime", rootType: "os-logs", physicalUnit: "desktop-logs", storageClass: "diagnostics" },
  "runtime.diagnostic-state": { owner: "runtime-diagnostics", rootType: "os-logs", physicalUnit: "desktop-logs", storageClass: "diagnostics" },
  "diagnostic-history": { owner: "first-party-diagnostic", rootType: "managed-files", physicalUnit: "managed-files", implementation: "current",
    backupCurrent: "not-implemented", resetCurrent: "not-implemented", migration: "managed-files" },
} satisfies Record<keyof typeof NON_CORE_DATA_STORE_POLICIES, Metadata>;

function domain(domainId: string, policy: LocalDataStorePolicy, metadata: Metadata): StorageDomainPolicy {
  const storageClass = metadata.storageClass ?? (policy.dataClass === "credential-security" ? "protected-security"
    : policy.dataClass === "external-user-owned" && metadata.rootType === "external" ? "external"
      : ["ephemeral", "derived"].includes(policy.dataClass) ? "ephemeral" : "managed-durable");
  const reserved = metadata.implementation === "reserved";
  const backupRelevant = storageClass === "managed-durable";
  const resetRelevant = metadata.resetRelevant ?? (Boolean(metadata.resetCovered) || storageClass === "managed-durable"
    || (storageClass === "protected-security" && metadata.rootType === "chromium-profile"));
  const migration = metadata.migration ?? (metadata.rootType === "chromium-profile"
    ? storageClass === "protected-security" ? "protected-profile-unit" : storageClass === "ephemeral" ? "excluded" : "profile-unit" : "excluded");
  return Object.freeze({ domainId, owner: metadata.owner, storageClass, rootType: metadata.rootType, physicalUnit: metadata.physicalUnit,
    implementation: metadata.implementation ?? "current",
    backup: Object.freeze({ current: metadata.backupCurrent ?? (reserved ? "not-implemented" : policy.backup === "included" ? "sanitized" : "excluded"), relevant: backupRelevant }),
    reset: Object.freeze({ current: metadata.resetCurrent ?? (reserved ? "not-implemented" : metadata.resetCovered ? "covered" : "not-covered"), relevant: resetRelevant }),
    migration: Object.freeze({ policy: migration, relevant: migration !== "excluded" }),
    // ephemeral 只描述 lifetime，不证明 public；cache、额度与原始 runtime 事件仍可能含私有数据。
    sensitivity: metadata.sensitivity ?? (storageClass === "protected-security" ? "protected" : "user-data"),
    regenerable: metadata.regenerable ?? policy.dataClass === "derived",
  });
}

/** 现有三组 policy 的投影；logical domains 共享 physicalUnit 时不能分别搬动 Chromium 文件。 */
export const STORAGE_DOMAIN_REGISTRY: readonly StorageDomainPolicy[] = Object.freeze([
  ...Object.entries(CORE_DATA_STORE_POLICIES).map(([table, policy]) => domain(`review_workspace.${table}`, policy,
    { owner: coreOwners[table as keyof typeof coreOwners], rootType: "chromium-profile", physicalUnit: "chromium-profile", resetCovered: true,
      ...(table === "apiConnectionProfiles" ? { sensitivity: "protected", migration: "protected-profile-unit" } as const : {}),
      ...(table === "obsidianVaultConfigs" ? { sensitivity: "protected", migration: "reference-only" } as const : {}),
    })),
  ...LOCAL_STORAGE_DATA_POLICIES.map((policy) => domain(`localStorage:${policy.pattern}`, policy,
    { owner: localStorageOwners[policy.pattern], rootType: "chromium-profile", physicalUnit: "chromium-profile", resetCovered: true })),
  ...Object.entries(NON_CORE_DATA_STORE_POLICIES).map(([id, policy]) => domain(id, policy, nonCoreMetadata[id as keyof typeof nonCoreMetadata])),
]);
