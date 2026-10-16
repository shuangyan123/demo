"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { conversationRepository } from "../../services/conversation-repository";
import type { AiConversation, AiProjectPartition } from "../../types/domains/conversation.ts";
import { useConversationTreeController } from "./use-conversation-tree-controller.ts";
import { AppIcon } from "../shared/app-icon";
import { announceInteractiveOverlayOpen } from "../shared/ui-overlay-events";
import { UiHint } from "../shared/ui-tooltip";

type TreeDragItem = { kind: "partition" | "conversation"; id: string; label: string };

/** 分区和对话名称区域直接承担拖拽，不再额外占用六点手柄列。 */
function TreeDragSurface({ item, className, active, onClick, children }: { item: TreeDragItem; className: string; active?: boolean; onClick?: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `drag:${item.kind}:${item.id}`, data: item });
  return <button ref={setNodeRef} aria-current={active ? "page" : undefined} className={className} type="button" onClick={onClick} {...attributes} {...listeners}>{children}</button>;
}

/** 分区与项目根目录共用的放置边界。 */
function TreeDropZone({ partitionId, dropId, active, dataDropRoot, dataDropRootTarget, className, children }: { partitionId?: string; dropId?: string; active?: boolean; dataDropRoot?: boolean; dataDropRootTarget?: boolean; className: string; children: ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: dropId ?? (partitionId ? `partition:${partitionId}` : "root"), data: { partitionId } });
  return <div ref={setNodeRef} data-drop-root={dataDropRoot ? "" : undefined} data-drop-root-target={dataDropRootTarget ? "" : undefined} className={`${className} ${isOver || active ? "is-drop-target" : ""}`}>{children}</div>;
}

type ConversationPartitionTreeProps = {
  activeConversationId?: string | null;
  conversations: AiConversation[];
  partitions: AiProjectPartition[];
  projectId: string;
  onConversationSelected: (id: string) => void;
  onNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
};

/** 项目分区树：分区默认折叠，桌面拖拽和移动端操作层共享同一仓储操作。 */
export function ConversationPartitionTree(props: ConversationPartitionTreeProps) {
  const { activeConversationId, conversations, partitions, projectId, onConversationSelected, onNotice, onRefresh } = props;
  const controller = useConversationTreeController();
  const [creatingParentId, setCreatingParentId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [activeDragItem, setActiveDragItem] = useState<TreeDragItem | null>(null);
  const [actionAnchor, setActionAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null);
  const [actionLevel, setActionLevel] = useState<"root" | "move">("root");
  const [renaming, setRenaming] = useState<{ kind: "partition" | "conversation"; id: string } | null>(null);
  const cancelRenameRef = useRef(false);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const rootMenuRef = useRef<HTMLElement | null>(null);
  const moveMenuRef = useRef<HTMLElement | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const projectPartitions = useMemo(() => partitions.filter((partition) => partition.projectId === projectId), [partitions, projectId]);
  const projectConversations = useMemo(() => conversations.filter((item) => item.projectId === projectId && item.status === "active"), [conversations, projectId]);
  const [partitionSectionOpen, setPartitionSectionOpen] = useState(true);
  const childrenByPartition = useMemo(() => {
    const next = new Map<string, AiProjectPartition[]>();
    for (const partition of projectPartitions) {
      if (!partition.parentId) continue;
      next.set(partition.parentId, [...(next.get(partition.parentId) ?? []), partition]);
    }
    for (const children of next.values()) children.sort((left, right) => left.sortOrder - right.sortOrder);
    return next;
  }, [projectPartitions]);
  const conversationsByPartition = useMemo(() => {
    const next = new Map<string, AiConversation[]>();
    for (const conversation of projectConversations) {
      const partitionId = conversation.partitionId ?? conversation.folderId;
      if (!partitionId) continue;
      next.set(partitionId, [...(next.get(partitionId) ?? []), conversation]);
    }
    return next;
  }, [projectConversations]);

  function partitionConversationCount(partitionId: string): number {
    const pending = [partitionId];
    const visited = new Set<string>();
    let count = 0;
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      count += conversationsByPartition.get(current)?.length ?? 0;
      for (const child of childrenByPartition.get(current) ?? []) pending.push(child.id);
    }
    return count;
  }

  async function run(task: () => Promise<void>, success?: string) {
    try { await task(); await onRefresh(); if (success) onNotice(success); }
    catch (error) { onNotice(error instanceof Error ? error.message : "对话树操作失败"); }
  }

  async function createPartition() {
    if (createPending) return;
    // 落库与父级刷新完成前保持单次操作，避免旧任务关闭后来打开的表单。
    setCreatePending(true);
    try {
      const partition = await conversationRepository.createPartition({ projectId, parentId: creatingParentId, label: draftLabel });
      controller.expandPartition(partition.id);
      setPartitionSectionOpen(true);
      setCreating(false); setDraftLabel(""); setCreatingParentId(undefined);
      await onRefresh();
      onNotice("分区已创建");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "分区创建失败");
    } finally {
      setCreatePending(false);
    }
  }

  async function moveInto(item: TreeDragItem, partitionId?: string) {
    if (item.kind === "partition") await run(() => conversationRepository.movePartition(item.id, partitionId), "分区已移动");
    else await run(() => conversationRepository.moveConversationToPartition(item.id, partitionId), "对话已移动");
    if (partitionId) controller.expandPartition(partitionId);
  }

  function startDrag(event: DragStartEvent) {
    const item = event.active.data.current as TreeDragItem | undefined;
    if (item) setActiveDragItem(item);
  }

  function finishDrag(event: DragEndEvent) {
    const item = event.active.data.current as TreeDragItem | undefined;
    const partitionId = event.over?.id === "root" || event.over?.id === "root-surface" ? undefined : event.over?.data.current?.partitionId as string | undefined;
    setActiveDragItem(null);
    if (item && event.over) void moveInto(item, partitionId);
  }

  /** 右键与省略号统一读取当前行操作按钮的位置，避免同一菜单出现两套坐标语义。 */
  function openAction(kind: "partition" | "conversation", id: string, label: string, anchor: HTMLElement | null) {
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

  async function finishRename(kind: "partition" | "conversation", id: string) {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      setRenaming(null);
      return;
    }
    await run(async () => { if (kind === "partition") await conversationRepository.renamePartition(id, actionLabel); else await conversationRepository.renameConversation(id, actionLabel); }, "已重命名");
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
    const active = activeConversationId === conversation.id;
    return <div key={conversation.id} data-conversation-active={active ? "true" : undefined} data-conversation-id={conversation.id} data-mobile-sidebar-close="true" className={`conversation-tree-chat ${active ? "is-active" : ""}`} onContextMenu={(event) => { event.preventDefault(); openAction("conversation", conversation.id, conversation.title, event.currentTarget.querySelector<HTMLElement>("[data-tree-action-trigger]")); }}>
      <span className="conversation-tree-disclosure-slot" aria-hidden="true" />
      {renaming?.kind === "conversation" && renaming.id === conversation.id ? <input autoFocus aria-label={`重命名${conversation.title}`} className="conversation-tree-inline-rename" value={actionLabel} onChange={(event) => setActionLabel(event.currentTarget.value)} onBlur={() => void finishRename("conversation", conversation.id)} onKeyDown={handleRenameKeyDown} /> : <TreeDragSurface active={active} className="conversation-tree-chat-label" item={{ kind: "conversation", id: conversation.id, label: conversation.title }} onClick={() => onConversationSelected(conversation.id)}><AppIcon name="message" size={16} /><span className="truncate">{conversation.title}</span></TreeDragSurface>}
      <UiHint label="更多操作" placement="right">{({ describedBy }) => <button data-tree-action-trigger type="button" aria-describedby={describedBy} aria-label={`${conversation.title} 操作`} onClick={(event) => openAction("conversation", conversation.id, conversation.title, event.currentTarget)}><AppIcon name="more" size={16} /></button>}</UiHint>
    </div>;
  }

  function renderPartition(partition: AiProjectPartition): ReactNode {
    const children = childrenByPartition.get(partition.id) ?? [];
    const chats = conversationsByPartition.get(partition.id) ?? [];
    const expanded = controller.expandedPartitionIds.has(partition.id);
    const hasChildren = children.length > 0 || chats.length > 0;
    const count = partitionConversationCount(partition.id);
    return <div key={partition.id} data-partition-id={partition.id} className="conversation-tree-folder" onContextMenu={(event) => { event.preventDefault(); openAction("partition", partition.id, partition.label, event.currentTarget.querySelector<HTMLElement>("[data-tree-action-trigger]")); }}>
      <TreeDropZone partitionId={partition.id} className="conversation-tree-folder-row">
        {hasChildren ? <UiHint label={expanded ? "折叠" : "展开"} placement="right">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-expanded={expanded} aria-label={`${expanded ? "折叠" : "展开"}${partition.label}`} onClick={() => controller.togglePartition(partition.id)}><AppIcon name={expanded ? "chevronDown" : "chevronRight"} size={16} /></button>}</UiHint> : <span className="conversation-tree-disclosure-slot" aria-hidden="true" />}
        {renaming?.kind === "partition" && renaming.id === partition.id ? <input autoFocus aria-label={`重命名${partition.label}`} className="conversation-tree-inline-rename" value={actionLabel} onChange={(event) => setActionLabel(event.currentTarget.value)} onBlur={() => void finishRename("partition", partition.id)} onKeyDown={handleRenameKeyDown} /> : <TreeDragSurface className="conversation-tree-folder-label" item={{ kind: "partition", id: partition.id, label: partition.label }}><AppIcon name={expanded ? "folderOpen" : "folder"} size={16} /><span className="truncate">{partition.label}</span>{count ? <small>{count}</small> : null}</TreeDragSurface>}
        <UiHint label="更多操作" placement="right">{({ describedBy }) => <button data-tree-action-trigger type="button" aria-describedby={describedBy} aria-label={`${partition.label} 操作`} onClick={(event) => openAction("partition", partition.id, partition.label, event.currentTarget)}><AppIcon name="more" size={16} /></button>}</UiHint>
      </TreeDropZone>
      {expanded ? <div className="conversation-tree-children">{children.map(renderPartition)}{chats.map(renderConversation)}</div> : null}
    </div>;
  }

  const rootPartitions = projectPartitions.filter((partition) => !partition.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const rootChats = projectConversations.filter((conversation) => !(conversation.partitionId ?? conversation.folderId));
  const action = controller.action;
  const actionPartition = action?.kind === "partition" ? projectPartitions.find((partition) => partition.id === action.id) : undefined;
  const actionConversation = action?.kind === "conversation" ? projectConversations.find((conversation) => conversation.id === action.id) : undefined;
  const currentPartitionId = actionPartition?.parentId ?? (actionConversation?.partitionId ?? actionConversation?.folderId);
  const invalidPartitionIds = useMemo(() => {
    if (action?.kind !== "partition") return new Set<string>();
    const invalid = new Set([action.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const partition of projectPartitions) {
        if (partition.parentId && invalid.has(partition.parentId) && !invalid.has(partition.id)) {
          invalid.add(partition.id);
          changed = true;
        }
      }
    }
    return invalid;
  }, [action, projectPartitions]);
  const actionPartitions = projectPartitions.filter((partition) => !invalidPartitionIds.has(partition.id));
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
  async function moveActionTo(targetPartitionId?: string) {
    if (!action) return;
    await run(async () => {
      if (action.kind === "partition") await conversationRepository.movePartition(action.id, targetPartitionId);
      else await conversationRepository.moveConversationToPartition(action.id, targetPartitionId);
      closeAction(false);
    }, "已移动");
  }
  const actionDrawer = action && typeof document !== "undefined" ? createPortal(
    <div className="conversation-tree-drawer" role="presentation"><button className="conversation-tree-drawer-backdrop" type="button" aria-label="关闭" onClick={() => closeAction()} />
      <section ref={rootMenuRef} role="menu" aria-label="分区和对话操作" data-mobile-hidden={actionLevel === "move"} data-submenu-side={desktopLayout?.submenuSide} style={desktopLayout?.style} onKeyDown={(event) => handleMenuKeyDown(event, "root")}>
        <div className="conversation-tree-drawer-title"><strong>{actionLabel}</strong><UiHint label="关闭" placement="bottom">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="关闭操作菜单" onClick={() => closeAction()}><AppIcon name="close" size={16} /></button>}</UiHint></div>
        <button role="menuitem" type="button" onClick={() => { setRenaming(action); closeAction(false); }}><AppIcon name="edit" size={16} /><span>重命名</span></button>
        <button data-open-move role="menuitem" type="button" aria-haspopup="menu" aria-expanded={actionLevel === "move"} onClick={() => setActionLevel("move")}><AppIcon name="folder" size={16} /><span>移动到分区</span><AppIcon name="chevronRight" size={16} /></button>
        {action.kind === "partition" ? <button role="menuitem" type="button" disabled={createPending} onClick={() => { setCreatingParentId(action.id); setCreating(true); setPartitionSectionOpen(true); controller.expandPartition(action.id); closeAction(false); }}><AppIcon name="folderPlus" size={16} /><span>新建子分区</span></button> : null}
        <button role="menuitem" className="is-danger" type="button" onClick={() => { const message = action.kind === "partition" ? "删除分区后，子项和对话会移动到上一级。确定继续吗？" : "确定永久删除这条对话及其消息吗？"; if (!window.confirm(message)) return; void run(async () => { if (action.kind === "partition") await conversationRepository.deletePartition(action.id); else await conversationRepository.deleteConversation(action.id); closeAction(false); }, "已删除"); }}><AppIcon name="trash" size={16} /><span>删除</span></button>
        {actionLevel === "move" ? <section ref={moveMenuRef} className="conversation-tree-move-menu" role="menu" aria-label="移动到分区" onKeyDown={(event) => handleMenuKeyDown(event, "move")}>
          <div className="conversation-tree-drawer-title"><UiHint label="返回" placement="bottom">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="返回操作菜单" onClick={() => setActionLevel("root")}><AppIcon name="back" size={16} /></button>}</UiHint><strong>移动到</strong><UiHint label="关闭" placement="bottom">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="关闭操作菜单" onClick={() => closeAction()}><AppIcon name="close" size={16} /></button>}</UiHint></div>
          <button role="menuitem" type="button" aria-current={!currentPartitionId ? "true" : undefined} onClick={() => void moveActionTo()}><AppIcon name="folder" size={16} /><span>项目根目录</span>{!currentPartitionId ? <AppIcon name="check" size={16} /> : null}</button>
          {actionPartitions.map((partition) => <button role="menuitem" type="button" key={partition.id} aria-current={currentPartitionId === partition.id ? "true" : undefined} onClick={() => void moveActionTo(partition.id)}><AppIcon name="folder" size={16} /><span>{partition.parentId ? "↳ " : ""}{partition.label}</span>{currentPartitionId === partition.id ? <AppIcon name="check" size={16} /> : null}</button>)}
        </section> : null}
      </section>
    </div>,
    document.body,
  ) : null;

  const tree = <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={startDrag} onDragCancel={() => setActiveDragItem(null)} onDragEnd={finishDrag}><section className="conversation-tree conversation-partition-tree" aria-label="分区和对话">
    <div className="conversation-tree-heading"><div className="conversation-tree-section-title"><button type="button" aria-expanded={partitionSectionOpen} aria-label={`${partitionSectionOpen ? "折叠" : "展开"}分区`} onClick={() => setPartitionSectionOpen((open) => !open)}><AppIcon name={partitionSectionOpen ? "chevronDown" : "chevronRight"} size={16} /></button><p>分区</p></div><UiHint label="新建分区" placement="right">{({ describedBy }) => <button type="button" aria-describedby={describedBy} aria-label="新建分区" data-partition-create="true" disabled={createPending} onClick={() => { setCreatingParentId(undefined); setCreating(true); setPartitionSectionOpen(true); }}><AppIcon name="folderPlus" size={18} /></button>}</UiHint></div>
    {creating ? <form className="conversation-tree-create" aria-label="新建分区" aria-busy={createPending} onSubmit={(event) => { event.preventDefault(); void createPartition(); }}><h3>新建分区</h3><label htmlFor="conversation-partition-name">分区名称</label><input id="conversation-partition-name" autoFocus aria-label="分区名称" placeholder="例如：资料分析" value={draftLabel} disabled={createPending} onChange={(event) => setDraftLabel(event.currentTarget.value)} /><div><button type="submit" disabled={createPending}>创建</button><button type="button" disabled={createPending} onClick={() => { setCreating(false); setDraftLabel(""); setCreatingParentId(undefined); }}>取消</button></div></form> : null}
    {activeDragItem ? <TreeDropZone dropId="root" dataDropRootTarget className="conversation-tree-root-target"><AppIcon name="back" size={16} /><span>移到根目录</span></TreeDropZone> : null}
    <TreeDropZone dropId="root-surface" dataDropRoot className="conversation-tree-root">
      {partitionSectionOpen ? rootPartitions.map((partition) => renderPartition(partition)) : null}{rootChats.map(renderConversation)}
    </TreeDropZone>
    {!rootPartitions.length && !rootChats.length ? <p className="conversation-tree-empty">发送首条消息后自动保存。</p> : null}
  </section><DragOverlay>{activeDragItem ? <div className="conversation-tree-drag-overlay"><AppIcon name={activeDragItem.kind === "partition" ? "folder" : "message"} size={16} /><span>{activeDragItem.label}</span></div> : null}</DragOverlay></DndContext>;
  return <>{tree}{actionDrawer}</>;
}

/** @deprecated UI callers should import ConversationPartitionTree. */
export const ConversationFolderTree = ConversationPartitionTree;
