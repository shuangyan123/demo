"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import type { AiSelectedRuntimeValues } from "../../types/domains/ai-model";
import type { AiConnectionPurpose, ApiConnectionProfile } from "../../types/review";
import { AppIcon } from "../shared/app-icon";
import { cx } from "../shared/ui-primitives";
import type { DraftAttachment } from "./conversation-attachment-utils";
import { ConversationModelSelector, type ConversationModelSelectorHandle } from "./conversation-model-selector";
import type { ConversationModelSelection } from "./conversation-model-picker";

/** 工作台只需要通过句柄请求打开模型菜单，不接管菜单内部状态。 */
export type ConversationComposerHandle = {
  openModelSelector: () => void;
};

type ConversationComposerProps = {
  activeConversation: boolean;
  attachments: DraftAttachment[];
  busy: boolean;
  connections: ApiConnectionProfile[];
  draft: string;
  modelSelectionError?: string;
  purpose: AiConnectionPurpose;
  recording: boolean;
  selectedConnection?: ApiConnectionProfile;
  selectedModelId?: string;
  selectedRuntimeValues?: AiSelectedRuntimeValues;
  onAppendShortcut: () => void;
  onAttachmentsAdd: (attachments: DraftAttachment[]) => void;
  onAttachmentRemove: (attachmentId: string) => void;
  onCaptureScreen: () => void;
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
  draft,
  modelSelectionError,
  purpose,
  recording,
  selectedConnection,
  selectedModelId,
  selectedRuntimeValues,
  onAppendShortcut,
  onAttachmentsAdd,
  onAttachmentRemove,
  onCaptureScreen,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelSelectorRef = useRef<ConversationModelSelectorHandle | null>(null);

  useImperativeHandle(ref, () => ({
    openModelSelector: () => modelSelectorRef.current?.open(),
  }), []);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const prepared = await prepareAttachments(files, onNotice);
    onAttachmentsAdd(prepared);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function runTool(action: () => void) {
    setToolMenuOpen(false);
    action();
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
      {modelSelectionError ? <p className="conversation-composer-notice" role="status">{modelSelectionError}</p> : null}
      <textarea
        aria-label="对话输入"
        placeholder="问点什么…"
        rows={1}
        value={draft}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
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
        <button aria-label="添加附件" className="conversation-composer-icon" title="添加附件" type="button" onClick={() => fileInputRef.current?.click()}><AppIcon name="paperclip" size={18} /></button>
        <button aria-label="语音输入" aria-pressed={recording} className={cx("conversation-composer-icon", recording && "is-recording")} title={recording ? "松开后转写" : "按住录音"} type="button" onPointerDown={onStartRecording} onPointerUp={onStopRecording} onPointerCancel={onStopRecording}><AppIcon name="mic" size={18} /></button>
        <button aria-label="实时语音通话" className="conversation-composer-icon" title="实时语音通话" type="button" onClick={onOpenRealtimeVoice}><AppIcon name="phone" size={18} /></button>
        <button aria-label="快捷指令" className="conversation-composer-icon" title="快捷指令" type="button" onClick={onAppendShortcut}><AppIcon name="slash" size={18} /></button>
        <div className="conversation-composer-menu">
          <button aria-label="工具" aria-expanded={toolMenuOpen} className="conversation-composer-icon" title="工具" type="button" onClick={() => setToolMenuOpen((value) => !value)}><AppIcon name="tool" size={18} /></button>
          {toolMenuOpen ? (
            <div className="conversation-popover conversation-tool-menu">
              <button type="button" onClick={() => runTool(onStartCamera)}><AppIcon name="camera" size={16} />摄像头</button>
              <button type="button" onClick={() => runTool(onStartScreen)}><AppIcon name="system" size={16} />屏幕共享</button>
              <button type="button" onClick={() => runTool(onCaptureScreen)}><AppIcon name="screenshot" size={16} />截图分析</button>
              <button type="button" onClick={() => runTool(onSearchKnowledge)}><AppIcon name="knowledge" size={16} />知识库检索</button>
              <button type="button" onClick={() => runTool(activeConversation ? onOpenMcp : () => onNotice("请先发送首条消息，再调用 MCP 工具"))}><AppIcon name="system" size={16} />MCP 工具</button>
              <button type="button" onClick={() => runTool(activeConversation ? onOpenProposal : () => onNotice("请先发送首条消息，再生成 Obsidian 提案"))}><AppIcon name="sparkles" size={16} />Obsidian 提案</button>
              <button type="button" onClick={() => runTool(onOpenTutoringRecords)}><AppIcon name="tutoring" size={16} />历史辅导记录</button>
            </div>
          ) : null}
        </div>
        <div className="conversation-composer-menu">
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
        </div>
        <button className="conversation-send" disabled={busy || (!draft.trim() && !attachments.length)} type="submit" aria-label="发送">{busy ? <span className="ui-spinner" /> : <AppIcon name="send" size={18} />}</button>
      </div>
    </form>
  );
});
