"use client";

import { useRef, useState } from "react";

/** 仅保存本轮 UI 进度；学习事实与完成语义仍由 repository 提交和共享快照决定。 */
export function useLearningSubmission(onRefresh: () => Promise<void>, onNotice: (message: string) => void) {
  const [committedIds, setCommittedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const inFlight = useRef(false);
  const savedIds = useRef(new Set<string>());

  function reset() {
    if (inFlight.current || refreshFailed) return;
    savedIds.current.clear();
    setCommittedIds([]);
  }

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // 只重读快照，绝不因刷新失败重放已完成的写入。
      await onRefresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
      onNotice("结果已保存，学习状态刷新失败，请重新读取。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function record(id: string, commit: () => Promise<void>, message: string) {
    if (inFlight.current || refreshFailed || savedIds.current.has(id)) return;
    inFlight.current = true;
    setBusy(true);
    let committed = false;
    try {
      await commit();
      committed = true;
      savedIds.current.add(id);
      setCommittedIds([...savedIds.current]);
      await onRefresh();
      onNotice(message);
    } catch {
      setRefreshFailed(committed);
      onNotice(committed ? "结果已保存，学习状态刷新失败，请重新读取。" : "结果保存失败，请检查本地数据后再提交。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, committedIds, record, refresh, refreshFailed, reset };
}
