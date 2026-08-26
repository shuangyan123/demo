"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { ConversationContextCompaction } from "../../types/domains/conversation.ts";
import type { ConversationContextBudget } from "../../services/conversation-context-budget.ts";
import { AppIcon } from "../shared/app-icon";
import { cx } from "../shared/ui-primitives";
import type { DraftAttachment } from "./conversation-attachment-utils.ts";
import { ConversationAddMenu } from "./conversation-add-menu";
import { ConversationDraftInput } from "./conversation-draft-input";
import { ConversationModelSelector, type ConversationModelSelectorHandle } from "./conversation-model-selector";
import type { ConversationModelSelection } from "./conversation-model-picker";
import { ConversationContextIndicator } from "./conversation-context-indicator";

/** 工作台只需要通过句柄请求打开模型菜单，不接管菜单内部状态。 */
export type ConversationComposerHandle = {
  openModelSelector: () => void;
};

type ConversationComposerProps = {
  activeConversation: boolean;
  attachments: DraftAttachment[];
  busy: boolean;
  connections: ApiConnectionProfile[];
  contextBudget: ConversationContextBudget;
  contextCompaction?: ConversationContextCompaction;
  contextCompressing: boolean;
  contextCompressionAvailable: boolean;
  conversationSummary: string;
  draft: string;
  modelSelectionError?: string;
  purpose: AiConnectionPurpose;
  recording: boolean;
  selectedConnection?: ApiConnectionProfile;
  selectedModelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  onAttachmentsAdd: (attachments: DraftAttachment[]) => void;
  onAttachmentRemove: (attachmentId: string) => void;
  onCaptureScreen: () => void;
  onCompressContext: () => void;
  onDraftChange: (draft: string) => void;
  onNotice: (message: string) => void;
  onOpenConnections: () => void;
  onOpenMcp: () => void;
  onOpenProposal: () => void;
  onOpenRealtimeVoice: () => void;
  onOpenTutoringRecords: () => void;
  onSearchKnowledge: () => void;
  onSelectModel: (selection: ConversationModelSelection) => void;
  onStartCamera: () => void;
  onStartRecording: () => void;
  onStartScreen: () => void;
  onStopRecording: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function attachmentKind(file: File): DraftAttachment["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

/** 将本地文件归一化为发送前附件；超限文件只提示，不进入内存队列。 */
async function prepareAttachments(files: FileList, onNotice: (message: string) => void): Promise<DraftAttachment[]> {
  const prepared: DraftAttachment[] = [];
  for (const file of Array.from(files).slice(0, 6)) {
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
    prepared.push({ id: crypto.randomUUID(), file, kind, summary });
  }
  return prepared;
}

/** 紧凑 Composer：负责输入、附件、工具入口和模型选择器装配。 */
export const ConversationComposer = forwardRef<ConversationComposerHandle, ConversationComposerProps>(function ConversationComposer({
  activeConversation,
  attachments,
  busy,
  connections,
  contextBudget,
  contextCompaction,
  contextCompressing,
  contextCompressionAvailable,
  conversationSummary,
  draft,
  modelSelectionError,
  purpose,
  recording,
  selectedConnection,
  selectedModelId,
  selectedRuntimeValues,
  onAttachmentsAdd,
  onAttachmentRemove,
  onCaptureScreen,
  onCompressContext,
  onDraftChange,
  onNotice,
  onOpenConnections,
  onOpenMcp,
  onOpenProposal,
  onOpenRealtimeVoice,
  onOpenTutoringRecords,
  onSearchKnowledge,
  onSelectModel,
  onStartCamera,
  onStartRecording,
  onStartScreen,
  onStopRecording,
  onSubmit,
}, ref) {
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolNotice, setToolNotice] = useState<string>();
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelSelectorRef = useRef<ConversationModelSelectorHandle | null>(null);

  useImperativeHandle(ref, () => ({
    openModelSelector: () => modelSelectorRef.current?.open(),
  }), []);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (addMenuRef.current?.contains(event.target as Node)) return;
      setToolMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolMenuOpen(false);
      addTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [toolMenuOpen]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const prepared = await prepareAttachments(files, onNotice);
    onAttachmentsAdd(prepared);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form className="conversation-composer" data-conversation-composer onSubmit={onSubmit}>
      {attachments.length ? (
        <div className="conversation-attachment-chips">
          {attachments.map((attachment) => (
            <span key={attachment.id}>
              <span className="truncate">{attachment.file.name}</span>
              <button
                type="button"
                aria-label={`移除 ${attachment.file.name}`}
                title="移除附件"
                onClick={() => onAttachmentRemove(attachment.id)}
              >
                <AppIcon name="close" size={16} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {modelSelectionError || toolNotice ? <p className="conversation-composer-notice" role="status">{modelSelectionError ?? toolNotice}</p> : null}
      <ConversationDraftInput
        activeConversation={activeConversation}
        draft={draft}
        onChange={(value) => { setToolNotice(undefined); onDraftChange(value); }}
        onNotice={(message) => { setToolNotice(message); onNotice(message); }}
        onOpenMcp={onOpenMcp}
        onOpenModel={() => modelSelectorRef.current?.open()}
        onOpenReasoning={() => modelSelectorRef.current?.openRuntime("reasoning")}
        onSearchKnowledge={onSearchKnowledge}
      />
      <div className="conversation-composer-toolbar">
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,image/*,audio/*"
          onChange={(event) => void handleFiles(event.currentTarget.files)}
        />
        <div ref={addMenuRef} className="conversation-composer-menu">
          <button
            ref={addTriggerRef}
            aria-controls={toolMenuOpen ? "conversation-add-menu" : undefined}
            aria-expanded={toolMenuOpen}
            aria-haspopup="menu"
            aria-label="添加"
            className="conversation-composer-icon"
            title="添加"
            type="button"
            onClick={() => setToolMenuOpen((value) => !value)}
          >
            <AppIcon name="newChat" size={20} />
          </button>
          {toolMenuOpen ? (
            <ConversationAddMenu
              activeConversation={activeConversation}
              onCaptureScreen={onCaptureScreen}
              onChooseFiles={() => fileInputRef.current?.click()}
              onClose={() => setToolMenuOpen(false)}
              onNotice={(message) => { setToolNotice(message); onNotice(message); }}
              onOpenMcp={onOpenMcp}
              onOpenProposal={onOpenProposal}
              onOpenTutoringRecords={onOpenTutoringRecords}
              onSearchKnowledge={onSearchKnowledge}
              onStartCamera={onStartCamera}
              onStartScreen={onStartScreen}
            />
          ) : null}
        </div>
        <div className="conversation-composer-actions">
          <ConversationModelSelector
            ref={modelSelectorRef}
            connections={connections}
            disabled={busy}
            purpose={purpose}
            selectedConnectionId={selectedConnection?.id}
            selectedModelId={selectedModelId}
            selectedRuntimeValues={selectedRuntimeValues}
            onOpenConnections={onOpenConnections}
            onSelect={onSelectModel}
          />
          <ConversationContextIndicator
            budget={contextBudget}
            busy={busy}
            compaction={contextCompaction}
            compressing={contextCompressing}
            compressionAvailable={contextCompressionAvailable}
            conversationSummary={conversationSummary}
            onCompress={onCompressContext}
          />
          <button
            aria-label={recording ? "松开后转写" : "按住录音"}
            className={cx("conversation-composer-icon", recording && "is-recording")}
            disabled={busy}
            title={recording ? "松开后转写" : "按住录音"}
            type="button"
            onPointerDown={onStartRecording}
            onPointerUp={onStopRecording}
            onPointerCancel={onStopRecording}
          >
            <AppIcon name="mic" size={20} />
          </button>
          {draft.trim() || attachments.length ? (
            <button className="conversation-send" disabled={busy} type="submit" aria-label="发送">{busy ? <span className="ui-spinner" /> : <AppIcon name="send" size={18} />}</button>
          ) : (
            <button className="conversation-send conversation-voice" disabled={busy} type="button" aria-label="开始语音聊天" title="开始语音聊天" onClick={onOpenRealtimeVoice}>
              <AppIcon name="voice" size={20} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
});
