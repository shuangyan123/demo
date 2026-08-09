"use client";

import { useMemo, useState } from "react";
import { buildCanonicalConversationTurns, canonicalTurnsToChatHistory } from "../../services/canonical-conversation-context.ts";
import { buildConversationContextBudget } from "../../services/conversation-context-budget.ts";
import { buildConversationCompactionCandidate, requestConversationContextCompaction } from "../../services/conversation-context-compaction.ts";
import { conversationRepository } from "../../services/conversation-repository.ts";
import { buildPersonalMemoryContext } from "../../services/personal-memory-context.ts";
import type { ChatMessage } from "../../services/api-client.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { AiConversation, AiConversationAttachment, AiConversationMessage, AiConversationRunStep } from "../../types/domains/conversation.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import type { DraftAttachment } from "./conversation-attachment-utils.ts";

type AppendStep = (conversationId: string, runId: string, label: string, state: "pending" | "running" | "done" | "error", text?: string, visibility?: "timeline" | "diagnostic") => Promise<void>;

/** Composer 预算与真实压缩共用同一消息装配边界，避免 UI 估算和发送内容漂移。 */
export function useConversationContext(input: {
  activeConversation?: AiConversation | null;
  appendStep: AppendStep;
  attachments: DraftAttachment[];
  connection?: ApiConnectionProfile;
  contextWindow?: number;
  draft: string;
  knowledgeContext: string;
  launchContext?: { moduleLabel: string; summary: string } | null;
  messages: AiConversationMessage[];
  modelId?: string;
  personalization: PersonalizationSettings;
  persistedAttachments: AiConversationAttachment[];
  runSteps: AiConversationRunStep[];
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [compressing, setCompressing] = useState(false);
  const memoryContext = input.activeConversation
    ? buildPersonalMemoryContext(input.personalization, { moduleId: "conversation", conversationId: input.activeConversation.id, query: input.draft })
    : "";
  const contextMessages = useMemo<ChatMessage[]>(() => {
    const attachments = input.attachments.map((item) => `${item.file.name}：${item.summary}`).join("\n");
    const current = [
      input.launchContext ? `【${input.launchContext.moduleLabel}上下文】\n${input.launchContext.summary}` : "",
      input.knowledgeContext ? `【用户已选择的知识库摘要】\n${input.knowledgeContext}` : "",
      input.draft,
      attachments,
    ].filter(Boolean).join("\n\n");
    return [
      ...(memoryContext ? [{ role: "system" as const, content: memoryContext }] : []),
      ...canonicalTurnsToChatHistory(buildCanonicalConversationTurns({ conversation: input.activeConversation ?? undefined, messages: input.messages, attachments: input.persistedAttachments, runSteps: input.runSteps })),
      ...(current ? [{ role: "user" as const, content: current }] : []),
    ];
  }, [input.activeConversation, input.attachments, input.draft, input.knowledgeContext, input.launchContext, input.messages, input.persistedAttachments, input.runSteps, memoryContext]);
  const calibratedInputTokens = useMemo(() => [...input.messages].reverse().find((message) => {
    const usage = message.usage;
    return Boolean(usage && usage.connectionId === input.connection?.id && usage.model === input.modelId && usage.inputTokens);
  })?.usage?.inputTokens, [input.connection?.id, input.messages, input.modelId]);
  const budget = useMemo(() => buildConversationContextBudget({ messages: contextMessages, contextWindow: input.contextWindow, outputReserveTokens: 1_200, calibratedInputTokens }), [calibratedInputTokens, contextMessages, input.contextWindow]);
  const candidate = useMemo(() => input.activeConversation ? buildConversationCompactionCandidate({ conversation: input.activeConversation, messages: input.messages, attachments: input.persistedAttachments, runSteps: input.runSteps }) : undefined, [input.activeConversation, input.messages, input.persistedAttachments, input.runSteps]);

  async function compress() {
    if (!input.activeConversation || !input.connection || !input.modelId || !candidate || compressing) return;
    const runId = crypto.randomUUID();
    setCompressing(true);
    try {
      await input.appendStep(input.activeConversation.id, runId, "准备压缩上下文", "done", `将压缩 ${candidate.sourceMessageCount} 条旧消息`);
      await input.appendStep(input.activeConversation.id, runId, "压缩上下文", "running", `${input.connection.label} / ${input.modelId}`);
      const compacted = await requestConversationContextCompaction({ candidate, connection: input.connection, conversation: input.activeConversation, modelId: input.modelId });
      await conversationRepository.setConversationContextCompaction(input.activeConversation.id, compacted);
      await input.appendStep(input.activeConversation.id, runId, "保存压缩摘要", "done", `${compacted.estimatedTokensBefore} → ${compacted.estimatedTokensAfter} tokens`);
      await input.onRefresh();
      input.onNotice(`上下文已压缩；最近 6 轮保留原文，预计节省 ${Math.max(0, compacted.estimatedTokensBefore - compacted.estimatedTokensAfter)} tokens`);
    } catch (error) {
      await input.appendStep(input.activeConversation.id, runId, "压缩上下文失败", "error", error instanceof Error ? error.message : "压缩失败");
      await input.onRefresh();
      input.onNotice(error instanceof Error ? error.message : "上下文压缩失败");
    } finally {
      setCompressing(false);
    }
  }

  return { budget, candidate, compress, compressing };
}
