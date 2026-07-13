"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { generateWithConnection, generateWithConnectionStream, transcribeWithConnection } from "../../services/ai-connection-client.ts";
import { emitAiActivity } from "../../services/ai-activity-events.ts";
import { getAiModelRuntimeDescriptor, normalizeAiSelectedRuntimeValues } from "../../services/model-runtime-descriptors.ts";
import { getProviderModelCatalog } from "../../services/provider-contracts.ts";
import type { ChatMessageContent } from "../../services/api-client.ts";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository.ts";
import { summarizeConversationRunSteps, type ConversationToolRunSummary } from "../../services/conversation-tool-summary.ts";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { AiConversation, AiConversationAttachment, AiConversationMessage, ApiConnectionProfile, KnowledgeEntry, KnowledgeEvolutionProposal, PersonalizationSettings } from "../../types/review";
import { cx } from "../shared/ui-primitives";
import { ProviderIcon } from "../shared/provider-icon";
import { AppIcon } from "../shared/app-icon";
import type { ConversationLaunchContext } from "./conversation-launch-context";
import { useConversationVisionTools } from "./use-conversation-vision-tools";
import { useConversationModelMenu } from "./use-conversation-model-menu";
import { ConversationModelPicker } from "./conversation-model-picker";
import { ConversationMcpToolPanel } from "./conversation-mcp-tool-panel";
import { ConversationProposalBlock } from "./conversation-proposal-block";

const RealtimeVoicePanel = dynamic(() => import("./realtime-voice-panel").then((module) => module.RealtimeVoicePanel), { ssr: false });

type DraftAttachment = {
  id: string;
  file: File;
  kind: AiConversationAttachment["kind"];
  summary: string;
};

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

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function toChatHistory(messages: AiConversationMessage[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content }));
}

function attachmentKind(file: File): DraftAttachment["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取本地文件"));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  });
}

function providerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "AI 对话失败";
  if (/at capacity|overload|resource exhausted|429|503/i.test(raw)) return "模型暂时满载，请切换模型或稍后再试";
  return raw;
}

function ToolStateDot({ state }: { state: "pending" | "running" | "done" | "error" }) {
  return <span aria-hidden="true" className={cx("mt-1 h-2.5 w-2.5 rounded-full", state === "done" && "bg-green", state === "running" && "bg-blue", state === "error" && "bg-red", state === "pending" && "bg-muted/40")} />;
}

/** 工具过程在消息流中折叠展示，展开后才显示每一步的本地摘要。 */
function ConversationToolSummary({ summary }: { summary: ConversationToolRunSummary }) {
  return (
    <details className={cx("conversation-tool-summary", summary.state === "error" && "is-error", summary.state === "running" && "is-running")}>
      <summary><span aria-hidden="true" className="conversation-tool-summary-icon"><AppIcon name="activity" size={16} /></span><span>{summary.label}</span></summary>
      <ol>{summary.steps.map((step) => <li key={step.id}><ToolStateDot state={step.state} /><span className="min-w-0"><strong>{step.label}</strong>{step.text ? <small>{step.text}</small> : null}</span></li>)}</ol>
    </details>
  );
}

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
  const { menuId, menuRef, open: modelMenuOpen, openMenu: openModelMenu, toggle: toggleModelMenu, triggerRef } = useConversationModelMenu();
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [moveDrawerOpen, setMoveDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [proposalPanelOpen, setProposalPanelOpen] = useState(false);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [realtimeVoiceOpen, setRealtimeVoiceOpen] = useState(false);
  const [proposalKnowledgeIds, setProposalKnowledgeIds] = useState<string[]>([]);
  const [conversationProposals, setConversationProposals] = useState<KnowledgeEvolutionProposal[]>([]);
  const [knowledgeContext, setKnowledgeContext] = useState("");
  const [draftSelection, setDraftSelection] = useState<{ connectionId: string; modelId: string; selectedRuntimeValues?: AiSelectedRuntimeValues }>();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const recentSelection = !activeConversation && recentConversationSelection && eligibleConnections.some((connection) => connection.id === recentConversationSelection.selectedConnectionId)
    ? { connectionId: recentConversationSelection.selectedConnectionId, modelId: recentConversationSelection.selectedModelId, selectedRuntimeValues: recentConversationSelection.selectedRuntimeValues }
    : undefined;
  const selection = draftSelection
    ?? (activeConversation ? { connectionId: activeConversation.selectedConnectionId, modelId: activeConversation.selectedModelId, selectedRuntimeValues: activeConversation.selectedRuntimeValues } : undefined)
    ?? recentSelection
    ?? (!activeConversation && defaultSelection ? { ...defaultSelection, selectedRuntimeValues: undefined } : undefined);
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
    }
    if (!conversationId) return;
    await conversationRepository.appendMessage({ conversationId, role, content: text });
    await onRefresh();
  }

  async function chooseModel(connection: ApiConnectionProfile, modelId: string, runtimeValues: AiSelectedRuntimeValues) {
    setDraftSelection({ connectionId: connection.id, modelId, selectedRuntimeValues: runtimeValues });
    if (!activeConversation) return;
    await conversationRepository.setConversationModelSelection(activeConversation.id, connection.id, modelId, runtimeValues);
    await onRefresh();
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, 6);
    const next: DraftAttachment[] = [];
    for (const file of selected) {
      if (file.size > 15 * 1024 * 1024) {
        onNotice(`${file.name} 超过 15MB 限制`);
        continue;
      }
      const kind = attachmentKind(file);
      let summary = `${kind === "image" ? "图片" : kind === "audio" ? "音频" : "文档"}，${Math.max(1, Math.ceil(file.size / 1024))} KB`;
      if (kind === "file" && /^(text\/|application\/(json|csv))/.test(file.type)) {
        const text = await file.text();
        summary = text.replace(/\s+/g, " ").trim().slice(0, 240) || summary;
      }
      next.push({ id: crypto.randomUUID(), file, kind, summary });
    }
    setAttachments((current) => [...current, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function createPersistentAttachments(conversationId: string) {
    return Promise.all(attachments.map((attachment) => conversationRepository.createAttachment({
      conversationId,
      kind: attachment.kind,
      label: attachment.file.name,
      summary: attachment.summary,
      mimeType: attachment.file.type || undefined,
      sizeBytes: attachment.file.size,
    })));
  }

  async function buildUserContent(content: string): Promise<ChatMessageContent> {
    const launchContent = launchContext ? `【${launchContext.moduleLabel}上下文】\n${launchContext.summary}\n\n` : "";
    const knowledgeContent = knowledgeContext ? `【用户已选择的知识库摘要】\n${knowledgeContext}\n\n` : "";
    const contextualContent = `${launchContent}${knowledgeContent}${content}`;
    const parts: Exclude<ChatMessageContent, string> = [{ type: "text", text: contextualContent }];
    for (const attachment of attachments) {
      if (attachment.kind === "image") parts.push({ type: "image_url", image_url: { url: await readAsDataUrl(attachment.file) } });
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
    if (requiresVision && !effectiveConnection?.capabilities.includes("vision")) {
      onNotice("图片需要显式选择支持多模态的模型连接");
      openModelMenu();
      return;
    }
    if (!effectiveConnection || !selectedModelId) {
      onNotice(!effectiveConnection ? "请先配置支持当前消息能力的 AI 连接" : "请先选择本次对话使用的模型");
      openModelMenu();
      return;
    }
    const originalDraft = draft;
    setAssistantDraft("");
    setBusy(true);
    const conversation = activeConversation ?? await onCreateConversation({ selectedConnectionId: effectiveConnection.id, selectedModelId, selectedRuntimeValues });
    onConversationSelected(conversation.id);
    const runId = crypto.randomUUID();
    try {
      const persistedAttachments = await createPersistentAttachments(conversation.id);
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content: content || "已添加附件", attachmentIds: persistedAttachments.map((item) => item.id) });
      await appendStep(conversation.id, runId, "准备上下文", "done", `已读取会话摘要和 ${persistedAttachments.length} 个附件摘要`);
      await appendStep(conversation.id, runId, "选择模型", "done", `${effectiveConnection.label} / ${selectedModelId}`);
      emitAiActivity({ runId, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId, phase: "started", label: `${effectiveConnection.provider} / ${selectedModelId}`, module: "对话", purpose: conversation.kind, stepId: "context", text: "准备当前会话上下文", toolDisplayMode: "inline" });
      const userContent = await buildUserContent(content || "请分析当前附件。");
      await appendStep(conversation.id, runId, "调用模型", "running", "请求已发送");
      let finalContent = "";
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      let actualSpeed: string | undefined;
      const history = [...toChatHistory(messages), { role: "user" as const, content: userContent }];
      const purpose = requiresVision ? "vision" : "text";
      if (effectiveConnection.capabilities.includes("streaming")) {
        await appendStep(conversation.id, runId, "流式输出", "running", "正在接收内容");
        for await (const event of generateWithConnectionStream(effectiveConnection, purpose, { modelId: selectedModelId, selectedRuntimeValues, messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: effectiveConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } })) {
          if (event.type === "delta") { finalContent += event.text; setAssistantDraft(finalContent); }
          if (event.type === "done") { finalContent = event.content || finalContent; usage = event.usage ?? usage; actualSpeed = event.actualSpeed ?? actualSpeed; }
          if (event.type === "usage") { usage = event.usage ?? usage; actualSpeed = event.actualSpeed ?? actualSpeed; }
          if (event.type === "error") throw new Error(event.message);
        }
      } else {
        const result = await generateWithConnection(effectiveConnection, purpose, { modelId: selectedModelId, selectedRuntimeValues, messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: effectiveConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } });
        finalContent = result.content;
        usage = result.usage;
        actualSpeed = result.actualSpeed;
      }
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "assistant", content: finalContent.trim() || "模型没有返回文本。" });
      if (selectedRuntimeValues && Object.keys(selectedRuntimeValues).length) {
        const selected = [selectedRuntimeValues.reasoning !== undefined ? `推理 ${selectedRuntimeValues.reasoning}` : "", selectedRuntimeValues.speed ? `速度 ${selectedRuntimeValues.speed}` : ""].filter(Boolean).join(" · ");
        await appendStep(conversation.id, runId, "运行档位", "done", `${selected}${selectedRuntimeValues.speed ? ` / 实际 ${actualSpeed ?? "未返回"}` : ""}`);
      }
      await appendStep(conversation.id, runId, "完成", "done", usage?.totalTokens ? `${usage.totalTokens} tokens` : "会话已更新");
      setDraft("");
      setAttachments([]);
      setKnowledgeContext("");
      await onRefresh();
    } catch (error) {
      const message = providerErrorMessage(error);
      await appendStep(conversation.id, runId, "错误", "error", message);
      await onRefresh();
      setDraft(originalDraft);
      onNotice(message);
    } finally {
      setBusy(false);
      setAssistantDraft("");
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
      const dataUrl = await readAsDataUrl(blob);
      const audioBase64 = dataUrl.split(",")[1] ?? "";
      const result = await transcribeWithConnection(transcriptionConnection, { audioBase64, mimeType: blob.type || "audio/webm" });
      setDraft((current) => `${current}${current ? "\n" : ""}${result.text}`);
      onNotice("录音已转写到输入框，请确认后发送");
    } catch (error) {
      onNotice(providerErrorMessage(error));
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
    setToolMenuOpen(false);
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
          {messages.map((message) => <article key={message.id} className={cx("conversation-message", message.role === "user" ? "is-user" : "is-assistant")}><div className="conversation-message-bubble"><div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted"><span>{message.role === "user" ? "你" : message.role === "assistant" ? "AI" : message.role}</span><span>{formatTime(message.createdAt)}</span></div><p>{message.content}</p></div></article>)}
          {assistantDraft ? <article className="conversation-message is-assistant"><div className="conversation-message-bubble"><div className="mb-1 text-xs text-muted">AI 正在输入</div><p>{assistantDraft}</p></div></article> : null}
          {conversationProposals.map((proposal) => <ConversationProposalBlock key={proposal.id} proposal={proposal} busy={proposalBusy} onAccept={() => void updateConversationProposal(proposal, "accept")} onReject={() => void updateConversationProposal(proposal, "reject")} />)}
          {latestRunSummary ? <ConversationToolSummary summary={latestRunSummary} /> : null}
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
          <div className="conversation-proposal-sources">{knowledgeEntries.slice(0, 12).map((entry) => <label key={entry.id}><input type="checkbox" checked={proposalKnowledgeIds.includes(entry.id)} disabled={!proposalKnowledgeIds.includes(entry.id) && proposalKnowledgeIds.length >= 5} onChange={(event) => setProposalKnowledgeIds((current) => event.currentTarget.checked ? [...current, entry.id] : current.filter((id) => id !== entry.id))} /><span><strong>{entry.title}</strong><small>{entry.summary}</small></span></label>)}</div>
          <button className="ui-button ui-button-primary" type="button" disabled={proposalBusy} onClick={() => void generateConversationProposals()}>{proposalBusy ? "生成中…" : "生成提案"}</button>
        </section> : null}
        {mcpPanelOpen ? <ConversationMcpToolPanel onClose={() => setMcpPanelOpen(false)} onExecuted={recordMcpExecution} onNotice={onNotice} /> : null}
        <form className="conversation-composer" onSubmit={submitMessage}>
          {attachments.length ? <div className="conversation-attachment-chips">{attachments.map((attachment) => <span key={attachment.id}><span className="truncate">{attachment.file.name}</span><button type="button" aria-label={`移除 ${attachment.file.name}`} title="移除附件" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><AppIcon name="close" size={16} /></button></span>)}</div> : null}
          <textarea aria-label="对话输入" placeholder="问点什么…" rows={1} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div className="conversation-composer-toolbar">
            <input ref={fileInputRef} className="sr-only" type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,image/*,audio/*" onChange={(event) => void handleFiles(event.currentTarget.files)} />
            <button aria-label="添加附件" className="conversation-composer-icon" title="添加附件" type="button" onClick={() => fileInputRef.current?.click()}><AppIcon name="paperclip" size={18} /></button>
            <button aria-label="语音输入" aria-pressed={recording} className={cx("conversation-composer-icon", recording && "is-recording")} title={recording ? "松开后转写" : "按住录音"} type="button" onPointerDown={() => void startRecording()} onPointerUp={stopRecording} onPointerCancel={stopRecording}><AppIcon name="mic" size={18} /></button>
            <button aria-label="实时语音通话" className="conversation-composer-icon" title="实时语音通话" type="button" onClick={() => setRealtimeVoiceOpen(true)}><AppIcon name="phone" size={18} /></button>
            <button aria-label="快捷指令" className="conversation-composer-icon" title="快捷指令" type="button" onClick={() => setDraft((current) => `${current}${current ? " " : ""}/`)}><AppIcon name="slash" size={18} /></button>
            <div className="conversation-composer-menu">
              <button aria-label="工具" className="conversation-composer-icon" title="工具" type="button" onClick={() => setToolMenuOpen((value) => !value)}><AppIcon name="tool" size={18} /></button>
              {toolMenuOpen ? <div className="conversation-popover conversation-tool-menu">
                <button type="button" onClick={() => { setToolMenuOpen(false); void startVision("camera"); }}><AppIcon name="camera" size={16} />摄像头</button>
                <button type="button" onClick={() => { setToolMenuOpen(false); void startVision("screen"); }}><AppIcon name="system" size={16} />屏幕共享</button>
                <button type="button" onClick={() => { setToolMenuOpen(false); void captureScreenForAnalysis(); }}><AppIcon name="screenshot" size={16} />截图分析</button>
                <button type="button" onClick={() => void runInternalTool("knowledge")}><AppIcon name="knowledge" size={16} />知识库检索</button>
                <button type="button" onClick={() => { setToolMenuOpen(false); if (!activeConversation) return onNotice("请先发送首条消息，再调用 MCP 工具"); setMcpPanelOpen(true); }}><AppIcon name="system" size={16} />MCP 工具</button>
                <button type="button" onClick={() => { setToolMenuOpen(false); if (!activeConversation) return onNotice("请先发送首条消息，再生成 Obsidian 提案"); setProposalPanelOpen(true); }}><AppIcon name="sparkles" size={16} />Obsidian 提案</button>
                <button type="button" onClick={onOpenTutoringRecords}><AppIcon name="tutoring" size={16} />历史辅导记录</button>
              </div> : null}
            </div>
            <div className="conversation-composer-menu">
              <button ref={triggerRef} aria-label="选择模型" aria-expanded={modelMenuOpen} aria-controls={modelMenuOpen ? menuId : undefined} className="conversation-model-trigger" title={effectiveConnection && selectedModelId ? `${effectiveConnection.label} · ${selectedModelId}` : "选择模型"} type="button" onClick={toggleModelMenu}>
                {effectiveConnection && selectedModelId ? <><ProviderIcon provider={effectiveConnection.provider} size={18} /><span>{selectedModelId}</span><AppIcon name="chevronDown" size={16} /></> : <><AppIcon name="sparkles" size={18} /><span>选择模型</span></>}
              </button>
              {modelMenuOpen ? <ConversationModelPicker ref={menuRef} id={menuId} connections={connections} purpose={requiresVision ? "vision" : "text"} selectedConnectionId={effectiveConnection?.id} selectedModelId={selectedModelId} selectedRuntimeValues={selectedRuntimeValues} onOpenConnections={onOpenConnections} onSelect={({ connection, modelId, selectedRuntimeValues: runtimeValues }) => void chooseModel(connection, modelId, runtimeValues)} /> : null}
            </div>
            <button className="conversation-send" disabled={busy || (!draft.trim() && !attachments.length)} type="submit" aria-label="发送">{busy ? <span className="ui-spinner" /> : <AppIcon name="send" size={18} />}</button>
          </div>
        </form>
        {realtimeVoiceOpen ? <RealtimeVoicePanel connections={connections} onClose={() => setRealtimeVoiceOpen(false)} onFinalTranscript={persistRealtimeTranscript} /> : null}
      </div>
      {moveDrawerOpen && activeConversation ? <div className="conversation-move-drawer" role="dialog" aria-modal="true" aria-label="移动对话"><button className="conversation-move-backdrop" type="button" aria-label="关闭移动菜单" onClick={() => setMoveDrawerOpen(false)} /><section><div className="flex items-center justify-between"><h2>移动到文件夹</h2><button type="button" aria-label="关闭移动菜单" title="关闭" onClick={() => setMoveDrawerOpen(false)}><AppIcon name="close" size={16} /></button></div><button type="button" onClick={() => void moveConversation()}>根目录</button>{snapshot.folders.filter((folder) => folder.projectId === activeConversation.projectId).map((folder) => <button key={folder.id} type="button" onClick={() => void moveConversation(folder.id)}>{folder.parentId ? "↳ " : ""}{folder.label}</button>)}</section></div> : null}
    </section>
  );
}
