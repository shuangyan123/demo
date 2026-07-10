"use client";

import { useMemo, useState, type ReactNode } from "react";
import { conversationRepository } from "../../services/conversation-repository";
import type { AiConversation, AiConversationFolder } from "../../types/review";

type ConversationFolderTreeProps = {
  activeConversationId?: string | null;
  conversations: AiConversation[];
  folders: AiConversationFolder[];
  projectId: string;
  onConversationSelected: (id: string) => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
};

/** 对话树只负责文件夹分类和移动交互，持久化规则仍由 repository 集中维护。 */
export function ConversationFolderTree({
  activeConversationId,
  conversations,
  folders,
  projectId,
  onConversationSelected,
  onNotice,
  onRefresh,
}: ConversationFolderTreeProps) {
  const [creating, setCreating] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | undefined>();
  const [draftLabel, setDraftLabel] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const projectFolders = useMemo(() => folders.filter((folder) => folder.projectId === projectId), [folders, projectId]);
  const projectConversations = useMemo(
    () => conversations.filter((conversation) => conversation.projectId === projectId && conversation.status === "active"),
    [conversations, projectId],
  );

  async function refreshAfter(task: () => Promise<void>) {
    try {
      await task();
      await onRefresh();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "对话分类操作失败");
    }
  }

  async function submitFolder() {
    const label = draftLabel.trim();
    if (!label) return;
    await refreshAfter(() => conversationRepository.createFolder({ projectId, parentId: createParentId, label }).then(() => undefined));
    setDraftLabel("");
    setCreating(false);
    setCreateParentId(undefined);
  }

  async function renameFolder(id: string, label: string) {
    await refreshAfter(() => conversationRepository.renameFolder(id, label));
    setEditingFolderId(null);
  }

  function renderFolder(folder: AiConversationFolder, depth = 0): ReactNode {
    const children = projectFolders.filter((item) => item.parentId === folder.id).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    const folderConversations = projectConversations.filter((conversation) => conversation.folderId === folder.id);
    const isEditing = editingFolderId === folder.id;
    return (
      <div key={folder.id} className="conversation-folder-tree-node" style={{ marginLeft: `${depth * 10}px` }}>
        <div
          className="conversation-folder-tree-row"
          draggable
          onDragEnd={() => setDraggedFolderId(null)}
          onDragStart={(event) => {
            setDraggedFolderId(folder.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-conversation-folder", folder.id);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const folderId = draggedFolderId ?? event.dataTransfer.getData("application/x-conversation-folder");
            if (folderId) {
              void refreshAfter(() => conversationRepository.moveFolder(folderId, folder.id));
              setDraggedFolderId(null);
              return;
            }
            const conversationId = draggedConversationId ?? event.dataTransfer.getData("text/plain");
            if (!conversationId) return;
            void refreshAfter(() => conversationRepository.moveConversation(conversationId, folder.id));
            setDraggedConversationId(null);
          }}
        >
          <span aria-hidden="true">▾</span>
          {isEditing ? (
            <input
              aria-label="文件夹名称"
              autoFocus
              className="conversation-folder-tree-input"
              defaultValue={folder.label}
              onBlur={(event) => void renameFolder(folder.id, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setEditingFolderId(null);
              }}
            />
          ) : (
            <span className="truncate">▰ {folder.label}</span>
          )}
          <details className="conversation-folder-tree-menu">
            <summary aria-label={`${folder.label} 操作`} title="更多操作">•••</summary>
            <div>
              <button type="button" onClick={() => setEditingFolderId(folder.id)}>重命名</button>
              <button type="button" onClick={() => { setDraftLabel(""); setCreateParentId(folder.id); setCreating(true); }}>新建子文件夹</button>
              <button type="button" onClick={() => void refreshAfter(() => conversationRepository.deleteFolder(folder.id))}>删除文件夹</button>
            </div>
          </details>
        </div>
        <div className="conversation-folder-tree-children">
          {children.map((child) => renderFolder(child, depth + 1))}
          {folderConversations.map((conversation) => renderConversation(conversation))}
        </div>
      </div>
    );
  }

  function renderConversation(conversation: AiConversation) {
    return (
      <button
        key={conversation.id}
        draggable
        className={`conversation-folder-tree-conversation ${activeConversationId === conversation.id ? "is-active" : ""}`}
        type="button"
        onClick={() => onConversationSelected(conversation.id)}
        onDragEnd={() => setDraggedConversationId(null)}
        onDragStart={(event) => {
          setDraggedConversationId(conversation.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", conversation.id);
        }}
      >
        <span className="truncate">{conversation.title}</span>
        <span>{conversation.messageCount}</span>
      </button>
    );
  }

  const rootConversations = projectConversations.filter((conversation) => !conversation.folderId);
  const rootFolders = projectFolders.filter((folder) => !folder.parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  return (
    <section className="conversation-folder-tree" aria-label="对话分类">
      <div className="conversation-folder-tree-heading">
        <p>对话</p>
        <button type="button" title="新建文件夹" aria-label="新建文件夹" onClick={() => { setCreateParentId(undefined); setCreating((value) => !value); }}>＋</button>
      </div>
      {creating ? (
        <form
          className="conversation-folder-tree-create"
          onSubmit={(event) => {
            event.preventDefault();
            void submitFolder();
          }}
        >
          <input aria-label="新文件夹名称" autoFocus placeholder="文件夹名称" value={draftLabel} onChange={(event) => setDraftLabel(event.currentTarget.value)} />
          <button type="submit">确定</button>
        </form>
      ) : null}
      <div
        className="conversation-folder-tree-root"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const folderId = draggedFolderId ?? event.dataTransfer.getData("application/x-conversation-folder");
          if (folderId) {
            void refreshAfter(() => conversationRepository.moveFolder(folderId, undefined));
            setDraggedFolderId(null);
            return;
          }
          const conversationId = draggedConversationId ?? event.dataTransfer.getData("text/plain");
          if (!conversationId) return;
          void refreshAfter(() => conversationRepository.moveConversation(conversationId, undefined));
          setDraggedConversationId(null);
        }}
      >
        {rootFolders.map((folder) => renderFolder(folder))}
        {rootConversations.map((conversation) => renderConversation(conversation))}
      </div>
      {!rootFolders.length && !rootConversations.length ? <p className="conversation-folder-tree-empty">发送首条消息后，对话会出现在这里。</p> : null}
    </section>
  );
}
