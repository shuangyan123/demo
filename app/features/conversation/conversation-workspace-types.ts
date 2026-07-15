import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { AiConversation, ApiConnectionProfile, KnowledgeEntry, PersonalizationSettings } from "../../types/review";
import type { ConversationSnapshot } from "../../services/conversation-repository";
import type { ConversationLaunchContext } from "./conversation-launch-context";

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
