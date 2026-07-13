"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { conversationRepository } from "../../services/conversation-repository";
import type { AiConversation, AiConversationFolder } from "../../types/review";
import { useConversationTreeController } from "./use-conversation-tree-controller";
import { AppIcon } from "../shared/app-icon";

type TreeDragItem = { kind: "folder" | "conversation"; id: string; label: string };

/** 名称区域直接承担拖拽，不再额外占用六点手柄列。 */
function TreeDragSurface({ item, className, onClick, children }: { item: TreeDragItem; className: string; onClick?: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `drag:${item.kind}:${item.id}`, data: item });
  return <button ref={setNodeRef} className={className} type="button" onClick={onClick} {...attributes} {...listeners}>{children}</button>;
}

/** 文件夹与根目录共用的放置边界。 */
function TreeDropZone({ folderId, dropId, active, dataDropRoot, dataDropRootTarget, className, children }: { folderId?: string; dropId?: string; active?: boolean; dataDropRoot?: boolean; dataDropRootTarget?: boolean; className: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId ?? (folderId ? `folder:${folderId}` : "root"), data: { folderId } });
  return <div ref={setNodeRef} data-drop-root={dataDropRoot ? "" : undefined} data-drop-root-target={dataDropRootTarget ? "" : undefined} className={`${className} ${isOver || active ? "is-drop-target" : ""}`}>{children}</div>;
}

type ConversationFolderTreeProps = {
  activeConversationId?: string | null;
  conversations: AiConversation[];
  folders: AiConversationFolder[];
  projectId: string;
  onConversationSelected: (id: string) => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
};

/** Codex 式对话树：文件夹默认折叠，桌面拖拽和移动端抽屉共享同一仓储操作。 */
export function ConversationFolderTree(props: ConversationFolderTreeProps) {
  const { activeConversationId, conversations, folders, projectId, onConversationSelected, onNotice, onRefresh } = props;
  const controller = useConversationTreeController();
  const [creatingParentId, setCreatingParentId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [activeDragItem, setActiveDragItem] = useState<TreeDragItem | null>(null);
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "folder" | "conversation"; id: string } | null>(null);
  const cancelRenameRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectFolders = useMemo(() => folders.filter((folder) => folder.projectId === projectId), [folders, projectId]);
  const projectConversations = useMemo(() => conversations.filter((item) => item.projectId === projectId && item.status === "active"), [conversations, projectId]);

  async function run(task: () => Promise<void>, success?: string) {
    try { await task(); await onRefresh(); if (success) onNotice(success); }
    catch (error) { onNotice(error instanceof Error ? error.message : "对话树操作失败"); }
  }

  async function createFolder() {
    if (!draftLabel.trim()) return;
    const folder = await conversationRepository.createFolder({ projectId, parentId: creatingParentId, label: draftLabel });
    controller.expandFolder(folder.id);
    setCreating(false); setDraftLabel(""); setCreatingParentId(undefined);
    await onRefresh();
  }

  async function moveInto(item: TreeDragItem, folderId?: string) {
    if (item.kind === "folder") await run(() => conversationRepository.moveFolder(item.id, folderId), "文件夹已移动");
    else await run(() => conversationRepository.moveConversation(item.id, folderId), "对话已移动");
    if (folderId) controller.expandFolder(folderId);
  }

  function startDrag(event: DragStartEvent) {
    const item = event.active.data.current as TreeDragItem | undefined;
    if (item) setActiveDragItem(item);
  }

  function finishDrag(event: DragEndEvent) {
    const item = event.active.data.current as TreeDragItem | undefined;
    const folderId = event.over?.id === "root" || event.over?.id === "root-surface" ? undefined : event.over?.data.current?.folderId as string | undefined;
    setActiveDragItem(null);
    if (item && event.over) void moveInto(item, folderId);
  }

  function openAction(kind: "folder" | "conversation", id: string, label: string, point?: { x: number; y: number }) {
    setActionLabel(label);
    controller.setAction({ kind, id });
    setContextPoint(point ?? null);
  }

  async function finishRename(kind: "folder" | "conversation", id: string) {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setRenaming(null);
      return;
    }
    await run(async () => { if (kind === "folder") await conversationRepository.renameFolder(id, actionLabel); else await conversationRepository.renameConversation(id, actionLabel); }, "已重命名");
    setRenaming(null);
  }

  /** Enter 交给失焦统一提交，Escape 只退出，避免同一次编辑重复写仓储。 */
  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      cancelRenameRef.current = true;
      event.currentTarget.blur();
    }
  }

  function renderConversation(conversation: AiConversation): ReactNode {
    return <div key={conversation.id} data-conversation-id={conversation.id} className={`conversation-tree-chat ${activeConversationId === conversation.id ? "is-active" : ""}`} onContextMenu={(event) => { event.preventDefault(); openAction("conversation", conversation.id, conversation.title, { x: event.clientX, y: event.clientY }); }}>
      {renaming?.kind === "conversation" && renaming.id === conversation.id ? <input autoFocus aria-label={`重命名${conversation.title}`} className="conversation-tree-inline-rename" value={actionLabel} onChange={(event) => setActionLabel(event.currentTarget.value)} onBlur={() => void finishRename("conversation", conversation.id)} onKeyDown={handleRenameKeyDown} /> : <TreeDragSurface className="conversation-tree-chat-label" item={{ kind: "conversation", id: conversation.id, label: conversation.title }} onClick={() => onConversationSelected(conversation.id)}><AppIcon name="message" size={16} /><span className="truncate">{conversation.title}</span></TreeDragSurface>}
      <button type="button" aria-label={`${conversation.title} 操作`} onClick={() => openAction("conversation", conversation.id, conversation.title)}><AppIcon name="more" size={16} /></button>
    </div>;
  }

  function renderFolder(folder: AiConversationFolder, depth = 0): ReactNode {
    const children = projectFolders.filter((item) => item.parentId === folder.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const chats = projectConversations.filter((item) => item.folderId === folder.id);
    const expanded = controller.expandedFolderIds.has(folder.id);
    const count = chats.length + children.reduce((sum, item) => sum + projectConversations.filter((chat) => chat.folderId === item.id).length, 0);
    return <div key={folder.id} data-folder-id={folder.id} className="conversation-tree-folder" style={{ paddingLeft: `${depth * 10}px` }} onContextMenu={(event) => { event.preventDefault(); openAction("folder", folder.id, folder.label, { x: event.clientX, y: event.clientY }); }}>
      <TreeDropZone folderId={folder.id} className="conversation-tree-folder-row">
        <button type="button" aria-label={`${expanded ? "折叠" : "展开"}${folder.label}`} onClick={() => controller.toggleFolder(folder.id)}><AppIcon name={expanded ? "chevronDown" : "chevronRight"} size={16} /></button>
        {renaming?.kind === "folder" && renaming.id === folder.id ? <input autoFocus aria-label={`重命名${folder.label}`} className="conversation-tree-inline-rename" value={actionLabel} onChange={(event) => setActionLabel(event.currentTarget.value)} onBlur={() => void finishRename("folder", folder.id)} onKeyDown={handleRenameKeyDown} /> : <TreeDragSurface className="conversation-tree-folder-label" item={{ kind: "folder", id: folder.id, label: folder.label }}><AppIcon name={expanded ? "folderOpen" : "folder"} size={16} /><span className="truncate">{folder.label}</span><small>{count}</small></TreeDragSurface>}
        <button type="button" aria-label={`${folder.label} 操作`} onClick={() => openAction("folder", folder.id, folder.label)}><AppIcon name="more" size={16} /></button>
      </TreeDropZone>
      {expanded ? <div className="conversation-tree-children">{children.map((item) => renderFolder(item, depth + 1))}{chats.map(renderConversation)}</div> : null}
    </div>;
  }

  const rootFolders = projectFolders.filter((folder) => !folder.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const rootChats = projectConversations.filter((conversation) => !conversation.folderId);
  const action = controller.action;
  const actionFolders = projectFolders.filter((folder) => folder.id !== action?.id);
  const actionDrawer = action && typeof document !== "undefined" ? createPortal(
    <div className="conversation-tree-drawer" role="presentation"><button className="conversation-tree-drawer-backdrop" type="button" aria-label="关闭" onClick={() => controller.setAction(null)} /><section role="menu" aria-label="对话树操作" style={contextPoint ? { left: `${Math.min(contextPoint.x, window.innerWidth - 190)}px`, top: `${Math.min(contextPoint.y, window.innerHeight - 190)}px` } : undefined}>
      <div className="conversation-tree-drawer-title"><strong>{actionLabel}</strong><button type="button" aria-label="关闭操作菜单" title="关闭" onClick={() => controller.setAction(null)}><AppIcon name="close" size={16} /></button></div>
      <button role="menuitem" type="button" onClick={() => { setRenaming(action); controller.setAction(null); }}>重命名</button>
      <label>移动到<select defaultValue="" onChange={(event) => {
        const targetFolderId = event.currentTarget.value || undefined;
        void run(async () => {
          if (action.kind === "folder") await conversationRepository.moveFolder(action.id, targetFolderId);
          else await conversationRepository.moveConversation(action.id, targetFolderId);
          controller.setAction(null);
        }, "已移动");
      }}><option value="">根目录</option>{actionFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.parentId ? "↳ " : ""}{folder.label}</option>)}</select></label>
      {action.kind === "folder" ? <button type="button" onClick={() => { setCreatingParentId(action.id); setCreating(true); controller.expandFolder(action.id); controller.setAction(null); }}>新建子文件夹</button> : null}
      <button className="is-danger" type="button" onClick={() => { const message = action.kind === "folder" ? "删除文件夹后，子项会移动到上一级。确定继续吗？" : "确定永久删除这条对话及其消息吗？"; if (!window.confirm(message)) return; void run(async () => { if (action.kind === "folder") await conversationRepository.deleteFolder(action.id); else await conversationRepository.deleteConversation(action.id); controller.setAction(null); }, "已删除"); }}>删除</button>
    </section></div>,
    document.body,
  ) : null;

  const tree = <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={startDrag} onDragCancel={() => setActiveDragItem(null)} onDragEnd={finishDrag}><section className="conversation-tree" aria-label="对话分类">
    <div className="conversation-tree-heading"><p>对话</p><button type="button" aria-label="新建文件夹" title="新建文件夹" onClick={() => { setCreatingParentId(undefined); setCreating(true); }}><AppIcon name="folderPlus" size={18} /></button></div>
    {creating ? <form className="conversation-tree-create" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}><input autoFocus aria-label="新文件夹名称" placeholder="文件夹名称" value={draftLabel} onChange={(event) => setDraftLabel(event.currentTarget.value)} /><button type="submit">创建</button><button type="button" onClick={() => setCreating(false)}>取消</button></form> : null}
    {activeDragItem ? <TreeDropZone dropId="root" dataDropRootTarget className="conversation-tree-root-target"><AppIcon name="back" size={16} /><span>移到根目录</span></TreeDropZone> : null}
    <TreeDropZone dropId="root-surface" dataDropRoot className="conversation-tree-root">
      {rootFolders.map((folder) => renderFolder(folder))}{rootChats.map(renderConversation)}
    </TreeDropZone>
    {!rootFolders.length && !rootChats.length ? <p className="conversation-tree-empty">发送首条消息后自动保存。</p> : null}
  </section><DragOverlay>{activeDragItem ? <div className="conversation-tree-drag-overlay"><AppIcon name={activeDragItem.kind === "folder" ? "folder" : "message"} size={16} /><span>{activeDragItem.label}</span></div> : null}</DragOverlay></DndContext>;
  return <>{tree}{actionDrawer}</>;
}
