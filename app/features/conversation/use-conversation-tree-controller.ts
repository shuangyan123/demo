"use client";

import { useRef, useState } from "react";

export type ConversationTreeAction = { kind: "folder" | "conversation"; id: string };
export type ConversationTreeDrag = { kind: "folder" | "conversation"; id: string };

/** 集中维护树展开、拖拽和操作抽屉，视图组件只负责渲染节点。 */
export function useConversationTreeController() {
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [dragItem, setDragItem] = useState<ConversationTreeDrag | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null | undefined>();
  const [action, setAction] = useState<ConversationTreeAction | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  function toggleFolder(id: string) {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandFolder(id: string) {
    setExpandedFolderIds((current) => new Set(current).add(id));
  }

  function hoverFolder(id: string) {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => expandFolder(id), 500);
  }

  function endDrag() {
    window.clearTimeout(hoverTimer.current);
    setDragItem(null);
    setDropFolderId(undefined);
  }

  return { action, dragItem, dropFolderId, expandedFolderIds, endDrag, expandFolder, hoverFolder, setAction, setDragItem, setDropFolderId, toggleFolder };
}
