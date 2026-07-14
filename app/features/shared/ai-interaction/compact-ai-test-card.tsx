"use client";

/**
 * 连接测试只展示最小必要诊断，不复用包含对话列表和输入栏的全局活动面板。
 */
import { useEffect } from "react";
import type { AiActivityRun } from "../../../services/ai-activity-events";
import { getProviderContract } from "../../../services/provider-contracts";
import { AppIcon } from "../app-icon";
import { ProviderIcon } from "../provider-icon";
import { Button, cx } from "../ui-primitives";

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
  const providerLabel = run.provider ? getProviderContract(run.provider).label : run.connectionLabel ?? "连接测试";
  const requestStep = run.steps.find((step) => step.id === "request") ?? run.steps.find((step) => step.label.includes("调用"));
  const contextStep = run.steps.find((step) => step.id === "context") ?? run.steps[0];
  const stages = [
    { label: "正在连接到服务", done: Boolean(contextStep) || run.state !== "running", error: false },
    { label: "验证 API Key", done: contextStep?.state === "done" || run.state === "done", error: contextStep?.state === "error" },
    { label: "发送测试请求", done: requestStep?.state === "done" || run.state === "done", error: requestStep?.state === "error" },
    { label: "接收响应", done: run.state === "done", error: run.state === "error" },
  ];

  useEffect(() => {
    if (run.state !== "done") return;
    const timer = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(timer);
  }, [onDismiss, run.state]);

  return (
    <aside className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-1.25rem))] overflow-hidden rounded-[10px] border border-line bg-surface shadow-2xl" aria-label="连接测试结果" aria-live="polite" role="region">
      <header className="flex min-h-14 items-center gap-3 border-b border-line px-3 py-2.5">
        {run.provider ? <ProviderIcon provider={run.provider} size={28} /> : null}
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-medium">{providerLabel}</strong>
          <span className="block truncate text-xs text-muted">模型：{run.model ?? "等待模型"}</span>
        </div>
        <button aria-label="关闭连接测试结果" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground" type="button" onClick={onDismiss}><AppIcon name="close" size={16} /></button>
      </header>
      <div className="max-h-[50vh] overflow-y-auto px-3 py-3">
        <ol className="grid">
          {stages.map((stage) => (
            <li key={stage.label} className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
              <span className="truncate text-muted">{stage.label}</span>
              <span className={cx("inline-flex items-center gap-1 text-xs", stage.error ? "text-danger" : stage.done ? "text-green" : "text-muted")}>
                {stage.error ? "失败" : stage.done ? "已完成" : "进行中"}
                {stage.done && !stage.error ? <AppIcon name="check" size={16} /> : null}
              </span>
            </li>
          ))}
        </ol>
        <div className={cx("mt-3 border-t border-line pt-3 text-sm", run.state === "error" ? "text-danger" : "text-green")}>
          <div className="flex items-center justify-between gap-3">
            <strong>{run.state === "error" ? "连接失败" : run.state === "done" ? "连接成功" : "正在验证"}</strong>
            {duration ? <span className="rounded bg-green/10 px-2 py-1 text-xs text-green">{duration}ms</span> : null}
          </div>
          {run.error ? <p className="mt-1 line-clamp-3 text-xs leading-5">{run.error}</p> : null}
        </div>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(buildSafeDiagnostic(run))}>复制诊断信息</Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>关闭</Button>
      </footer>
    </aside>
  );
}
