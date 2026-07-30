"use client";

import { AppIcon } from "../shared/app-icon";

type ConversationAddMenuProps = {
  activeConversation: boolean;
  onCaptureScreen: () => void;
  onChooseFiles: () => void;
  onClose: () => void;
  onNotice: (message: string) => void;
  onOpenMcp: () => void;
  onOpenProposal: () => void;
  onOpenTutoringRecords: () => void;
  onSearchKnowledge: () => void;
  onStartCamera: () => void;
  onStartScreen: () => void;
};

/** 加号菜单只承载低频附件、媒体和知识工具。 */
export function ConversationAddMenu({
  activeConversation,
  onCaptureScreen,
  onChooseFiles,
  onClose,
  onNotice,
  onOpenMcp,
  onOpenProposal,
  onOpenTutoringRecords,
  onSearchKnowledge,
  onStartCamera,
  onStartScreen,
}: ConversationAddMenuProps) {
  function run(action: () => void) {
    onClose();
    action();
  }

  return (
    <div id="conversation-add-menu" className="conversation-popover conversation-tool-menu" role="menu" aria-label="添加与工具">
      <p>添加</p>
      <button role="menuitem" type="button" onClick={() => run(onChooseFiles)}><AppIcon name="paperclip" size={16} /><span><strong>文件和文件夹</strong><small>文档、图片或音频</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(onStartCamera)}><AppIcon name="camera" size={16} /><span><strong>摄像头</strong><small>画面仅保留在内存</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(onStartScreen)}><AppIcon name="system" size={16} /><span><strong>屏幕共享</strong><small>选择窗口或屏幕</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(onCaptureScreen)}><AppIcon name="screenshot" size={16} /><span><strong>截图分析</strong><small>截取当前共享画面</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(onSearchKnowledge)}><AppIcon name="knowledge" size={16} /><span><strong>知识库检索</strong><small>搜索本地摘要</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(activeConversation ? onOpenMcp : () => onNotice("请先发送首条消息，再调用 MCP 工具"))}><AppIcon name="mcp" size={16} /><span><strong>MCP 工具</strong><small>仅在当前对话中调用</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(activeConversation ? onOpenProposal : () => onNotice("请先发送首条消息，再生成 Obsidian 提案"))}><AppIcon name="sparkles" size={16} /><span><strong>Obsidian 提案</strong><small>生成待确认知识草稿</small></span></button>
      <button role="menuitem" type="button" onClick={() => run(onOpenTutoringRecords)}><AppIcon name="tutoring" size={16} /><span><strong>历史辅导记录</strong><small>打开已保存的摘要</small></span></button>
    </div>
  );
}
