"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildCommandSearchResults } from "../../services/command-search";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository";
import type { AiConversation, CommandSearchResult } from "../../types/domains/conversation";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection";
import type { AutomationSnapshot } from "../../types/domains/automation";
import type { KnowledgeEntry } from "../../types/domains/knowledge";
import type { Mistake, ViewKey } from "../../types/domains/review";

type UseReviewConversationControllerInput = {
  automationSnapshot: AutomationSnapshot;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  onNotice: (message: string) => void;
  onOpenApiSettings: (message: string) => void;
  onOpenMcpSettings: (message: string) => void;
  onSwitchView: (view: ViewKey) => void;
  textConnection?: ApiConnectionProfile;
  today: Date;
};

const EMPTY_SNAPSHOT: ConversationSnapshot = { projects: [], folders: [], conversations: [], attachments: [], messages: [], runSteps: [] };

/** 管理主工作台的对话快照、命令搜索和全局快捷键。 */
export function useReviewConversationController(input: UseReviewConversationControllerInput) {
  const { automationSnapshot, knowledgeEntries, mistakes, onNotice, onOpenApiSettings, onOpenMcpSettings, onSwitchView, textConnection, today } = input;
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>(EMPTY_SNAPSHOT);
  const [activeConversationId, setActiveConversationId] = useState<string | null | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const refresh = useCallback(async () => {
    const nextSnapshot = await conversationRepository.loadSnapshot(today);
    setSnapshot(nextSnapshot);
    setActiveConversationId((current) => current === null ? null : current ?? nextSnapshot.conversations.find((item) => item.status === "active")?.id);
  }, [today]);

  useEffect(() => {
    let active = true;
    void conversationRepository.loadSnapshot(today).then((nextSnapshot) => {
      if (!active) return;
      setSnapshot(nextSnapshot);
      setActiveConversationId((current) => current === null ? null : current ?? nextSnapshot.conversations.find((item) => item.status === "active")?.id);
    }).catch((error: unknown) => {
      if (active) onNotice(error instanceof Error ? error.message : "对话读取失败");
    });
    return () => { active = false; };
  }, [onNotice, today]);

  const results = useMemo(() => buildCommandSearchResults({ projects: snapshot.projects, conversations: snapshot.conversations, mistakes, knowledgeEntries, automationSnapshot }, searchQuery), [automationSnapshot, knowledgeEntries, mistakes, searchQuery, snapshot.conversations, snapshot.projects]);
  const openBlank = useCallback(() => { setActiveConversationId(null); onSwitchView("conversation"); }, [onSwitchView]);
  const openConversation = useCallback((id: string) => { setActiveConversationId(id); onSwitchView("conversation"); }, [onSwitchView]);
  const createForFirstMessage = useCallback(async (value?: { selectedConnectionId?: string }): Promise<AiConversation> => {
    const conversation = await conversationRepository.createConversation({ today, kind: "general", selectedConnectionId: value?.selectedConnectionId ?? textConnection?.id });
    await refresh();
    setActiveConversationId(conversation.id);
    return conversation;
  }, [refresh, textConnection?.id, today]);
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

  return { activeConversationId, createForFirstMessage, openBlank, openConversation, refresh, results, searchOpen, selectResult, setActiveConversationId, setSearchOpen, setSearchQuery, snapshot };
}
