"use client";

/**
 * 连接测试只展示最小必要诊断，不复用包含对话列表和输入栏的全局活动面板。
 */
import { useEffect } from "react";
import type { AiActivityRun } from "../../../services/ai-activity-events";
import { ProviderIcon } from "../provider-icon";
import { Button, Chip, cx } from "../ui-primitives";

type CompactAiTestCardProps = {
  run: AiActivityRun;
  onDismiss: () => void;
};

/** 只复制脱敏后的归一化状态，不包含请求体、密钥或厂商原始响应。 */
function buildSafeDiagnostic(run: AiActivityRun): string {
  return [
    `provider=${run.provider ?? "unknown"}`,
    `model=${run.model ?? "unknown"}`,
    `state=${run.state}`,
    `durationMs=${Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.startedAt))}`,
    run.error ? `error=${run.error}` : "result=ok",
  ].join("\n");
}

/** 渲染 352px 紧凑测试卡；成功可自动收起，失败保留供诊断。 */
export function CompactAiTestCard({ run, onDismiss }: CompactAiTestCardProps) {
  const duration = Math.max(0, Date.parse(run.updatedAt) - Date.parse(run.startedAt));

  useEffect(() => {
    if (run.state !== "done") return;
    const timer = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(timer);
  }, [onDismiss, run.state]);

  return (
    <aside className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-1.25rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-2xl" aria-label="连接测试结果" role="status">
      <header className="flex min-h-12 items-center gap-3 border-b border-line px-3 py-2">
        {run.provider ? <ProviderIcon provider={run.provider} size={28} /> : null}
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm">{run.connectionLabel ?? "连接测试"}</strong>
          <span className="block truncate text-xs text-muted">{run.model ?? "等待模型"}</span>
        </div>
        <Chip tone={run.state === "error" ? "red" : run.state === "done" ? "green" : "blue"}>{run.state === "error" ? "失败" : run.state === "done" ? "成功" : "测试中"}</Chip>
        <Button aria-label="关闭连接测试结果" size="sm" variant="ghost" onClick={onDismiss}>×</Button>
      </header>
      <div className="max-h-[50vh] overflow-y-auto px-3 py-3">
        <ol className="grid gap-2">
          {run.steps.map((step) => (
            <li key={step.id} className="grid min-h-8 grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2 text-sm">
              <span className={cx("h-2 w-2 rounded-full", step.state === "done" && "bg-green", step.state === "error" && "bg-red", step.state === "running" && "bg-blue", step.state === "pending" && "bg-slate-300")} />
              <span className="truncate">{step.label}</span>
              <span className="max-w-28 truncate text-xs text-muted">{step.text}</span>
            </li>
          ))}
        </ol>
        <div className={cx("mt-3 rounded-md px-3 py-2 text-sm", run.state === "error" ? "bg-red/5 text-danger" : "bg-surface-muted")}>
          <div className="flex items-center justify-between gap-3">
            <strong>{run.state === "error" ? "请求失败" : run.state === "done" ? "连接可用" : "正在验证"}</strong>
            {duration ? <span className="text-xs text-muted">{duration} ms</span> : null}
          </div>
          {run.error ? <p className="mt-1 line-clamp-3 text-xs leading-5">{run.error}</p> : null}
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
        {run.state === "error" ? <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(buildSafeDiagnostic(run))}>复制脱敏诊断</Button> : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>关闭</Button>
      </footer>
    </aside>
  );
}
