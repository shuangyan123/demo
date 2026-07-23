import type { AiConversationKind, AiConversationSourceType } from "../../types/domains/conversation.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";

/** 从业务模块交给新对话的临时上下文；只驻留内存，不写入 IndexedDB。 */
export type ConversationLaunchContext = {
  id: string;
  moduleId: ViewKey;
  moduleLabel: string;
  kind: AiConversationKind;
  sourceType: AiConversationSourceType;
  sourceId: string;
  title: string;
  summary: string;
  suggestedPrompt: string;
};
