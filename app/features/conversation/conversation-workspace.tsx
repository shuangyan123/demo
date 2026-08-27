"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { generateWithConnection, generateWithConnectionStream, resolveConnectionModelCapabilityProfile } from "../../services/ai-connection-client.ts";
import { emitAiActivity } from "../../services/ai-activity-events.ts";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues } from "../../services/model-runtime-descriptors.ts";
import { getProviderModelCatalog } from "../../services/provider-contracts.ts";
import { resolveEffectiveModelCapability } from "../../services/ai-capability-resolution.ts";
import { buildPersonalMemoryContext } from "../../services/personal-memory-context.ts";
import { buildCanonicalConversationTurns, canonicalTurnsToChatHistory } from "../../services/canonical-conversation-context.ts";
import type { ChatMessageContent } from "../../services/api-client.ts";
import { conversationRepository } from "../../services/conversation-repository.ts";
import { buildConversationTurnTimeline } from "../../services/conversation-turns.ts";
import type { KnowledgeEvolutionProposal } from "../../types/domains/obsidian.ts";
import { AppIcon } from "../shared/app-icon";
import { persistDraftAttachmentSummaries, type DraftAttachment } from "./conversation-attachment-utils.ts";
import { conversationProviderErrorMessage, readBlobAsDataUrl, requireConversationAssistantContent } from "./conversation-message-utils.ts";
import { useConversationVisionTools } from "./use-conversation-vision-tools.ts";
import { ConversationComposer, type ConversationComposerHandle } from "./conversation-composer";
import { ConversationMcpToolPanel } from "./conversation-mcp-tool-panel";
import { ConversationProposalBlock } from "./conversation-proposal-block";
import { ConversationTurnList } from "./conversation-turn-list";
import { ConversationEmptyState } from "./conversation-empty-state";
import { ConversationTopicNavigation } from "./conversation-topic-navigation";
import type { ConversationWorkspaceProps } from "./conversation-workspace-types.ts";
import { useConversationModelSelection } from "./use-conversation-model-selection.ts";
import { useConversationNavigation } from "./use-conversation-navigation";
import { useConversationAutoMemory } from "./use-conversation-auto-memory.ts";
import { useConversationRecording } from "./use-conversation-recording.ts";
import { useConversationTutoringFinish } from "./use-conversation-tutoring-finish.ts";
import { useConversationContext } from "./use-conversation-context.ts";
import "./conversation-navigation.module.css";
import { isUiReviewRuntimeActive } from "../../services/ui-review-runtime-guard.ts";
import { assertSettingsPluginEnabled, guardSettingsPluginAction } from "../../services/settings-plugin-preferences-repository.ts";
const RealtimeVoicePanel = dynamic(() => import("./realtime-voice-panel").then((module) => module.RealtimeVoicePanel), { ssr: false }); const ConversationTutoringExperience = dynamic(() => import("./conversation-tutoring-experience").then((module) => module.ConversationTutoringExperience), { loading: () => <div className="conversation-message-list"><span className="ui-spinner" /></div> });
/** Codex 式对话面板：文件仅暂存内存，写入库的永远是附件摘要。 */
export function ConversationWorkspace({ activeConversationId, connections, defaultSelections, knowledgeEntries, launchContext, personalization,
  scheduledCount, snapshot, transcriptionConnection, sampleMode = false, onCreateConversation, onConversationSelected, onOpenConnections,
  onOpenKnowledge, onOpenTutoringRecords, onRefresh, onNotice, onPersonalizationChange, onClearLaunchContext }: ConversationWorkspaceProps) {
  const [draft, setDraft] = useState(() => launchContext?.suggestedPrompt ?? "");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string>();
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [moveDrawerOpen, setMoveDrawerOpen] = useState(false);
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [proposalPanelOpen, setProposalPanelOpen] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [realtimeVoiceOpen, setRealtimeVoiceOpen] = useState(false);
  const [topicDrawerOpen, setTopicDrawerOpen] = useState(false);
  const [proposalKnowledgeIds, setProposalKnowledgeIds] = useState<string[]>([]);
  const [conversationProposals, setConversationProposals] = useState<KnowledgeEvolutionProposal[]>([]);
  const [knowledgeContext, setKnowledgeContext] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<ConversationComposerHandle | null>(null);
  const realtimeConversationIdRef = useRef<string | undefined>(undefined);
  const runStepOrdinalsRef = useRef(new Map<string, number>());
  const { capture: captureVision, mode: visionMode, start: startVision, stop: stopVision, videoRef: visionVideoRef } = useConversationVisionTools(onNotice);
  const recording = useConversationRecording({ disabled: busy, transcriptionConnection, onNotice, onOpenConnections,
    onTranscript: (text) => setDraft((current) => `${current}${current ? "\n" : ""}${text}`) });
  const conversations = useMemo(() => snapshot.conversations.filter((conversation) => conversation.status === "active"), [snapshot.conversations]);
  const activeConversation = activeConversationId === null ? null : conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null;
  const requiresVision = attachments.some((attachment) => attachment.kind === "image");
  const eligibleConnections = useMemo(() => connections.filter((connection) => connection.capabilities.includes(requiresVision ? "vision" : "text")), [connections, requiresVision]);
  const recentConversationSelection = conversations.find((conversation) => conversation.selectedConnectionId && conversation.selectedModelId);
  const defaultSelection = requiresVision ? defaultSelections?.vision : defaultSelections?.text;
  const { recordCompletedTurn } = useConversationAutoMemory({ connection: connections.find((connection) => connection.id === defaultSelections?.text?.connectionId), modelId: defaultSelections?.text?.modelId, settings: personalization, onSettingsChange: onPersonalizationChange, onNotice });
  const recentSelection = !activeConversation && recentConversationSelection?.selectedConnectionId && recentConversationSelection.selectedModelId && eligibleConnections.some((connection) => connection.id === recentConversationSelection.selectedConnectionId)
    ? { connectionId: recentConversationSelection.selectedConnectionId, modelId: recentConversationSelection.selectedModelId, selectedRuntimeValues: recentConversationSelection.selectedRuntimeValues }
    : undefined;
  const defaultFallback = !activeConversation && defaultSelection?.connectionId && defaultSelection.modelId
    ? { connectionId: defaultSelection.connectionId, modelId: defaultSelection.modelId, selectedRuntimeValues: undefined }
    : undefined;
  const { flushPendingSelection, selection, selectionError, selectModel } = useConversationModelSelection({ activeConversation, conversations,
    fallbackSelection: recentSelection ?? defaultFallback, onNotice, onRefresh });
  const selectedConnection = eligibleConnections.find((connection) => connection.id === selection?.connectionId);
  const selectedModelId = selectedConnection ? selection?.modelId : undefined;
  const storedRuntimeValues = selectedConnection ? selection?.selectedRuntimeValues : undefined;
  const effectiveConnection = selectedConnection;
  const runtimeDescriptor = effectiveConnection && selectedModelId ? getAiModelRuntimeDescriptor(effectiveConnection.provider, selectedModelId) : undefined;
  const selectedRuntimeValues = runtimeDescriptor ? normalizeAiSelectedRuntimeValues(runtimeDescriptor, storedRuntimeValues) : storedRuntimeValues;
  const tutoringFinish = useConversationTutoringFinish({ connection: effectiveConnection, conversation: activeConversation, modelId: selectedModelId,
    onNotice, personalizationSettings: personalization, selectedRuntimeValues });
  const messages = useMemo(() => snapshot.messages.filter((message) => message.conversationId === activeConversation?.id), [activeConversation?.id, snapshot.messages]);
  const conversationAttachments = useMemo(() => snapshot.attachments.filter((attachment) => attachment.conversationId === activeConversation?.id), [activeConversation?.id, snapshot.attachments]);
  const runSteps = useMemo(() => snapshot.runSteps.filter((step) => step.conversationId === activeConversation?.id).slice(-100), [activeConversation?.id, snapshot.runSteps]);
  const timeline = useMemo(() => buildConversationTurnTimeline(messages, runSteps), [messages, runSteps]);
  const conversationNavigation = useConversationNavigation({ assistantDraft, attachments: conversationAttachments, scrollContainerRef: conversationScrollRef, timeline });
  const diagnostics = useMemo(() => {
    const groups = new Map<string, typeof runSteps>();
    for (const step of runSteps) if (step.visibility === "diagnostic" && step.turnId) groups.set(step.turnId, [...(groups.get(step.turnId) ?? []), step]);
    return groups;
  }, [runSteps]);
  const contextWindow = effectiveConnection && selectedModelId ? resolveConnectionModelCapabilityProfile(effectiveConnection, selectedModelId).contextWindowTokens : undefined;
  const conversationContext = useConversationContext({ activeConversation, appendStep, attachments, connection: effectiveConnection, contextWindow, draft, knowledgeContext,
    launchContext, messages, modelId: selectedModelId, personalization, persistedAttachments: conversationAttachments, runSteps, onNotice, onRefresh });
  useEffect(() => { if (activeConversationId === undefined && activeConversation?.id) onConversationSelected(activeConversation.id); },
    [activeConversation?.id, activeConversationId, onConversationSelected]);
  useEffect(() => {
    let active = true;
    if (!activeConversation?.id) return;
    void import("../../services/obsidian-knowledge-repository").then(({ obsidianKnowledgeRepository }) => obsidianKnowledgeRepository.listProposals()).then((items) => {
      if (active) setConversationProposals(items.filter((item) => item.conversationId === activeConversation.id));
    });
    return () => { active = false; };
  }, [activeConversation?.id]);
  async function appendStep(conversationId: string, runId: string, label: string, state: "pending" | "running" | "done" | "error", text?: string, visibility: "timeline" | "diagnostic" = "diagnostic") {
    const ordinal = runStepOrdinalsRef.current.get(runId) ?? 0;
    runStepOrdinalsRef.current.set(runId, ordinal + 1);
    await conversationRepository.appendRunStep({ conversationId, runId, turnId: runId, ordinal, visibility, label, state, text });
  }
  /** 首条最终用户转写出现时才创建空白对话；增量转写和音频永不持久化。 */
  async function persistRealtimeTranscript(role: "user" | "assistant", text: string) {
    let conversationId = activeConversation?.id ?? realtimeConversationIdRef.current;
    if (!conversationId && role === "user") {
      const realtimeConnection = connections.find((item) => item.capabilities.includes("realtime"));
      const realtimeModelId = realtimeConnection ? getProviderModelCatalog(realtimeConnection.provider, "realtime")[0]?.id : undefined;
      const created = await onCreateConversation({ selectedConnectionId: realtimeConnection?.id, selectedModelId: realtimeModelId });
      conversationId = created.id;
      realtimeConversationIdRef.current = created.id;
      onConversationSelected(created.id);
      onClearLaunchContext();
    }
    if (!conversationId) return;
    await conversationRepository.appendMessage({ conversationId, role, content: text });
    await onRefresh();
  }
  async function buildUserContent(content: string): Promise<ChatMessageContent> {
    const launchContent = launchContext ? `【${launchContext.moduleLabel}上下文】\n${launchContext.summary}\n\n` : "";
    const knowledgeContent = knowledgeContext ? `【用户已选择的知识库摘要】\n${knowledgeContext}\n\n` : "";
    const contextualContent = `${launchContent}${knowledgeContent}${content}`;
    const parts: Exclude<ChatMessageContent, string> = [{ type: "text", text: contextualContent }];
    for (const attachment of attachments) {
      if (attachment.kind === "image") parts.push({ type: "image_url", image_url: { url: await readBlobAsDataUrl(attachment.file) } });
      if (attachment.kind === "file" && attachment.summary) parts[0] = { type: "text", text: `${contextualContent}\n\n附件摘要：${attachment.file.name}\n${attachment.summary}` };
    }
    return parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts;
  }
  async function captureVisionFrame() {
    const file = await captureVision();
    if (!file) return;
    setAttachments((current) => [...current, { id: crypto.randomUUID(), file, kind: "image", summary: `截图：${file.name}` }]);
    onNotice("截图已加入本轮对话，发送后才会交给多模态模型");
  }
  /** 没有活动媒体流时先触发一次系统屏幕选择，再捕获内存帧。 */
  async function captureScreenForAnalysis() {
    if (!visionMode) {
      const started = await startVision("screen");
      if (!started) return;
    }
    await captureVisionFrame();
  }
  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if ((!content && !attachments.length) || busy) return;
    if (sampleMode || isUiReviewRuntimeActive()) {
      onNotice("示例模式不会调用真实 AI；退出示例后可继续真实对话。");
      return;
    }
    conversationNavigation.markOwnSubmit();
    if (!selection?.connectionId || !selection.modelId) {
      onNotice(!selection?.connectionId ? "请先配置支持当前消息能力的 AI 连接" : "请先选择本次对话使用的模型");
      composerRef.current?.openModelSelector();
      return;
    }
    const originalDraft = draft;
    setAssistantDraft("");
    setBusy(true);
    let conversation = activeConversation;
    let createdFromDraft = false;
    const runId = crypto.randomUUID();
    setActiveTurnId(runId);
    try {
      const flushed = await flushPendingSelection();
      if (!flushed.ok) return;
      const submissionSelection = flushed.selection;
      const submissionConnection = connections.find((connection) => connection.id === submissionSelection?.connectionId);
      const submissionModelId = submissionConnection ? submissionSelection?.modelId : undefined;
      if (requiresVision && !submissionConnection?.capabilities.includes("vision")) {
        onNotice("图片需要显式选择支持多模态的模型连接");
        composerRef.current?.openModelSelector();
        return;
      }
      if (!submissionConnection || !submissionModelId) {
        onNotice(!submissionConnection ? "请先配置支持当前消息能力的 AI 连接" : "请先选择本次对话使用的模型");
        composerRef.current?.openModelSelector();
        return;
      }
      const submissionDescriptor = getAiModelRuntimeDescriptor(submissionConnection.provider, submissionModelId);
      const submissionRuntimeValues = submissionDescriptor
        ? normalizeAiSelectedRuntimeValues(submissionDescriptor, submissionSelection?.selectedRuntimeValues)
        : submissionSelection?.selectedRuntimeValues;
      if (!conversation) {
        conversation = await onCreateConversation({
          selectedConnectionId: submissionConnection.id,
          selectedModelId: submissionModelId,
          selectedRuntimeValues: submissionRuntimeValues,
        });
        createdFromDraft = true;
      }
      const persistedAttachments = await persistDraftAttachmentSummaries(conversation.id, attachments);
      const userMessage = await conversationRepository.appendMessage({ conversationId: conversation.id, turnId: runId, sequence: 0, role: "user", content: content || "已添加附件", attachmentIds: persistedAttachments.map((item) => item.id) });
      await onRefresh();
      await appendStep(conversation.id, runId, "准备上下文", "done", `已读取会话摘要和 ${persistedAttachments.length} 个附件摘要`);
      await appendStep(conversation.id, runId, "选择模型", "done", `${submissionConnection.label} / ${submissionModelId}`);
      emitAiActivity({ runId, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId, phase: "started", label: `${submissionConnection.provider} / ${submissionModelId}`, module: "对话", purpose: conversation.kind, stepId: "context", text: "准备当前会话上下文", toolDisplayMode: "inline" });
      const userContent = await buildUserContent(content || "请分析当前附件。");
      await appendStep(conversation.id, runId, "调用模型", "running", "请求已发送");
      let finalContent = "";
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      let actualSpeed: string | undefined;
      let tutoringTurn: Awaited<ReturnType<(typeof import("./conversation-tutoring-runtime"))["runConversationTutorTurn"]>> | undefined;
      if (conversation.kind === "tutoring") {
        const { runConversationTutorTurn } = await import("./conversation-tutoring-runtime");
        const imageAttachment = attachments.find((attachment) => attachment.kind === "image");
        tutoringTurn = await runConversationTutorTurn({
          connection: submissionConnection,
          conversationId: conversation.id,
          goal: launchContext?.summary ?? "围绕当前卡点完成讲解、微测和下一步复练。",
          imageAttachment,
          modelId: submissionModelId,
          personalizationSettings: personalization,
          selectedRuntimeValues: submissionRuntimeValues,
          studentText: content,
          topic: launchContext?.title ?? conversation.title,
          userMessageId: userMessage.id,
        });
        finalContent = tutoringTurn.content;
      } else {
        const memoryContext = buildPersonalMemoryContext(personalization, { moduleId: "conversation", conversationId: conversation.id, query: content });
        const history = [
          ...(memoryContext ? [{ role: "system" as const, content: memoryContext }] : []),
          ...canonicalTurnsToChatHistory(buildCanonicalConversationTurns({ conversation, messages, attachments: conversationAttachments, runSteps })),
          { role: "user" as const, content: userContent },
        ];
        const purpose = requiresVision ? "vision" : "text";
        if (resolveEffectiveModelCapability(resolveConnectionModelCapabilityProfile(submissionConnection, submissionModelId), "streaming").support === "supported") {
          await appendStep(conversation.id, runId, "流式输出", "running", "正在接收内容");
          for await (const event of generateWithConnectionStream(submissionConnection, purpose, { modelId: submissionModelId, selectedRuntimeValues: submissionRuntimeValues, messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: submissionConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } })) {
            if (event.type === "delta") { finalContent += event.text; setAssistantDraft(finalContent); }
            if (event.type === "done") { finalContent = event.content || finalContent; usage = event.usage ?? usage; actualSpeed = event.actualSpeed ?? actualSpeed; }
            if (event.type === "usage") { usage = event.usage ?? usage; actualSpeed = event.actualSpeed ?? actualSpeed; }
            if (event.type === "error") await (await import("../../services/ai-provider-failure-client.ts")).throwClientStreamFailureForProvider(submissionConnection.provider, event);
          }
        } else {
          const result = await generateWithConnection(submissionConnection, purpose, { modelId: submissionModelId, selectedRuntimeValues: submissionRuntimeValues, messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: submissionConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } });
          finalContent = result.content;
          usage = result.usage;
          actualSpeed = result.actualSpeed;
        }
      }
      const assistantMessage = await conversationRepository.appendMessage({
        conversationId: conversation.id,
        turnId: runId,
        sequence: 2,
        role: "assistant",
        content: requireConversationAssistantContent(finalContent),
        usage: usage ? {
          id: crypto.randomUUID(),
          provider: submissionConnection.provider,
          connectionId: submissionConnection.id,
          model: submissionModelId,
          purpose: requiresVision ? "vision" : "text",
          module: "conversation",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          status: "succeeded",
          createdAt: new Date().toISOString(),
        } : undefined,
      });
      if (tutoringTurn) await tutoringTurn.persist(assistantMessage.id);
      recordCompletedTurn({ user: userMessage.content, assistant: assistantMessage.content, conversationId: conversation.id, sourceMessageIds: [userMessage.id, assistantMessage.id] });
      if (submissionRuntimeValues && Object.keys(submissionRuntimeValues).length) {
        const selected = [submissionRuntimeValues.reasoning !== undefined ? `推理 ${submissionRuntimeValues.reasoning}` : "", submissionRuntimeValues.speed ? `速度 ${submissionRuntimeValues.speed}` : ""].filter(Boolean).join(" · ");
        await appendStep(conversation.id, runId, "运行档位", "done", `${selected}${submissionRuntimeValues.speed ? ` / 实际 ${actualSpeed ?? "未返回"}` : ""}`);
      }
      await appendStep(conversation.id, runId, "完成", "done", usage?.totalTokens ? `${usage.totalTokens} tokens` : "会话已更新");
      setDraft("");
      setAttachments([]);
      setKnowledgeContext("");
      await onRefresh();
    } catch (error) {
      const message = conversationProviderErrorMessage(error);
      if (conversation) {
        await appendStep(conversation.id, runId, "错误", "error", message);
        await onRefresh();
      }
      setDraft(createdFromDraft ? "" : originalDraft);
      onNotice(message);
    } finally {
      setBusy(false);
      setAssistantDraft("");
      setActiveTurnId(undefined);
      runStepOrdinalsRef.current.delete(runId);
      if (createdFromDraft && conversation) {
        onConversationSelected(conversation.id);
        onClearLaunchContext();
      }
    }
  }
  async function runInternalTool(kind: "knowledge" | "attachments" | "obsidian" | "scheduled") {
    const conversation = activeConversation;
    if (!conversation) {
      onNotice("请先发送首条消息，再运行会话工具");
      return;
    }
    const runId = crypto.randomUUID();
    try {
      if (kind === "knowledge") {
        const query = (draft.trim() || messages.at(-1)?.content || "").toLowerCase();
        const matches = knowledgeEntries.filter((entry) => `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase().includes(query)).slice(0, 5);
        setKnowledgeContext(matches.map((entry) => `${entry.title}：${entry.summary}`).join("\n"));
        await appendStep(conversation.id, runId, "检索知识库", "done", matches.length ? matches.map((entry) => entry.title).join("、") : "未找到匹配知识，仅保留查询草稿", "timeline");
        onNotice(matches.length ? `已选择 ${matches.length} 条知识摘要，将加入下一轮上下文` : "没有找到匹配知识");
      }
      if (kind === "attachments") {
        const textFiles = attachments.filter((attachment) => attachment.kind === "file");
        await appendStep(conversation.id, runId, "解析附件草稿", "done", textFiles.length ? `已准备 ${textFiles.length} 个文档摘要；确认发送后才写入会话。` : "请先选择文档、图片或音频文件", "timeline");
      }
      if (kind === "obsidian") {
        await appendStep(conversation.id, runId, "Obsidian 演进提案", "pending", "已打开知识库；提案和 Vault 写入仍需在知识库中确认。", "timeline");
        onOpenKnowledge();
      }
      if (kind === "scheduled") await appendStep(conversation.id, runId, "已安排摘要", "done", scheduledCount ? `当前有 ${scheduledCount} 个已安排任务。` : "当前没有已安排任务。", "timeline");
      await onRefresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "工具调用失败");
    }
  }
  async function recordMcpExecution(label: string, summary: string) {
    if (!activeConversation) return;
    const runId = crypto.randomUUID();
    await appendStep(activeConversation.id, runId, `MCP · ${label}`, "done", summary, "timeline");
    await onRefresh();
  }
  async function generateConversationProposals() { if (!activeConversation || !effectiveConnection) return;
    if (!guardSettingsPluginAction("obsidian-vault", onNotice, "Obsidian Vault 插件已停用")) return; const runId = crypto.randomUUID();
    setProposalBusy(true);
    try {
      await appendStep(activeConversation.id, runId, "收集提案来源", "done", `当前对话 · ${proposalKnowledgeIds.length} 条已勾选知识`, "timeline");
      const conversationText = messages.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 7000);
      const selectedKnowledge = knowledgeEntries.filter((entry) => proposalKnowledgeIds.includes(entry.id));
      const sources = [
        { id: `conversation:${activeConversation.id}`, type: "conversation" as const, title: activeConversation.title, content: conversationText, tags: ["对话"] },
        ...selectedKnowledge.map((entry) => ({ id: `knowledge:${entry.id}`, type: "knowledge" as const, title: entry.title, content: `${entry.summary}\n${entry.content}`.slice(0, 2000), tags: entry.tags })),
      ].filter((source) => source.content.trim());
      if (!sources.length) throw new Error("当前对话还没有可用于提案的内容");
      await appendStep(activeConversation.id, runId, "调用模型生成提案", "running", `${effectiveConnection.label} / ${selectedModelId}`, "timeline");
      const [{ requestKnowledgeEvolutionProposals }, { obsidianKnowledgeRepository }] = await Promise.all([
        import("../../services/knowledge-evolution-service"), import("../../services/obsidian-knowledge-repository"),
      ]);
      const graph = await obsidianKnowledgeRepository.loadGraphSnapshot();
      assertSettingsPluginEnabled("obsidian-vault");
      const result = await requestKnowledgeEvolutionProposals({ connection: effectiveConnection, modelId: selectedModelId, selectedRuntimeValues, personalization, sources, entries: knowledgeEntries, graph, activityRunId: runId });
      const linked = result.proposals.map((proposal) => ({ ...proposal, conversationId: activeConversation.id, runId }));
      await obsidianKnowledgeRepository.saveProposals(linked);
      setConversationProposals((current) => [...linked, ...current]);
      await appendStep(activeConversation.id, runId, "解析并保存 pending", "done", `解析 ${result.parsedCount} 条，过滤 ${result.filteredCount} 条，保存 ${linked.length} 条`, "timeline");
      setProposalPanelOpen(false);
      await onRefresh();
      onNotice(linked.length ? `已在对话内生成 ${linked.length} 条 Obsidian 提案` : result.emptyReason ?? "模型没有返回可用提案");
    } catch (error) {
      await appendStep(activeConversation.id, runId, "生成提案失败", "error", error instanceof Error ? error.message : "生成失败");
      await onRefresh();
      onNotice(error instanceof Error ? error.message : "生成 Obsidian 提案失败");
    } finally { setProposalBusy(false); }
  }
  async function updateConversationProposal(proposal: KnowledgeEvolutionProposal, action: "accept" | "reject") {
    if (!guardSettingsPluginAction("obsidian-vault", onNotice, "Obsidian Vault 插件已停用")) return; setProposalBusy(true);
    try {
      const { obsidianKnowledgeRepository } = await import("../../services/obsidian-knowledge-repository");
      if (action === "accept") {
        const vault = await obsidianKnowledgeRepository.loadSnapshot();
        if (vault.connected && vault.permission !== "granted") await obsidianKnowledgeRepository.requestPermission();
        await obsidianKnowledgeRepository.acceptProposal(proposal.id);
      } else await obsidianKnowledgeRepository.rejectProposal(proposal.id);
      const next = await obsidianKnowledgeRepository.listProposals();
      setConversationProposals(next.filter((item) => item.conversationId === activeConversation?.id));
      onNotice(action === "accept" ? "提案已写入知识库与 Obsidian Vault" : "提案已忽略");
    } catch (error) {
      onNotice(error instanceof Error ? `${error.message}；可重新授权、重新同步或解决冲突后重试` : "提案处理失败");
    } finally { setProposalBusy(false); }
  }
  async function moveConversation(folderId?: string) {
    if (!activeConversation) return;
    await conversationRepository.moveConversation(activeConversation.id, folderId);
    setMoveDrawerOpen(false);
    await onRefresh();
  }
  const conversationEmpty = !activeConversation || !messages.length;
  const tutoringMode = activeConversation?.kind === "tutoring" || launchContext?.kind === "tutoring";
  return (
    <section className="conversation-workspace" aria-label="AI 对话工作台">
      <div className="conversation-main">
        <header className="workspace-topbar conversation-thread-header">
          <div className="min-w-0"><h1 className="truncate text-base font-semibold">{activeConversation?.title ?? "新对话"}</h1></div>
          <div className="conversation-thread-actions">
            {conversationNavigation.topics.length ? <button className="conversation-topic-trigger" type="button" aria-haspopup="dialog" onClick={() => setTopicDrawerOpen(true)}><AppIcon name="topics" size={16} /><span>主题 {conversationNavigation.topics.length}</span></button> : null}
            {activeConversation ? <button className="conversation-header-action" type="button" title="移动到文件夹" onClick={() => setMoveDrawerOpen(true)}>⌁</button> : null}
          </div>
        </header>
        {launchContext && !activeConversation ? (
          <div className="conversation-context-bar">
            <div><span>{launchContext.moduleLabel}</span><strong>{launchContext.title}</strong><p>{launchContext.summary}</p></div>
            <button type="button" aria-label="移除对话上下文" onClick={onClearLaunchContext}><AppIcon name="close" size={16} /></button>
          </div>
        ) : null}
        <div className="conversation-message-region">
          <ConversationTopicNavigation
            drawerOpen={topicDrawerOpen}
            topics={conversationNavigation.topics}
            onCloseDrawer={() => setTopicDrawerOpen(false)}
            onSelect={conversationNavigation.scrollToTopic}
          />
          <div ref={conversationScrollRef} className="conversation-canvas-scroll" data-scroll-owner="conversation-canvas"><div className={conversationEmpty && !tutoringMode ? "conversation-message-list is-empty" : "conversation-message-list"}><div className="conversation-message-content">
          {tutoringMode ? (
            <ConversationTutoringExperience
              activeTurnId={activeTurnId}
              assistantDraft={assistantDraft}
              conversationId={activeConversation?.id}
              diagnostics={diagnostics}
              finishing={tutoringFinish.finishing}
              launchSummary={launchContext?.summary}
              launchTitle={launchContext?.title}
              timeline={timeline}
              onFinish={tutoringFinish.finish}
              onOpenHistory={onOpenTutoringRecords}
            />
          ) : (
            <>
              {conversationEmpty ? <ConversationEmptyState /> : null}
              <ConversationTurnList timeline={timeline} activeTurnId={activeTurnId} assistantDraft={assistantDraft} diagnostics={diagnostics} />
            </>
          )}
          {conversationProposals.map((proposal) => <ConversationProposalBlock key={proposal.id} proposal={proposal} busy={proposalBusy} onAccept={() => void updateConversationProposal(proposal, "accept")} onReject={() => void updateConversationProposal(proposal, "reject")} />)}
                <div ref={bottomRef} />
              </div></div></div>
        </div>
        {visionMode ? (
          <section className="conversation-vision-card" aria-label={visionMode === "camera" ? "摄像头工具" : "屏幕共享工具"}>
            <div><AppIcon name={visionMode === "camera" ? "camera" : "system"} size={18} /><strong>{visionMode === "camera" ? "摄像头" : "屏幕共享"}</strong><span>画面只保留在当前浏览器内存</span></div>
            <video ref={visionVideoRef} muted playsInline />
            <div><button type="button" onClick={() => void captureVisionFrame()}><AppIcon name="screenshot" size={16} />截取当前画面</button><button type="button" onClick={stopVision}>停止</button></div>
          </section>
        ) : null}
        {proposalPanelOpen ? <section className="conversation-inline-inspector" aria-label="生成 Obsidian 提案">
          <header><div><span>OBSIDIAN PROPOSAL</span><h2>从当前对话生成提案</h2></div><button type="button" onClick={() => setProposalPanelOpen(false)}>关闭</button></header>
          <p className="conversation-tool-confirmation">当前对话摘要始终作为来源；可明确勾选最多 5 条知识资料。不会发送完整 Vault 正文。</p>
          <div className="conversation-proposal-sources">{knowledgeEntries.slice(0, 12).map((entry) => <label key={entry.id}><input type="checkbox" checked={proposalKnowledgeIds.includes(entry.id)} disabled={!proposalKnowledgeIds.includes(entry.id) && proposalKnowledgeIds.length >= 5} onChange={(event) => { const checked = event.currentTarget.checked; setProposalKnowledgeIds((current) => checked ? [...current, entry.id] : current.filter((id) => id !== entry.id)); }} /><span><strong>{entry.title}</strong><small>{entry.summary}</small></span></label>)}</div>
          <button className="ui-button ui-button-primary" type="button" disabled={proposalBusy} onClick={() => void generateConversationProposals()}>{proposalBusy ? "生成中…" : "生成提案"}</button>
        </section> : null}
        {mcpPanelOpen ? <ConversationMcpToolPanel onClose={() => setMcpPanelOpen(false)} onExecuted={recordMcpExecution} onNotice={onNotice} /> : null}
        <div className="conversation-composer-stack">
          {conversationNavigation.showJumpToLatest ? (
            <button
              className="conversation-jump-latest"
              type="button"
              aria-label="跳到最新消息"
              title="跳到最新消息"
              onClick={() => conversationNavigation.jumpToLatest()}
            >
              <AppIcon name="down" size={18} />
            </button>
          ) : null}
        <ConversationComposer ref={composerRef}
          activeConversation={Boolean(activeConversation)} attachments={attachments}
          busy={busy || recording.busy} connections={connections} draft={draft}
          purpose={requiresVision ? "vision" : "text"} recording={recording.recording}
          selectedConnection={effectiveConnection}
          selectedModelId={selectedModelId} selectedRuntimeValues={selectedRuntimeValues}
          modelSelectionError={selectionError}
          contextBudget={conversationContext.budget} contextCompressing={conversationContext.compressing}
          contextCompaction={activeConversation?.contextCompaction}
          conversationSummary={activeConversation?.contextCompaction?.summary ?? activeConversation?.summary ?? activeConversation?.title ?? "新对话"}
          contextCompressionAvailable={Boolean(activeConversation && effectiveConnection && selectedModelId && conversationContext.candidate && !sampleMode)}
          onAttachmentsAdd={(nextAttachments) => setAttachments((current) => [...current, ...nextAttachments])}
          onAttachmentRemove={(attachmentId) => setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
          onCaptureScreen={() => void captureScreenForAnalysis()}
          onCompressContext={() => void conversationContext.compress()}
          onDraftChange={setDraft} onNotice={onNotice} onOpenConnections={onOpenConnections}
          onOpenMcp={() => setMcpPanelOpen(true)} onOpenProposal={() => setProposalPanelOpen(true)}
          onOpenRealtimeVoice={() => setRealtimeVoiceOpen(true)} onOpenTutoringRecords={onOpenTutoringRecords}
          onSearchKnowledge={() => void runInternalTool("knowledge")}
          onSelectModel={({ connection, modelId, selectedRuntimeValues: runtimeValues }) => selectModel({ connectionId: connection.id, modelId, selectedRuntimeValues: runtimeValues })}
          onStartCamera={() => void startVision("camera")} onStartRecording={() => void recording.start()}
          onStartScreen={() => void startVision("screen")} onStopRecording={recording.stop} onSubmit={submitMessage}
        />
        </div>
        {realtimeVoiceOpen ? <RealtimeVoicePanel connections={connections} onClose={() => setRealtimeVoiceOpen(false)} onFinalTranscript={persistRealtimeTranscript} /> : null}
      </div>
      {moveDrawerOpen && activeConversation ? <div className="conversation-move-drawer" role="dialog" aria-modal="true" aria-label="移动对话"><button className="conversation-move-backdrop" type="button" aria-label="关闭移动菜单" onClick={() => setMoveDrawerOpen(false)} /><section><div className="flex items-center justify-between"><h2>移动到文件夹</h2><button type="button" aria-label="关闭移动菜单" title="关闭" onClick={() => setMoveDrawerOpen(false)}><AppIcon name="close" size={16} /></button></div><button type="button" onClick={() => void moveConversation()}>根目录</button>{snapshot.folders.filter((folder) => folder.projectId === activeConversation.projectId).map((folder) => <button key={folder.id} type="button" onClick={() => void moveConversation(folder.id)}>{folder.parentId ? "↳ " : ""}{folder.label}</button>)}</section></div> : null}
    </section>
  );
}
