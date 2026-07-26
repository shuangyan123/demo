"use client";

import { useEffect, useMemo, useState } from "react";
import { reduceAiActivityRuns, subscribeAiActivity, type AiActivityRun } from "../../../services/ai-activity-events";
import { AppIcon } from "../app-icon";
import { cx } from "../ui-primitives";
import { CompactAiTestCard } from "./compact-ai-test-card";

/**
 * 应用级 AI 活动宿主。
 * 对话运行由消息流内的工具摘要承载；这里只展示连接测试和后台任务的最小状态。
 */
export function AiInteractionPanel() {
  const [runs, setRuns] = useState<AiActivityRun[]>([]);

  useEffect(() => subscribeAiActivity((event) => {
    const presentation = event.presentation ?? "conversation";
    if (presentation === "conversation") return;
    setRuns((current) => reduceAiActivityRuns(current, { ...event, presentation }));
  }), []);

  const visibleRun = useMemo(
    () => runs.find((run) => run.presentation === "compact-test")
      ?? runs.find((run) => run.presentation === "background"),
    [runs],
  );
  if (!visibleRun) return null;

  const dismiss = () => setRuns((current) => current.filter((run) => run.id !== visibleRun.id));
  if (visibleRun.presentation === "compact-test") {
    return <CompactAiTestCard run={visibleRun} onDismiss={dismiss} />;
  }

  return (
    <aside
      aria-live="polite"
      className="fixed right-4 top-[calc(var(--chrome-topbar-height,52px)+1rem)] z-50 flex w-[min(24rem,calc(100vw-1.25rem))] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-xl"
      role="status"
    >
      <span className={cx(
        "h-2.5 w-2.5 shrink-0 rounded-full",
        visibleRun.state === "done" && "bg-green",
        visibleRun.state === "error" && "bg-red",
        visibleRun.state === "running" && "animate-pulse bg-amber-500",
      )} />
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{visibleRun.purpose ?? visibleRun.module ?? visibleRun.label}</strong>
        <span className="block truncate text-xs text-muted">{visibleRun.error ?? visibleRun.steps.at(-1)?.text ?? "正在处理"}</span>
      </div>
      <button aria-label="关闭后台任务状态" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-muted" type="button" onClick={dismiss}>
        <AppIcon name="close" size={16} />
      </button>
    </aside>
  );
}
