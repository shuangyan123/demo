"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent } from "react";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model.ts";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { ConversationContextBudget } from "../../services/conversation-context-budget.ts";
import { mcpSettingsRepository } from "../../services/mcp-settings-repository.ts";
import { summarizeMcpPermission } from "../../services/mcp-permission.ts";
import { AppIcon } from "../shared/app-icon";
import { cx } from "../shared/ui-primitives";
import type { DraftAttachment } from "./conversation-attachment-utils.ts";
import { ConversationAddMenu } from "./conversation-add-menu";
import { ConversationDraftInput } from "./conversation-draft-input";
import { ConversationModelSelector, type ConversationModelSelectorHandle } from "./conversation-model-selector";
import type { ConversationModelSelection } from "./conversation-model-picker";
import { ConversationContextIndicator } from "./conversation-context-indicator";
import { UiHint } from "../shared/ui-tooltip";

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
  contextCompressing: boolean;
  contextCompressionAvailable: boolean;
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
  onOpenPermissions: () => void;
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
  contextCompressing,
  contextCompressionAvailable,
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
  onOpenPermissions,
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
  const permissionLabel = useMemo(() => summarizeMcpPermission(mcpSettingsRepository.load()), []);

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

  useEffect(() => {
    function handleComposerShortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        modelSelectorRef.current?.open();
      }
      if (event.key.toLowerCase() === "d" && !busy) {
        event.preventDefault();
        if (recording) onStopRecording();
        else onStartRecording();
      }
    }
    document.addEventListener("keydown", handleComposerShortcut);
    return () => document.removeEventListener("keydown", handleComposerShortcut);
  }, [busy, onStartRecording, onStopRecording, recording]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const prepared = await prepareAttachments(files, onNotice);
    onAttachmentsAdd(prepared);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <form className="conversation-composer conversation-composer-card" data-conversation-composer data-conversation-layer="composer-card" onSubmit={onSubmit}>
      {attachments.length ? (
        <div className="conversation-attachment-chips">
          {attachments.map((attachment) => (
            <span key={attachment.id}>
              <span className="truncate">{attachment.file.name}</span>
              <UiHint label="移除附件" placement="top">{({ describedBy }) => <button
                type="button"
                aria-describedby={describedBy}
                aria-label={`移除 ${attachment.file.name}`}
                onClick={() => onAttachmentRemove(attachment.id)}
              >
                <AppIcon name="close" size={16} />
              </button>}</UiHint>
            </span>
          ))}
        </div>
      ) : null}
      {modelSelectionError || toolNotice ? <p className="conversation-composer-notice" role="status">{modelSelectionError ?? toolNotice}</p> : null}
      <ConversationDraftInput
        activeConversation={activeConversation}
        contextCompressionAvailable={contextCompressionAvailable && !busy}
        contextCompressing={contextCompressing}
        draft={draft}
        onChange={(value) => { setToolNotice(undefined); onDraftChange(value); }}
        onCompressContext={onCompressContext}
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
          <UiHint label="添加文件等内容" badge="@" placement="top">{({ describedBy }) => <button
            ref={addTriggerRef}
            aria-controls={toolMenuOpen ? "conversation-add-menu" : undefined}
            aria-expanded={toolMenuOpen}
            aria-haspopup="menu"
            aria-describedby={describedBy}
            aria-label="添加文件等内容"
            className="conversation-composer-icon conversation-composer-add"
            type="button"
            onClick={() => setToolMenuOpen((value) => !value)}
          >
            <AppIcon name="newChat" size={20} />
          </button>}</UiHint>
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
        <UiHint label="更改权限" placement="top">{({ describedBy }) => <button
          aria-describedby={describedBy}
          aria-label={`更改权限：${permissionLabel}`}
          className="conversation-composer-permission"
          data-permission-state={permissionLabel}
          type="button"
          onClick={onOpenPermissions}
        >
          <AppIcon name="tool" size={16} />
          <span>{permissionLabel}</span>
        </button>}</UiHint>
        <div className="conversation-composer-actions">
          <ConversationContextIndicator
            budget={contextBudget}
          />
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
          <UiHint label="点击开始听写" badge="Ctrl+Shift+D" placement="top">{({ describedBy }) => <button
            aria-label={recording ? "停止听写" : "点击开始听写"}
            aria-describedby={describedBy}
            className={cx("conversation-composer-icon", "conversation-composer-mic", recording && "is-recording")}
            disabled={busy}
            type="button"
            onClick={recording ? onStopRecording : onStartRecording}
          >
            <AppIcon name="mic" size={20} />
          </button>}</UiHint>
          {draft.trim() || attachments.length ? (
            <UiHint label="发送" placement="top">{({ describedBy }) => <button className="conversation-send" disabled={busy} type="submit" aria-describedby={describedBy} aria-label="发送">{busy ? <span className="ui-spinner" /> : <AppIcon name="send" size={18} />}</button>}</UiHint>
          ) : (
            <UiHint label="开启语音聊天" placement="top">{({ describedBy }) => <button className="conversation-send conversation-voice" disabled={busy} type="button" aria-describedby={describedBy} aria-label="开启语音聊天" onClick={onOpenRealtimeVoice}>
              <AppIcon name="voice" size={20} />
            </button>}</UiHint>
          )}
        </div>
      </div>
    </form>
  );
});
