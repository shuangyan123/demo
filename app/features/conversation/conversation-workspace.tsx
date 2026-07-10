"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { generateWithConnection, generateWithConnectionStream, transcribeWithConnection } from "../../services/ai-connection-client.ts";
import { emitAiActivity } from "../../services/ai-activity-events.ts";
import type { ChatMessageContent } from "../../services/api-client.ts";
import { conversationRepository, type ConversationSnapshot } from "../../services/conversation-repository.ts";
import { summarizeConversationRunSteps, type ConversationToolRunSummary } from "../../services/conversation-tool-summary.ts";
import type { AiConversation, AiConversationAttachment, AiConversationMessage, ApiConnectionProfile, KnowledgeEntry } from "../../types/review";
import { cx } from "../shared/ui-primitives";
import { ProviderIcon } from "../shared/provider-icon";

type DraftAttachment = {
  id: string;
  file: File;
  kind: AiConversationAttachment["kind"];
  summary: string;
};

type ConversationWorkspaceProps = {
  activeConversationId?: string | null;
  connections: ApiConnectionProfile[];
  knowledgeEntries: KnowledgeEntry[];
  scheduledCount: number;
  snapshot: ConversationSnapshot;
  textConnection?: ApiConnectionProfile;
  transcriptionConnection?: ApiConnectionProfile;
  onCreateConversation: (input?: { selectedConnectionId?: string }) => Promise<AiConversation>;
  onConversationSelected: (id: string) => void;
  onOpenConnections: () => void;
  onOpenKnowledge: () => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
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
      <summary><span aria-hidden="true" className="conversation-tool-summary-icon">◈</span><span>{summary.label}</span></summary>
      <ol>{summary.steps.map((step) => <li key={step.id}><ToolStateDot state={step.state} /><span className="min-w-0"><strong>{step.label}</strong>{step.text ? <small>{step.text}</small> : null}</span></li>)}</ol>
    </details>
  );
}

/** Codex 式对话面板：文件仅暂存内存，写入库的永远是附件摘要。 */
export function ConversationWorkspace({
  activeConversationId,
  connections,
  knowledgeEntries,
  scheduledCount,
  snapshot,
  textConnection,
  transcriptionConnection,
  onCreateConversation,
  onConversationSelected,
  onOpenConnections,
  onOpenKnowledge,
  onRefresh,
  onNotice,
}: ConversationWorkspaceProps) {
  const [draft, setDraft] = useState("");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [moveDrawerOpen, setMoveDrawerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const conversations = useMemo(() => snapshot.conversations.filter((conversation) => conversation.status === "active"), [snapshot.conversations]);
  const activeConversation = activeConversationId === null ? null : conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null;
  const requiresVision = attachments.some((attachment) => attachment.kind === "image");
  const eligibleConnections = useMemo(
    () => connections.filter((connection) => connection.capabilities.includes(requiresVision ? "vision" : "text")),
    [connections, requiresVision],
  );
  const selectedConnection = eligibleConnections.find((connection) => connection.id === activeConversation?.selectedConnectionId)
    ?? eligibleConnections.find((connection) => connection.id === textConnection?.id)
    ?? eligibleConnections[0];
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

  async function appendStep(conversationId: string, runId: string, label: string, state: "pending" | "running" | "done" | "error", text?: string) {
    await conversationRepository.appendRunStep({ conversationId, runId, label, state, text });
  }

  async function chooseConnection(connection: ApiConnectionProfile) {
    setModelMenuOpen(false);
    if (!activeConversation) return;
    await conversationRepository.setConversationConnection(activeConversation.id, connection.id);
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
    const parts: Exclude<ChatMessageContent, string> = [{ type: "text", text: content }];
    for (const attachment of attachments) {
      if (attachment.kind === "image") parts.push({ type: "image_url", image_url: { url: await readAsDataUrl(attachment.file) } });
      if (attachment.kind === "file" && attachment.summary) parts[0] = { type: "text", text: `${content}\n\n附件摘要：${attachment.file.name}\n${attachment.summary}` };
    }
    return parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts;
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if ((!content && !attachments.length) || busy) return;
    if (requiresVision && !selectedConnection?.capabilities.includes("vision")) {
      onNotice("图片需要显式选择支持多模态的模型连接");
      setModelMenuOpen(true);
      return;
    }
    if (!selectedConnection) {
      onNotice("请先配置支持当前消息能力的 AI 连接");
      onOpenConnections();
      return;
    }
    const originalDraft = draft;
    setAssistantDraft("");
    setBusy(true);
    const conversation = activeConversation ?? await onCreateConversation({ selectedConnectionId: selectedConnection.id });
    onConversationSelected(conversation.id);
    const runId = crypto.randomUUID();
    try {
      const persistedAttachments = await createPersistentAttachments(conversation.id);
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "user", content: content || "已添加附件", attachmentIds: persistedAttachments.map((item) => item.id) });
      await appendStep(conversation.id, runId, "准备上下文", "done", `已读取会话摘要和 ${persistedAttachments.length} 个附件摘要`);
      await appendStep(conversation.id, runId, "选择模型", "done", `${selectedConnection.label} / ${selectedConnection.model}`);
      emitAiActivity({ runId, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId, phase: "started", label: `${selectedConnection.provider} / ${selectedConnection.model}`, module: "对话", purpose: conversation.kind, stepId: "context", text: "准备当前会话上下文", toolDisplayMode: "inline" });
      const userContent = await buildUserContent(content || "请分析当前附件。");
      await appendStep(conversation.id, runId, "调用模型", "running", "请求已发送");
      let finalContent = "";
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      const history = [...toChatHistory(messages), { role: "user" as const, content: userContent }];
      const purpose = requiresVision ? "vision" : "text";
      if (selectedConnection.capabilities.includes("streaming")) {
        await appendStep(conversation.id, runId, "流式输出", "running", "正在接收内容");
        for await (const event of generateWithConnectionStream(selectedConnection, purpose, { messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: selectedConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } })) {
          if (event.type === "delta") { finalContent += event.text; setAssistantDraft(finalContent); }
          if (event.type === "done") { finalContent = event.content || finalContent; usage = event.usage ?? usage; }
          if (event.type === "usage") usage = event.usage ?? usage;
          if (event.type === "error") throw new Error(event.message);
        }
      } else {
        const result = await generateWithConnection(selectedConnection, purpose, { messages: history, maxOutputTokens: 1200, activity: { runId, module: "对话", purpose: conversation.kind, connectionLabel: selectedConnection.label, conversationId: conversation.id, projectId: conversation.projectId, studyDomainId: conversation.studyDomainId } });
        finalContent = result.content;
        usage = result.usage;
      }
      await conversationRepository.appendMessage({ conversationId: conversation.id, role: "assistant", content: finalContent.trim() || "模型没有返回文本。" });
      await appendStep(conversation.id, runId, "完成", "done", usage?.totalTokens ? `${usage.totalTokens} tokens` : "会话已更新");
      setDraft("");
      setAttachments([]);
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
        const query = draft.trim().toLowerCase();
        const matches = knowledgeEntries.filter((entry) => `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase().includes(query)).slice(0, 5);
        await appendStep(conversation.id, runId, "检索知识库", "done", matches.length ? matches.map((entry) => entry.title).join("、") : "未找到匹配知识，仅保留查询草稿");
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
        <div className="conversation-message-list">
          {!activeConversation || !messages.length ? <div className="conversation-empty-prompt"><h2>从一个问题开始</h2><p>发送首条消息后才会创建对话。可添加文档、图片、音频，或按住麦克风录音。</p></div> : null}
          {messages.map((message) => <article key={message.id} className={cx("conversation-message", message.role === "user" ? "is-user" : "is-assistant")}><div className="conversation-message-bubble"><div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted"><span>{message.role === "user" ? "你" : message.role === "assistant" ? "AI" : message.role}</span><span>{formatTime(message.createdAt)}</span></div><p>{message.content}</p></div></article>)}
          {assistantDraft ? <article className="conversation-message is-assistant"><div className="conversation-message-bubble"><div className="mb-1 text-xs text-muted">AI 正在输入</div><p>{assistantDraft}</p></div></article> : null}
          {latestRunSummary ? <ConversationToolSummary summary={latestRunSummary} /> : null}
          <div ref={bottomRef} />
        </div>
        <form className="conversation-composer" onSubmit={submitMessage}>
          {attachments.length ? <div className="conversation-attachment-chips">{attachments.map((attachment) => <span key={attachment.id}><span className="truncate">{attachment.file.name}</span><button type="button" aria-label={`移除 ${attachment.file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}>×</button></span>)}</div> : null}
          <textarea aria-label="对话输入" placeholder="问点什么…" rows={1} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div className="conversation-composer-toolbar">
            <input ref={fileInputRef} className="sr-only" type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,image/*,audio/*" onChange={(event) => void handleFiles(event.currentTarget.files)} />
            <button aria-label="添加附件" className="conversation-composer-icon" title="添加附件" type="button" onClick={() => fileInputRef.current?.click()}>⌕</button>
            <button aria-label="语音输入" aria-pressed={recording} className={cx("conversation-composer-icon", recording && "is-recording")} title={recording ? "松开后转写" : "按住录音"} type="button" onPointerDown={() => void startRecording()} onPointerUp={stopRecording} onPointerCancel={stopRecording}>◉</button>
            <button aria-label="快捷指令" className="conversation-composer-icon" title="快捷指令" type="button" onClick={() => setDraft((current) => `${current}${current ? " " : ""}/`)}>/</button>
            <div className="conversation-composer-menu"><button aria-label="工具" className="conversation-composer-icon" title="工具" type="button" onClick={() => setToolMenuOpen((value) => !value)}>◇</button>{toolMenuOpen ? <div className="conversation-popover"><button type="button" onClick={() => void runInternalTool("knowledge")}>检索知识库</button><button type="button" onClick={() => void runInternalTool("attachments")}>解析附件草稿</button><button type="button" onClick={() => void runInternalTool("obsidian")}>Obsidian 演进提案</button><button type="button" onClick={() => void runInternalTool("scheduled")}>已安排摘要</button></div> : null}</div>
            <div className="conversation-composer-menu"><button aria-label="选择模型" className="conversation-composer-icon" title={selectedConnection ? `${selectedConnection.label} · ${selectedConnection.model}` : "选择模型"} type="button" onClick={() => setModelMenuOpen((value) => !value)}>{selectedConnection ? <ProviderIcon provider={selectedConnection.provider} size={20} /> : "✦"}</button>{modelMenuOpen ? <div className="conversation-popover">{eligibleConnections.length ? eligibleConnections.map((connection) => <button key={connection.id} className={connection.id === selectedConnection?.id ? "is-selected" : ""} type="button" onClick={() => void chooseConnection(connection)}><span className="flex items-center gap-2"><ProviderIcon provider={connection.provider} size={18} />{connection.label}</span><small>{connection.model}</small></button>) : <button type="button" onClick={onOpenConnections}>配置兼容连接</button>}</div> : null}</div>
            <button className="conversation-send" disabled={busy || (!draft.trim() && !attachments.length)} type="submit" aria-label="发送">{busy ? <span className="ui-spinner" /> : "↑"}</button>
          </div>
        </form>
      </div>
      {moveDrawerOpen && activeConversation ? <div className="conversation-move-drawer" role="dialog" aria-modal="true" aria-label="移动对话"><button className="conversation-move-backdrop" type="button" aria-label="关闭移动菜单" onClick={() => setMoveDrawerOpen(false)} /><section><div className="flex items-center justify-between"><h2>移动到文件夹</h2><button type="button" onClick={() => setMoveDrawerOpen(false)}>×</button></div><button type="button" onClick={() => void moveConversation()}>根目录</button>{snapshot.folders.filter((folder) => folder.projectId === activeConversation.projectId).map((folder) => <button key={folder.id} type="button" onClick={() => void moveConversation(folder.id)}>{folder.parentId ? "↳ " : ""}{folder.label}</button>)}</section></div> : null}
    </section>
  );
}
