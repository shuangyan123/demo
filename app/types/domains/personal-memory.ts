/** 个性化记忆的业务类型；数据仍保存在现有 personalization 单例中。 */
export type PersonalMemoryKind = "profile" | "preference" | "goal" | "study";
export type PersonalMemoryScope = "global" | "module" | "conversation";
export type PersonalMemorySource = "manual" | "suggested";
export type PersonalMemoryStatus = "pending" | "active" | "archived";

export type PersonalMemoryEntry = {
  id: string;
  kind: PersonalMemoryKind;
  scope: PersonalMemoryScope;
  title: string;
  content: string;
  source: PersonalMemorySource;
  status: PersonalMemoryStatus;
  moduleId?: string;
  sourceConversationId?: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalMemorySettings = {
  suggestionsEnabled: boolean;
  maxEntries: number;
  contextCharacterLimit: number;
};
