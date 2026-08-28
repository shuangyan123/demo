"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { conversationRepository } from "../../services/conversation-repository";
import type { AiConversation, AiConversationFolder } from "../../types/domains/conversation.ts";
import { useConversationTreeController } from "./use-conversation-tree-controller.ts";
import { AppIcon } from "../shared/app-icon";
import { announceInteractiveOverlayOpen } from "../shared/ui-overlay-events";
import { UiHint } from "../shared/ui-tooltip";

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
  const [actionAnchor, setActionAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null);
  const [actionLevel, setActionLevel] = useState<"root" | "move">("root");
  const [renaming, setRenaming] = useState<{ kind: "folder" | "conversation"; id: string } | null>(null);
  const cancelRenameRef = useRef(false);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const rootMenuRef = useRef<HTMLElement | null>(null);
  const moveMenuRef = useRef<HTMLElement | null>(null);
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

  /** 右键与省略号统一读取当前行操作按钮的位置，避免同一菜单出现两套坐标语义。 */
  function openAction(kind: "folder" | "conversation", id: string, label: string, anchor: HTMLElement | null) {
    announceInteractiveOverlayOpen();
    setActionLabel(label);
    setActionLevel("root");
    actionTriggerRef.current = anchor;
    controller.setAction({ kind, id });
    const rect = anchor?.getBoundingClientRect();
    setActionAnchor(rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null);
  }

  function closeAction(restoreFocus = true) {
    controller.setAction(null);
    setActionLevel("root");
    if (restoreFocus) window.requestAnimationFrame(() => actionTriggerRef.current?.focus());
  }

  /** 菜单使用原生按钮焦点顺序，并补充桌面菜单常用的方向键导航。 */
  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>, level: "root" | "move") {
    if (event.key === "Escape") {
      event.preventDefault();
      if (level === "move") {
        setActionLevel("root");
        window.requestAnimationFrame(() => rootMenuRef.current?.querySelector<HTMLElement>("[data-open-move]")?.focus());
      } else closeAction();
      return;
    }
    if (level === "move" && event.key === "ArrowLeft") {
      event.preventDefault();
      setActionLevel("root");
      window.requestAnimationFrame(() => rootMenuRef.current?.querySelector<HTMLElement>("[data-open-move]")?.focus());
      return;
    }
    if (level === "root" && event.key === "ArrowRight" && (event.target as HTMLElement).hasAttribute("data-open-move")) {
      event.preventDefault();
      setActionLevel("move");
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const panel = level === "move" ? moveMenuRef.current : rootMenuRef.current;
    const items = [...(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  useEffect(() => {
    if (!controller.action) return;
    const target = actionLevel === "move" ? moveMenuRef.current : rootMenuRef.current;
    window.requestAnimationFrame(() => target?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [actionLevel, controller.action]);

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
    return <div key={conversation.id} data-conversation-id={conversation.id} data-mobile-sidebar-close="true" className={`conversation-tree-chat ${activeConversationId === conversation.id ? "is-active" : ""}`} onContextMenu={(event) => { event.preventDefault(); openAction("conversation", conversation.id, conversation.title, event.currentTarget.querySelector<HTMLElement>("[data-tree-action-trigger]")); }}>
      <span className="conversation-tree-disclosure-slot" aria-hidden="true" />
      {renaming?.kind === "conversation" && renaming.id === conversation.id ? <input autoFocus aria-label={`重命名${conversation.title}`} className="conversation-tree-inline-rename" value={actionLabel} onChange={(event) => setActionLabel(event.currentTarget.value)} onBlur={() => void finishRename("conversation", conversation.id)} onKeyDown={handleRenameKeyDown} /> : <TreeDragSurface className="conversation-tree-chat-label" item={{ kind: "conversation", id: conversation.id, label: conversation.title }} onClick={() => onConversationSelected(conversation.id)}><AppIcon name="message" size={16} /><span className="truncate">{conversation.title}</span></TreeDragSurface>}
      <UiHint label="更多操作" placement="right">{({ describedBy }) => <button data-tree-action-trigger type="button" aria-describedby={describedBy} aria-label={`${conversation.title} 操作`} onClick={(event) => openAction("conversation", conversation.id, conversation.title, event.currentTarget)}><AppIcon name="more" size={16} /></button>}</UiHint>
    </div>;
  }

  function renderFolder(folder: AiConversationFolder): ReactNode {
    const children = projectFolders.filter((item) => item.parentId === folder.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const chats = projectConversations.filter((item) => item.folderId === folder.id);
    const expanded = controller.expandedFolderIds.has(folder.id);
    const count = chats.length + children.reduce((sum, item) => sum + projectConversations.filter((chat) => chat.folderId === item.id).length, 0);
    return <div key={folder.id} data-folder-id={folder.id} className="conversation-tree-folder" onContextMenu={(event) => { event.preventDefault(); openAction("folder", folder.id, folder.label, event.currentTarget.querySelector<HTMLElement>("[data-tree-action-trigger]")); }}>
      <TreeDropZone folderId={folder.id} className="conversation-tree-folder-row">
        <UiHint label={expanded ? "折叠" : "展开"} placement="right">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label={`${expanded ? "折叠" : "展开"}${folder.label}`} onClick={() => controller.toggleFolder(folder.id)}><AppIcon name={expanded ? "chevronDown" : "chevronRight"} size={16} /></button>}</UiHint>
        {renaming?.kind === "folder" && renaming.id === folder.id ? <input autoFocus aria-label={`重命名${folder.label}`} className="conversation-tree-inline-rename" value={actionLabel} onChange={(event) => setActionLabel(event.currentTarget.value)} onBlur={() => void finishRename("folder", folder.id)} onKeyDown={handleRenameKeyDown} /> : <TreeDragSurface className="conversation-tree-folder-label" item={{ kind: "folder", id: folder.id, label: folder.label }}><AppIcon name={expanded ? "folderOpen" : "folder"} size={16} /><span className="truncate">{folder.label}</span><small>{count}</small></TreeDragSurface>}
        <UiHint label="更多操作" placement="right">{({ describedBy }) => <button data-tree-action-trigger type="button" aria-describedby={describedBy} aria-label={`${folder.label} 操作`} onClick={(event) => openAction("folder", folder.id, folder.label, event.currentTarget)}><AppIcon name="more" size={16} /></button>}</UiHint>
      </TreeDropZone>
      {expanded ? <div className="conversation-tree-children">{children.map(renderFolder)}{chats.map(renderConversation)}</div> : null}
    </div>;
  }

  const rootFolders = projectFolders.filter((folder) => !folder.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const rootChats = projectConversations.filter((conversation) => !conversation.folderId);
  const action = controller.action;
  const actionFolder = action?.kind === "folder" ? projectFolders.find((folder) => folder.id === action.id) : undefined;
  const actionConversation = action?.kind === "conversation" ? projectConversations.find((conversation) => conversation.id === action.id) : undefined;
  const currentFolderId = actionFolder?.parentId ?? actionConversation?.folderId;
  const invalidFolderIds = useMemo(() => {
    if (action?.kind !== "folder") return new Set<string>();
    const invalid = new Set([action.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of projectFolders) {
        if (folder.parentId && invalid.has(folder.parentId) && !invalid.has(folder.id)) {
          invalid.add(folder.id);
          changed = true;
        }
      }
    }
    return invalid;
  }, [action, projectFolders]);
  const actionFolders = projectFolders.filter((folder) => !invalidFolderIds.has(folder.id));
  const desktopLayout = actionAnchor && typeof window !== "undefined" && window.matchMedia("(min-width: 701px)").matches
    ? (() => {
        const panelWidth = 208;
        const submenuWidth = 224;
        const gap = 8;
        const preferredLeft = actionAnchor.right + gap;
        const left = preferredLeft + panelWidth <= window.innerWidth - 8
          ? preferredLeft
          : Math.max(8, actionAnchor.left - panelWidth - gap);
        const top = Math.max(8, Math.min(actionAnchor.top, window.innerHeight - 208));
        const submenuSide = left + panelWidth + gap + submenuWidth <= window.innerWidth - 8 ? "right" : "left";
        return { style: { left: `${left}px`, top: `${top}px` } satisfies CSSProperties, submenuSide };
      })()
    : undefined;
  async function moveActionTo(targetFolderId?: string) {
    if (!action) return;
    await run(async () => {
      if (action.kind === "folder") await conversationRepository.moveFolder(action.id, targetFolderId);
      else await conversationRepository.moveConversation(action.id, targetFolderId);
      closeAction(false);
    }, "已移动");
  }
  const actionDrawer = action && typeof document !== "undefined" ? createPortal(
    <div className="conversation-tree-drawer" role="presentation"><button className="conversation-tree-drawer-backdrop" type="button" aria-label="关闭" onClick={() => closeAction()} />
      <section ref={rootMenuRef} role="menu" aria-label="对话树操作" data-mobile-hidden={actionLevel === "move"} data-submenu-side={desktopLayout?.submenuSide} style={desktopLayout?.style} onKeyDown={(event) => handleMenuKeyDown(event, "root")}>
        <div className="conversation-tree-drawer-title"><strong>{actionLabel}</strong><UiHint label="关闭" placement="bottom">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="关闭操作菜单" onClick={() => closeAction()}><AppIcon name="close" size={16} /></button>}</UiHint></div>
        <button role="menuitem" type="button" onClick={() => { setRenaming(action); closeAction(false); }}><AppIcon name="edit" size={16} /><span>重命名</span></button>
        <button data-open-move role="menuitem" type="button" aria-haspopup="menu" aria-expanded={actionLevel === "move"} onClick={() => setActionLevel("move")}><AppIcon name="folder" size={16} /><span>移动到</span><AppIcon name="chevronRight" size={16} /></button>
        {action.kind === "folder" ? <button role="menuitem" type="button" onClick={() => { setCreatingParentId(action.id); setCreating(true); controller.expandFolder(action.id); closeAction(false); }}><AppIcon name="folderPlus" size={16} /><span>新建子文件夹</span></button> : null}
        <button role="menuitem" className="is-danger" type="button" onClick={() => { const message = action.kind === "folder" ? "删除文件夹后，子项会移动到上一级。确定继续吗？" : "确定永久删除这条对话及其消息吗？"; if (!window.confirm(message)) return; void run(async () => { if (action.kind === "folder") await conversationRepository.deleteFolder(action.id); else await conversationRepository.deleteConversation(action.id); closeAction(false); }, "已删除"); }}><AppIcon name="trash" size={16} /><span>删除</span></button>
        {actionLevel === "move" ? <section ref={moveMenuRef} className="conversation-tree-move-menu" role="menu" aria-label="移动到文件夹" onKeyDown={(event) => handleMenuKeyDown(event, "move")}>
          <div className="conversation-tree-drawer-title"><UiHint label="返回" placement="bottom">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="返回操作菜单" onClick={() => setActionLevel("root")}><AppIcon name="back" size={16} /></button>}</UiHint><strong>移动到</strong><UiHint label="关闭" placement="bottom">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="关闭操作菜单" onClick={() => closeAction()}><AppIcon name="close" size={16} /></button>}</UiHint></div>
          <button role="menuitem" type="button" aria-current={!currentFolderId ? "true" : undefined} onClick={() => void moveActionTo()}><AppIcon name="folder" size={16} /><span>根目录</span>{!currentFolderId ? <AppIcon name="check" size={16} /> : null}</button>
          {actionFolders.map((folder) => <button role="menuitem" type="button" key={folder.id} aria-current={currentFolderId === folder.id ? "true" : undefined} onClick={() => void moveActionTo(folder.id)}><AppIcon name="folder" size={16} /><span>{folder.parentId ? "↳ " : ""}{folder.label}</span>{currentFolderId === folder.id ? <AppIcon name="check" size={16} /> : null}</button>)}
        </section> : null}
      </section>
    </div>,
    document.body,
  ) : null;

  const tree = <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={startDrag} onDragCancel={() => setActiveDragItem(null)} onDragEnd={finishDrag}><section className="conversation-tree" aria-label="对话分类">
    <div className="conversation-tree-heading"><p>对话</p><UiHint label="新建文件夹" placement="right">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="新建文件夹" onClick={() => { setCreatingParentId(undefined); setCreating(true); }}><AppIcon name="folderPlus" size={18} /></button>}</UiHint></div>
    {creating ? <form className="conversation-tree-create" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}><input autoFocus aria-label="新文件夹名称" placeholder="文件夹名称" value={draftLabel} onChange={(event) => setDraftLabel(event.currentTarget.value)} /><button type="submit">创建</button><button type="button" onClick={() => setCreating(false)}>取消</button></form> : null}
    {activeDragItem ? <TreeDropZone dropId="root" dataDropRootTarget className="conversation-tree-root-target"><AppIcon name="back" size={16} /><span>移到根目录</span></TreeDropZone> : null}
    <TreeDropZone dropId="root-surface" dataDropRoot className="conversation-tree-root">
      {rootFolders.map((folder) => renderFolder(folder))}{rootChats.map(renderConversation)}
    </TreeDropZone>
    {!rootFolders.length && !rootChats.length ? <p className="conversation-tree-empty">发送首条消息后自动保存。</p> : null}
  </section><DragOverlay>{activeDragItem ? <div className="conversation-tree-drag-overlay"><AppIcon name={activeDragItem.kind === "folder" ? "folder" : "message"} size={16} /><span>{activeDragItem.label}</span></div> : null}</DragOverlay></DndContext>;
  return <>{tree}{actionDrawer}</>;
}
