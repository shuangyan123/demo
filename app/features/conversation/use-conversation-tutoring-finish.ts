"use client";

import { useState } from "react";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { AiConversation } from "../../types/domains/conversation.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";

/** 对话内辅导的结束与摘要状态独立管理，避免主对话编排继续膨胀。 */
export function useConversationTutoringFinish({
  connection,
  conversation,
  modelId,
  personalizationSettings,
  selectedRuntimeValues,
  onNotice,
}: {
  connection?: ApiConnectionProfile;
  conversation: AiConversation | null;
  modelId?: string;
  personalizationSettings: PersonalizationSettings;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  onNotice: (message: string) => void;
}) {
  const [finishing, setFinishing] = useState(false);

  async function finish() {
    if (!conversation || conversation.kind !== "tutoring" || !connection || !modelId) {
      onNotice("请先选择可用模型，再结束本轮辅导");
      return;
    }
    setFinishing(true);
    try {
      const { finishConversationTutorSession } = await import("./conversation-tutoring-runtime");
      await finishConversationTutorSession({
        connection,
        conversationId: conversation.id,
        modelId,
        personalizationSettings,
        selectedRuntimeValues,
      });
      onNotice("本轮辅导已结束，摘要和下一步已保存");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "辅导总结生成失败");
    } finally {
      setFinishing(false);
    }
  }

  return { finish, finishing };
}
