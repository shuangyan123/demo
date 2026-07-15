/** 个性化记忆的业务类型；数据仍保存在现有 personalization 单例中。 */
export type PersonalMemoryKind = "profile" | "preference" | "goal" | "study";
export type PersonalMemoryScope = "global" | "module" | "conversation";
export type PersonalMemorySource = "manual" | "auto" | "suggested";
export type PersonalMemoryStatus = "pending" | "active" | "archived";
export type PersonalMemorySensitivity = "normal" | "sensitive";

export type PersonalMemoryEntry = {
  id: string;
  kind: PersonalMemoryKind;
  scope: PersonalMemoryScope;
  title: string;
  content: string;
  source: PersonalMemorySource;
  status: PersonalMemoryStatus;
  canonicalKey?: string;
  confidence?: number;
  sensitivity?: PersonalMemorySensitivity;
  supersedesId?: string;
  sourceMessageIds?: string[];
  moduleId?: string;
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalMemorySettings = {
  /** v1 兼容字段；v2 UI 使用 autoMemoryEnabled。 */
  suggestionsEnabled: boolean;
  autoMemoryEnabled?: boolean;
  maxEntries: number;
  contextCharacterLimit: number;
};

/** 仅保存可撤销字段的修订记录，不复制完整对话或附件。 */
export type PersonalMemoryRevision = {
  id: string;
  memoryId: string;
  action: "add" | "update" | "archive" | "restore";
  previous?: Pick<PersonalMemoryEntry, "title" | "content" | "status">;
  createdAt: string;
};
