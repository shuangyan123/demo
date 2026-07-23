"use client";

import { useMemo, useState } from "react";
import type { BulkSelectionState } from "../../types/domains/review.ts";

// 管理列表页批量选择状态；visibleIds 改变时会自动剔除已经不可见的旧选择，避免误删筛选外数据。
export function useBulkSelection<TId extends string>(visibleIds: TId[]) {
  const [selectedIds, setSelectedIds] = useState<Set<TId>>(() => new Set());

  // 根据当前可见 ID 生成快速查找表，同时把选择状态派生成工具栏需要的统计信息。
  const state = useMemo<BulkSelectionState<TId>>(() => {
    const visibleSet = new Set(visibleIds);
    const ids = new Set(Array.from(selectedIds).filter((id) => visibleSet.has(id)));
    return {
      ids,
      count: ids.size,
      hasSelection: ids.size > 0,
      allVisibleSelected: visibleIds.length > 0 && visibleIds.every((id) => ids.has(id)),
    };
  }, [selectedIds, visibleIds]);

  // 切换单条记录是否选中，保持 Set 不被原地修改，便于 React 正确触发渲染。
  function toggle(id: TId, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  // 选中当前筛选结果中的全部可见记录，批量操作不会跨越用户当前筛选边界。
  function selectAllVisible() {
    setSelectedIds(new Set(visibleIds));
  }

  // 清空批量选择，常用于删除或导出完成后的状态复位。
  function clear() {
    setSelectedIds(new Set());
  }

  return {
    state,
    toggle,
    selectAllVisible,
    clear,
  };
}
