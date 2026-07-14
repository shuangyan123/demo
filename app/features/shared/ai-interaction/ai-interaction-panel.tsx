"use client";

import { useEffect, useMemo, useState } from "react";
import { reduceAiActivityRuns, subscribeAiActivity, type AiActivityRun } from "../../../services/ai-activity-events";
import { Button, Chip, cx } from "../ui-primitives";
import { CompactAiTestCard } from "./compact-ai-test-card";

const stateLabels: Record<AiActivityRun["state"], string> = {
  running: "进行中",
  done: "完成",
  error: "错误",
};

function usageLabel(run: AiActivityRun): string {
  const usage = run.usage;
  if (!usage) return "用量待返回";
  if (usage.totalTokens) return `${usage.totalTokens} tokens`;
  return [`输入 ${usage.inputTokens ?? "-"}`, `输出 ${usage.outputTokens ?? "-"}`].join(" / ");
}

function runTitle(run: AiActivityRun): string {
  return run.threadTitle ?? run.purpose ?? run.module ?? run.label;
}

function runSubtitle(run: AiActivityRun): string {
  return [run.connectionLabel ?? "默认连接", run.model ?? "模型待返回"].filter(Boolean).join(" · ");
}

function assistantText(run: AiActivityRun): string {
  if (run.streamText) return run.streamText;
  if (run.error) return run.error;
  return run.steps.at(-1)?.text ?? "等待模型响应...";
}

/** Codex 式 AI 交互面板，把一次 AI 调用组织成会话、消息和工具步骤。 */
export function AiInteractionPanel() {
  const [runs, setRuns] = useState<AiActivityRun[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const latest = runs[0];
  const visibleRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? latest, [latest, runs, selectedRunId]);

  useEffect(() => subscribeAiActivity((event) => {
    setRuns((current) => {
      const next = reduceAiActivityRuns(current, event);
      setSelectedRunId((selected) => event.presentation === "compact-test" ? next[0]?.id : selected ?? next[0]?.id);
      return next;
    });
  }), []);

  if (!visibleRun) return null;

  if (visibleRun.presentation === "compact-test") {
    return <CompactAiTestCard run={visibleRun} onDismiss={() => {
      setRuns((current) => current.filter((run) => run.id !== visibleRun.id));
      setSelectedRunId(undefined);
    }} />;
  }

  return (
    <aside
      className={cx(
        "fixed z-40 overflow-hidden border border-line bg-surface/95 shadow-2xl backdrop-blur",
        expanded
          ? "bottom-4 right-4 top-[calc(var(--chrome-topbar-height)+1rem)] grid w-[min(78rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] rounded-lg"
          : "bottom-4 right-4 w-[min(28rem,calc(100vw-2rem))] rounded-lg",
      )}
      aria-label="AI 对话与工具链"
    >
      <button className="flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left" type="button" onClick={() => setExpanded((value) => !value)}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">AI 对话</strong>
            <Chip tone={visibleRun.state === "error" ? "red" : visibleRun.state === "done" ? "green" : "blue"}>{stateLabels[visibleRun.state]}</Chip>
          </div>
          <p className="mt-1 truncate text-xs text-muted">{runTitle(visibleRun)} · {runSubtitle(visibleRun)}</p>
        </div>
        <span className="text-xs text-muted">{expanded ? "收起" : "展开"}</span>
      </button>

      {!expanded ? (
        <div className="grid gap-3 px-4 py-3">
          <div className="rounded-lg bg-surface-muted p-3">
            <div className="flex items-center justify-between gap-3 text-xs text-muted">
              <span>{visibleRun.purpose ?? "AI 请求"}</span>
              <span>{usageLabel(visibleRun)}</span>
            </div>
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6">{assistantText(visibleRun)}</p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-[15rem_minmax(0,1fr)_20rem] max-xl:grid-cols-[13rem_minmax(0,1fr)] max-md:grid-cols-1">
          <nav className="min-h-0 overflow-y-auto border-r border-line p-3 max-md:hidden" aria-label="AI 会话列表">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-muted">对话</span>
              {runs.length > 1 ? <Button size="sm" variant="ghost" onClick={() => setRuns((current) => current.slice(0, 1))}>清理</Button> : null}
            </div>
            <div className="grid gap-1">
              {runs.map((run) => (
                <button
                  key={run.id}
                  className={cx(
                    "rounded-lg px-3 py-2 text-left text-sm hover:bg-chrome-hover",
                    run.id === visibleRun.id && "bg-chrome-selected",
                  )}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <strong className="block truncate">{runTitle(run)}</strong>
                  <span className="mt-1 block truncate text-xs text-muted">{run.module ?? run.label}</span>
                </button>
              ))}
            </div>
          </nav>

          <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-r border-line max-xl:border-r-0" aria-label="AI 消息流">
            <header className="border-b border-line px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{runTitle(visibleRun)}</h3>
                  <p className="mt-1 truncate text-xs text-muted">{visibleRun.module ?? "AI"} · {runSubtitle(visibleRun)}</p>
                </div>
                <Chip tone={visibleRun.state === "error" ? "red" : visibleRun.state === "done" ? "green" : "blue"}>{usageLabel(visibleRun)}</Chip>
              </div>
            </header>
            <div className="min-h-0 overflow-y-auto px-5 py-5">
              <div className="mx-auto grid max-w-3xl gap-4">
                <article className="justify-self-end rounded-lg bg-chrome-selected px-4 py-3 text-sm">
                  <strong className="mb-1 block text-xs text-muted">请求</strong>
                  <p>{visibleRun.purpose ?? visibleRun.label}</p>
                </article>
                <article className={cx("justify-self-start rounded-lg px-4 py-3 text-sm leading-6", visibleRun.state === "error" ? "bg-red/5 text-danger" : "bg-surface-muted")}>
                  <strong className="mb-1 block text-xs text-muted">AI</strong>
                  <p className="whitespace-pre-wrap">{assistantText(visibleRun)}</p>
                </article>
                {visibleRun.attachments.length ? (
                  <div className="flex flex-wrap gap-2">
                    {visibleRun.attachments.map((attachment) => <Chip key={attachment.id}>{attachment.kind} · {attachment.label}</Chip>)}
                  </div>
                ) : null}
              </div>
            </div>
            <footer className="border-t border-line px-5 py-3">
              <div className="mx-auto grid max-w-3xl grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 shadow-sm max-sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <button className="grid h-8 w-8 place-items-center rounded-md text-xl text-muted hover:bg-chrome-hover" type="button" aria-label="添加附件">+</button>
                <Chip tone="red">完全访问</Chip>
                <span className="truncate text-sm text-muted">AI 活动只展示摘要、阶段、delta 和 usage，不保存 prompt 或截图正文。</span>
                <span className="text-xs text-muted max-sm:hidden">{visibleRun.model ?? "模型"}</span>
              </div>
            </footer>
          </section>

          <section className="min-h-0 overflow-y-auto p-4 max-xl:col-span-2 max-md:col-span-1" aria-label="AI 工具链步骤">
            <div className="mb-3 flex items-center justify-between gap-3">
              <strong className="text-sm">工具链</strong>
              <Chip tone={visibleRun.state === "error" ? "red" : visibleRun.state === "done" ? "green" : "blue"}>{stateLabels[visibleRun.state]}</Chip>
            </div>
            <ol className="grid gap-2">
              {visibleRun.steps.map((step) => (
                <li key={step.id} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2 text-sm">
                  <span className={cx("mt-1.5 h-2.5 w-2.5 rounded-full", step.state === "done" && "bg-green", step.state === "error" && "bg-red", step.state === "running" && "bg-blue", step.state === "pending" && "bg-slate-300")} />
                  <span className="min-w-0">
                    <strong className="block truncate">{step.label}</strong>
                    {step.text ? <span className="line-clamp-3 text-xs leading-5 text-muted">{step.text}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
  );
}
