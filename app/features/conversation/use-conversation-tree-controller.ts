"use client";

import { useRef, useState } from "react";

export type ConversationTreeAction = { kind: "partition" | "conversation"; id: string };
export type ConversationTreeDrag = { kind: "partition" | "conversation"; id: string };

/** 集中维护树展开、拖拽和操作抽屉，视图组件只负责渲染节点。 */
export function useConversationTreeController() {
  const [expandedPartitionIds, setExpandedPartitionIds] = useState<Set<string>>(() => new Set());
  const [dragItem, setDragItem] = useState<ConversationTreeDrag | null>(null);
  const [dropPartitionId, setDropPartitionId] = useState<string | null | undefined>();
  const [action, setAction] = useState<ConversationTreeAction | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  function togglePartition(id: string) {
    setExpandedPartitionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandPartition(id: string) {
    setExpandedPartitionIds((current) => new Set(current).add(id));
  }

  function hoverPartition(id: string) {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => expandPartition(id), 500);
  }

  function endDrag() {
    window.clearTimeout(hoverTimer.current);
    setDragItem(null);
    setDropPartitionId(undefined);
  }

  return { action, dragItem, dropPartitionId, expandedPartitionIds, endDrag, expandPartition, hoverPartition, setAction, setDragItem, setDropPartitionId, togglePartition };
}
