"use client";

import { useCallback, useState } from "react";

type VisibleLimitState = {
  limit: number;
  resetKey: string;
};

// 管理大列表的渐进显示数量；筛选 key 变化时无需 effect，渲染期直接回到首屏数量。
export function useVisibleLimit(resetKey: string, step: number) {
  const [state, setState] = useState<VisibleLimitState>(() => ({ limit: step, resetKey }));
  const visibleLimit = state.resetKey === resetKey ? state.limit : step;
  const loadMore = useCallback(() => {
    setState((current) => {
      const currentLimit = current.resetKey === resetKey ? current.limit : step;
      return { limit: currentLimit + step, resetKey };
    });
  }, [resetKey, step]);

  return { loadMore, visibleLimit };
}
