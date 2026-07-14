"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { generateWithConnection, generateWithConnectionStream, transcribeWithConnection } from "../../services/ai-connection-client.ts";
import { emitAiActivity } from "../../services/ai-activity-events.ts";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues } from "../../services/model-runtime-descriptors.ts";
import { getProviderModelCatalog } from "../../services/provider-contracts.ts";
import { buildPersonalMemoryContext } from "../../services/personal-memory-context.ts";
import type { ChatMessageContent } from "../../services/api-client.ts";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository.ts";
import { summarizeConversationRunSteps } from "../../services/conversation-tool-summary.ts";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { AiConversation, ApiConnectionProfile, KnowledgeEntry, KnowledgeEvolutionProposal, PersonalizationSettings } from "../../types/review";
import { cx } from "../shared/ui-primitives";
import { AppIcon } from "../shared/app-icon";
import type { ConversationLaunchContext } from "./conversation-launch-context";
import { persistDraftAttachmentSummaries, type DraftAttachment } from "./conversation-attachment-utils";
import { conversationProviderErrorMessage, formatConversationTime, readBlobAsDataUrl, toConversationChatHistory } from "./conversation-message-utils";
import { useConversationVisionTools } from "./use-conversation-vision-tools";
import { ConversationComposer, type ConversationComposerHandle } from "./conversation-composer";
import { ConversationMcpToolPanel } from "./conversation-mcp-tool-panel";
import { ConversationProposalBlock } from "./conversation-proposal-block";
import { ConversationToolRunSummary } from "./conversation-tool-run-summary";
import { useConversationModelSelection } from "./use-conversation-model-selection";
const RealtimeVoicePanel = dynamic(() => import("./realtime-voice-panel").then((module) => module.RealtimeVoicePanel), { ssr: false });

type ConversationWorkspaceProps = {
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
  onClearLaunchContext: () => void;
};
/** Codex 式对话面板：文件仅暂存内存，写入库的永远是附件摘要。 */
export function ConversationWorkspace({
  activeConversationId,
  connections,
  defaultSelections,
  knowledgeEntries,
  launchContext,
  personalization,
  scheduledCount,
  snapshot,
  transcriptionConnection,
  onCreateConversation,
  onConversationSelected,
  onOpenConnections,
  onOpenKnowledge,
  onOpenTutoringRecords,
  onRefresh,
  onNotice,
  onClearLaunchContext,
}: ConversationWorkspaceProps) {
  const [draft, setDraft] = useState(() => launchContext?.suggestedPrompt ?? "");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [moveDrawerOpen, setMoveDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [proposalPanelOpen, setProposalPanelOpen] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [realtimeVoiceOpen, setRealtimeVoiceOpen] = useState(false);
  const [proposalKnowledgeIds, setProposalKnowledgeIds] = useState<string[]>([]);
  const [conversationProposals, setConversationProposals] = useState<KnowledgeEvolutionProposal[]>([]);
  const [knowledgeContext, setKnowledgeContext] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<ConversationComposerHandle | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const realtimeConversationIdRef = useRef<string | undefined>(undefined);
  const { capture: captureVision, mode: visionMode, start: startVision, stop: stopVision, videoRef: visionVideoRef } = useConversationVisionTools(onNotice);
  const conversations = useMemo(() => snapshot.conversations.filter((conversation) => conversation.status === "active"), [snapshot.conversations]);
  const activeConversation = activeConversationId === null ? null : conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null;
  const requiresVision = attachments.some((attachment) => attachment.kind === "image");
  const eligibleConnections = useMemo(
    () => connections.filter((connection) => connection.capabilities.includes(requiresVision ? "vision" : "text")),
    [connections, requiresVision],
  );
  const recentConversationSelection = conversations.find((conversation) => conversation.selectedConnectionId && conversation.selectedModelId);
  const defaultSelection = requiresVision ? defaultSelections?.vision : defaultSelections?.text;
  const recentSelection = !activeConversation && recentConversationSelection?.selectedConnectionId && recentConversationSelection.selectedModelId && eligibleConnections.some((connection) => connection.id === recentConversationSelection.selectedConnectionId)
    ? { connectionId: recentConversationSelection.selectedConnectionId, modelId: recentConversationSelection.selectedModelId, selectedRuntimeValues: recentConversationSelection.selectedRuntimeValues }
    : undefined;
  const defaultFallback = !activeConversation && defaultSelection?.connectionId && defaultSelection.modelId
    ? { connectionId: defaultSelection.connectionId, modelId: defaultSelection.modelId, selectedRuntimeValues: undefined }
    : undefined;
  const { flushPendingSelection, selection, selectionError, selectModel } = useConversationModelSelection({
    activeConversation,
    conversations,
    fallbackSelection: recentSelection ?? defaultFallback,
    onNotice,
    onRefresh,
  });
  const selectedConnection = eligibleConnections.find((connection) => connection.id === selection?.connectionId);
  const selectedModelId = selectedConnection ? selection?.modelId : undefined;
  const storedRuntimeValues = selectedConnection ? selection?.selectedRuntimeValues : undefined;
  const effectiveConnection = selectedConnection;
  const runtimeDescriptor = effectiveConnection && selectedModelId ? getAiModelRuntimeDescriptor(effectiveConnection.provider, selectedModelId) : undefined;
  const selectedRuntimeValues = runtimeDescriptor ? normalizeAiSelectedRuntimeValues(runtimeDescriptor, storedRuntimeValues) : storedRuntimeValues;
  const messages = useMemo(() => snapshot.messages.filter((message) => message.conversationId === activeConversation?.id), [activeConversation?.id, snapshot.messages]);
  const runSteps = useMemo(() => snapshot.runSteps.filter((step) => step.conversationId === activeConversation?.id).slice(-20), [activeConversation?.id, snapshot.runSteps]);
  const latestRunSummary = useMemo(() => summarizeConversationRunSteps(runSteps).at(-1), [runSteps]);

  useEffect(() => {
    if (activeConversationId === undefined && activeConversation?.id) onConversationSelected(activeConversation.id);
  }, [activeConversation?.id, activeConversationId, onConversationSelected]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [assistantDraft, messages.length]);
  useEffect(() => () => mediaStreamRef.current?.getTracks().forEach((track) => track.stop()), []);
  useEffect(() => {
    let active = true;
    if (!activeConversation?.id) return;
    void import("../../services/obsidian-knowledge-repository").then(({ obsidianKnowledgeRepository }) => obsidianKnowledgeRepository.listProposals()).then((items) => {
      if (active) setConversationProposals(items.filter((item) => item.conversationId === activeConversation.id));
    });
    return () => { active = false; };
  }, [activeConversation?.id]);
  async function appendStep(conversationId: string, runId: string, label: string, state: "pending" | "running" | "done" | "error", text?: string) {
    await conversationRepository.appendRunStep({ conversationId, runId, label, state, text });
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
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content: content || "已添加附件", attachmentIds: persistedAttachments.map((item) => item.id) });
      await appendStep(conversation.id, runId, "准备上下文", "done", `已读取会话摘要和 ${persistedAttachments.length} 个附件摘要`);
      await appendStep(conversation.id, runId, "选择模型", "done", `${submissionConnection.label} / ${submissionModelId}`);
      emitAiActivity({ runId, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId, phase: "started", label: `${submissionConnection.provider} / ${submissionModelId}`, module: "对话", purpose: conversation.kind, stepId: "context", text: "准备当前会话上下文", toolDisplayMode: "inline" });
      const userContent = await buildUserContent(content || "请分析当前附件。");
      await appendStep(conversation.id, runId, "调用模型", "running", "请求已发送");
      let finalContent = "";
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      let actualSpeed: string | undefined;
      const memoryContext = buildPersonalMemoryContext(personalization, { moduleId: "conversation", conversationId: conversation.id });
      const history = [
        ...(memoryContext ? [{ role: "system" as const, content: memoryContext }] : []),
        ...toConversationChatHistory(messages),
        { role: "user" as const, content: userContent },
      ];
      const purpose = requiresVision ? "vision" : "text";
      if (submissionConnection.capabilities.includes("streaming")) {
        await appendStep(conversation.id, runId, "流式输出", "running", "正在接收内容");
        for await (const event of generateWithConnectionStream(submissionConnection, purpose, { modelId: submissionModelId, selectedRuntimeValues: submissionRuntimeValues, messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: submissionConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } })) {
          if (event.type === "delta") { finalContent += event.text; setAssistantDraft(finalContent); }
          if (event.type === "done") { finalContent = event.content || finalContent; usage = event.usage ?? usage; actualSpeed = event.actualSpeed ?? actualSpeed; }
          if (event.type === "usage") { usage = event.usage ?? usage; actualSpeed = event.actualSpeed ?? actualSpeed; }
          if (event.type === "error") throw new Error(event.message);
        }
      } else {
        const result = await generateWithConnection(submissionConnection, purpose, { modelId: submissionModelId, selectedRuntimeValues: submissionRuntimeValues, messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: submissionConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } });
        finalContent = result.content;
        usage = result.usage;
        actualSpeed = result.actualSpeed;
      }
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "assistant", content: finalContent.trim() || "模型没有返回文本。" });
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
      if (createdFromDraft && conversation) {
        onConversationSelected(conversation.id);
        onClearLaunchContext();
      }
    }
  }

  async function transcribeBlob(blob: Blob) {
    if (!transcriptionConnection) {
      onNotice("请先在 AI 连接中配置 Google Gemini 录音转写连接");
      onOpenConnections();
      return;
    }
    try {
      setBusy(true);
      const dataUrl = await readBlobAsDataUrl(blob);
      const audioBase64 = dataUrl.split(",")[1] ?? "";
      const result = await transcribeWithConnection(transcriptionConnection, { audioBase64, mimeType: blob.type || "audio/webm" });
      setDraft((current) => `${current}${current ? "\n" : ""}${result.text}`);
      onNotice("录音已转写到输入框，请确认后发送");
    } catch (error) {
      onNotice(conversationProviderErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (recording || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        void transcribeBlob(blob);
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "无法打开麦克风");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    setRecording(false);
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
        await appendStep(conversation.id, runId, "检索知识库", "done", matches.length ? matches.map((entry) => entry.title).join("、") : "未找到匹配知识，仅保留查询草稿");
        onNotice(matches.length ? `已选择 ${matches.length} 条知识摘要，将加入下一轮上下文` : "没有找到匹配知识");
      }
      if (kind === "attachments") {
        const textFiles = attachments.filter((attachment) => attachment.kind === "file");
        await appendStep(conversation.id, runId, "解析附件草稿", "done", textFiles.length ? `已准备 ${textFiles.length} 个文档摘要；确认发送后才写入会话。` : "请先选择文档、图片或音频文件");
      }
      if (kind === "obsidian") {
        await appendStep(conversation.id, runId, "Obsidian 演进提案", "pending", "已打开知识库；提案和 Vault 写入仍需在知识库中确认。");
        onOpenKnowledge();
      }
      if (kind === "scheduled") await appendStep(conversation.id, runId, "已安排摘要", "done", scheduledCount ? `当前有 ${scheduledCount} 个已安排任务。` : "当前没有已安排任务。");
      await onRefresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "工具调用失败");
    }
  }

  async function recordMcpExecution(label: string, summary: string) {
    if (!activeConversation) return;
    const runId = crypto.randomUUID();
    await appendStep(activeConversation.id, runId, `MCP · ${label}`, "done", summary);
    await onRefresh();
  }

  async function generateConversationProposals() {
    if (!activeConversation || !effectiveConnection) return;
    const runId = crypto.randomUUID();
    setProposalBusy(true);
    try {
      await appendStep(activeConversation.id, runId, "收集提案来源", "done", `当前对话 · ${proposalKnowledgeIds.length} 条已勾选知识`);
      const conversationText = messages.slice(-12).map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 7000);
      const selectedKnowledge = knowledgeEntries.filter((entry) => proposalKnowledgeIds.includes(entry.id));
      const sources = [
        { id: `conversation:${activeConversation.id}`, type: "conversation" as const, title: activeConversation.title, content: conversationText, tags: ["对话"] },
        ...selectedKnowledge.map((entry) => ({ id: `knowledge:${entry.id}`, type: "knowledge" as const, title: entry.title, content: `${entry.summary}\n${entry.content}`.slice(0, 2000), tags: entry.tags })),
      ].filter((source) => source.content.trim());
      if (!sources.length) throw new Error("当前对话还没有可用于提案的内容");
      await appendStep(activeConversation.id, runId, "调用模型生成提案", "running", `${effectiveConnection.label} / ${selectedModelId}`);
      const [{ requestKnowledgeEvolutionProposals }, { obsidianKnowledgeRepository }] = await Promise.all([
        import("../../services/knowledge-evolution-service"), import("../../services/obsidian-knowledge-repository"),
      ]);
      const graph = await obsidianKnowledgeRepository.loadGraphSnapshot();
      const result = await requestKnowledgeEvolutionProposals({ connection: effectiveConnection, modelId: selectedModelId, selectedRuntimeValues, personalization, sources, entries: knowledgeEntries, graph, activityRunId: runId });
      const linked = result.proposals.map((proposal) => ({ ...proposal, conversationId: activeConversation.id, runId }));
      await obsidianKnowledgeRepository.saveProposals(linked);
      setConversationProposals((current) => [...linked, ...current]);
      await appendStep(activeConversation.id, runId, "解析并保存 pending", "done", `解析 ${result.parsedCount} 条，过滤 ${result.filteredCount} 条，保存 ${linked.length} 条`);
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
    setProposalBusy(true);
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

  return (
    <section className="conversation-workspace" aria-label="AI 对话工作台">
      <div className="conversation-main">
        <header className="conversation-thread-header">
          <div className="min-w-0"><p className="text-xs text-muted">公考 / AI 对话</p><h1 className="truncate text-xl font-semibold">{activeConversation?.title ?? ""}</h1></div>
          {activeConversation ? <button className="conversation-header-action" type="button" title="移动到文件夹" onClick={() => setMoveDrawerOpen(true)}>⌁</button> : null}
        </header>
        {launchContext && !activeConversation ? (
          <div className="conversation-context-bar">
            <div><span>{launchContext.moduleLabel}</span><strong>{launchContext.title}</strong><p>{launchContext.summary}</p></div>
            <button type="button" aria-label="移除对话上下文" onClick={onClearLaunchContext}><AppIcon name="close" size={16} /></button>
          </div>
        ) : null}
        <div className="conversation-message-list">
          {!activeConversation || !messages.length ? <div className="conversation-empty-prompt"><h2>从一个问题开始</h2><p>发送首条消息后才会创建对话。可添加文档、图片、音频，或按住麦克风录音。</p></div> : null}
          {messages.map((message) => <article key={message.id} className={cx("conversation-message", message.role === "user" ? "is-user" : "is-assistant")}><div className="conversation-message-bubble"><div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted"><span>{message.role === "user" ? "你" : message.role === "assistant" ? "AI" : message.role}</span><span>{formatConversationTime(message.createdAt)}</span></div><p>{message.content}</p></div></article>)}
          {assistantDraft ? <article className="conversation-message is-assistant"><div className="conversation-message-bubble"><div className="mb-1 text-xs text-muted">AI 正在输入</div><p>{assistantDraft}</p></div></article> : null}
          {conversationProposals.map((proposal) => <ConversationProposalBlock key={proposal.id} proposal={proposal} busy={proposalBusy} onAccept={() => void updateConversationProposal(proposal, "accept")} onReject={() => void updateConversationProposal(proposal, "reject")} />)}
          {latestRunSummary ? <ConversationToolRunSummary summary={latestRunSummary} /> : null}
          <div ref={bottomRef} />
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
        <ConversationComposer
          ref={composerRef}
          activeConversation={Boolean(activeConversation)}
          attachments={attachments}
          busy={busy}
          connections={connections}
          draft={draft}
          purpose={requiresVision ? "vision" : "text"}
          recording={recording}
          selectedConnection={effectiveConnection}
          selectedModelId={selectedModelId}
          selectedRuntimeValues={selectedRuntimeValues}
          modelSelectionError={selectionError}
          onAppendShortcut={() => setDraft((current) => `${current}${current ? " " : ""}/`)}
          onAttachmentsAdd={(nextAttachments) => setAttachments((current) => [...current, ...nextAttachments])}
          onAttachmentRemove={(attachmentId) => setAttachments((current) => current.filter((item) => item.id !== attachmentId))}
          onCaptureScreen={() => void captureScreenForAnalysis()}
          onDraftChange={setDraft}
          onNotice={onNotice}
          onOpenConnections={onOpenConnections}
          onOpenMcp={() => setMcpPanelOpen(true)}
          onOpenProposal={() => setProposalPanelOpen(true)}
          onOpenRealtimeVoice={() => setRealtimeVoiceOpen(true)}
          onOpenTutoringRecords={onOpenTutoringRecords}
          onSearchKnowledge={() => void runInternalTool("knowledge")}
          onSelectModel={({ connection, modelId, selectedRuntimeValues: runtimeValues }) => selectModel({ connectionId: connection.id, modelId, selectedRuntimeValues: runtimeValues })}
          onStartCamera={() => void startVision("camera")}
          onStartRecording={() => void startRecording()}
          onStartScreen={() => void startVision("screen")}
          onStopRecording={stopRecording}
          onSubmit={submitMessage}
        />
        {realtimeVoiceOpen ? <RealtimeVoicePanel connections={connections} onClose={() => setRealtimeVoiceOpen(false)} onFinalTranscript={persistRealtimeTranscript} /> : null}
      </div>
      {moveDrawerOpen && activeConversation ? <div className="conversation-move-drawer" role="dialog" aria-modal="true" aria-label="移动对话"><button className="conversation-move-backdrop" type="button" aria-label="关闭移动菜单" onClick={() => setMoveDrawerOpen(false)} /><section><div className="flex items-center justify-between"><h2>移动到文件夹</h2><button type="button" aria-label="关闭移动菜单" title="关闭" onClick={() => setMoveDrawerOpen(false)}><AppIcon name="close" size={16} /></button></div><button type="button" onClick={() => void moveConversation()}>根目录</button>{snapshot.folders.filter((folder) => folder.projectId === activeConversation.projectId).map((folder) => <button key={folder.id} type="button" onClick={() => void moveConversation(folder.id)}>{folder.parentId ? "↳ " : ""}{folder.label}</button>)}</section></div> : null}
    </section>
  );
}
