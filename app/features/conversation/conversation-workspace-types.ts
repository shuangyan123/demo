import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { AiConversation } from "../../types/domains/conversation.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import type { ConversationSnapshot } from "../../services/conversation-repository";
import type { ConversationLaunchContext } from "./conversation-launch-context.ts";

/** 对话工作台只接收运行编排所需的稳定输入，具体面板状态留在子组件。 */
export type ConversationWorkspaceProps = {
  activeConversationId?: string | null;
  connections: ApiConnectionProfile[];
  defaultSelections?: { text?: { connectionId?: string; modelId?: string }; vision?: { connectionId?: string; modelId?: string } };
  knowledgeEntries: KnowledgeEntry[];
  launchContext?: ConversationLaunchContext | null;
  personalization: PersonalizationSettings;
  scheduledCount: number;
  snapshot: ConversationSnapshot;
  transcriptionConnection?: ApiConnectionProfile;
  onCreateConversation: (input?: { selectedConnectionId?: string; selectedModelId?: string; selectedRuntimeValues?: AiSelectedRuntimeValues }) => Promise<AiConversation>;
  onConversationSelected: (id: string) => void;
  onOpenConnections: () => void;
  onOpenKnowledge: () => void;
  onOpenTutoringRecords: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onPersonalizationChange?: (settings: PersonalizationSettings) => void;
  onClearLaunchContext: () => void;
};
