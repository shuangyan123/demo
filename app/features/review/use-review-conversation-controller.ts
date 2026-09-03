"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildCommandSearchResults } from "../../services/command-search";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository";
import type { AiConversation, CommandSearchResult } from "../../types/domains/conversation.ts";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { AutomationSnapshot } from "../../types/domains/automation.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import type { ConversationLaunchContext } from "../conversation/conversation-launch-context";
import { filterWorkspaceRecords, type WorkspaceDataScope } from "../../services/workspace-data-scope";

type UseReviewConversationControllerInput = {
  automationSnapshot: AutomationSnapshot;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  onNotice: (message: string) => void;
  onOpenApiSettings: (message: string) => void;
  onOpenMcpSettings: (message: string) => void;
  onSwitchView: (view: ViewKey) => void;
  today: Date;
  scope: WorkspaceDataScope;
};

const EMPTY_SNAPSHOT: ConversationSnapshot = { projects: [], partitions: [], folders: [], conversations: [], attachments: [], messages: [], runSteps: [] };

function scopeConversationSnapshot(snapshot: ConversationSnapshot, scope: WorkspaceDataScope): ConversationSnapshot {
  const partitions = filterWorkspaceRecords(snapshot.partitions, scope);
  return {
    projects: filterWorkspaceRecords(snapshot.projects, scope),
    partitions,
    folders: partitions,
    conversations: filterWorkspaceRecords(snapshot.conversations, scope),
    attachments: filterWorkspaceRecords(snapshot.attachments, scope),
    messages: filterWorkspaceRecords(snapshot.messages, scope),
    runSteps: filterWorkspaceRecords(snapshot.runSteps, scope),
  };
}

/** 管理主工作台的对话快照、命令搜索和全局快捷键。 */
export function useReviewConversationController(input: UseReviewConversationControllerInput) {
  const { automationSnapshot, knowledgeEntries, mistakes, onNotice, onOpenApiSettings, onOpenMcpSettings, onSwitchView, scope, today } = input;
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>(EMPTY_SNAPSHOT);
  const [activeConversationId, setActiveConversationId] = useState<string | null | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [launchContext, setLaunchContext] = useState<ConversationLaunchContext | null>(null);

  const refresh = useCallback(async () => {
    const nextSnapshot = scopeConversationSnapshot(await conversationRepository.loadSnapshot(today), scope);
    setSnapshot(nextSnapshot);
    setActiveConversationId((current) => current === null ? null : current ?? nextSnapshot.conversations.find((item) => item.status === "active")?.id);
  }, [scope, today]);

  useEffect(() => {
    let active = true;
    void conversationRepository.loadSnapshot(today).then((loadedSnapshot) => {
      if (!active) return;
      const nextSnapshot = scopeConversationSnapshot(loadedSnapshot, scope);
      setSnapshot(nextSnapshot);
      setActiveConversationId((current) => current === null ? null : current ?? nextSnapshot.conversations.find((item) => item.status === "active")?.id);
    }).catch((error: unknown) => {
      if (active) onNotice(error instanceof Error ? error.message : "对话读取失败");
    });
    return () => { active = false; };
  }, [onNotice, scope, today]);

  const results = useMemo(() => buildCommandSearchResults({ projects: snapshot.projects, conversations: snapshot.conversations, mistakes, knowledgeEntries, automationSnapshot }, searchQuery), [automationSnapshot, knowledgeEntries, mistakes, searchQuery, snapshot.conversations, snapshot.projects]);
  const openBlank = useCallback((context?: ConversationLaunchContext) => {
    setLaunchContext(context ?? null);
    setActiveConversationId(null);
    onSwitchView("conversation");
  }, [onSwitchView]);
  const openConversation = useCallback((id: string) => { setLaunchContext(null); setActiveConversationId(id); onSwitchView("conversation"); }, [onSwitchView]);
  /** 只创建并刷新首条消息对应会话；激活时机由运行中的 Workspace 在请求结束后决定，避免流式界面被 key 重挂载。 */
  const createForFirstMessage = useCallback(async (value?: { selectedConnectionId?: string; selectedModelId?: string; selectedRuntimeValues?: AiSelectedRuntimeValues }): Promise<AiConversation> => {
    const conversation = await conversationRepository.createConversation({
      today,
      kind: launchContext?.kind ?? "general",
      sourceType: launchContext?.sourceType ?? "manual",
      sourceId: launchContext?.sourceId,
      title: launchContext?.title,
      selectedConnectionId: value?.selectedConnectionId,
      selectedModelId: value?.selectedModelId,
      selectedRuntimeValues: value?.selectedRuntimeValues,
    });
    if (launchContext) {
      await conversationRepository.createAttachment({
        conversationId: conversation.id,
        kind: "context",
        label: `${launchContext.moduleLabel}上下文`,
        summary: launchContext.summary,
      });
    }
    await refresh();
    return conversation;
  }, [launchContext, refresh, today]);
  const selectResult = useCallback(async (result: CommandSearchResult) => {
    setSearchOpen(false);
    if (result.conversationId) return openConversation(result.conversationId);
    if (result.settingsSection === "configuration") return onOpenApiSettings("已打开 AI 连接设置");
    if (result.settingsSection === "mcp") return onOpenMcpSettings("已打开 MCP 设置");
    if (result.view) onSwitchView(result.view);
  }, [onOpenApiSettings, onOpenMcpSettings, onSwitchView, openConversation]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); openBlank(); }
      else if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key) && searchOpen) {
        const result = results[Number(event.key) - 1];
        if (result) { event.preventDefault(); void selectResult(result); }
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openBlank, results, searchOpen, selectResult]);

  return { activeConversationId, createForFirstMessage, launchContext, openBlank, openConversation, refresh, results, searchOpen, selectResult, setActiveConversationId, setLaunchContext, setSearchOpen, setSearchQuery, snapshot };
}
