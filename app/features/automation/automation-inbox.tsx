"use client";

import { useState } from "react";
import { automationFailureLabel, automationRecoveryLabel } from "../../services/automation-failure";
import type { AutomationRecoveryAction, AutomationRun } from "../../types/review";
import { Button, EmptyState, Panel } from "../shared/ui-primitives";
import { AutomationSummaryList } from "./automation-editor";
import type { AutomationCenter } from "./use-automation-center";
import { automationErrorMessage, formatAutomationDate } from "./automation-ui";

/** 渲染本地运行收件箱及通知、已读操作。 */
export function AutomationInbox({
  center,
  onNotice,
  onRecoveryAction,
}: {
  center: AutomationCenter;
  onNotice: (message: string) => void;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string>();

  /** 捕获收件箱动作错误并转成即时中文反馈。 */
  function runAction(task: Promise<unknown>, fallback: string): void {
    void task.catch((error) => onNotice(automationErrorMessage(error, fallback)));
  }

  return (
    <Panel title={`运行收件箱${center.snapshot.unreadCount ? ` · ${center.snapshot.unreadCount} 未读` : ""}`} eyebrow="结果仅供确认，不会自动修改业务数据">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => runAction(center.requestNotifications(), "浏览器通知开启失败")}>开启浏览器通知</Button>
        <Button variant="outline" disabled={!center.snapshot.unreadCount} onClick={() => runAction(center.markAllRead(), "收件箱更新失败")}>全部标为已读</Button>
      </div>
      {center.snapshot.runs.length ? (
        <div className="grid gap-3">
          {center.snapshot.runs.map((run) => (
            <article key={run.id} className={`rounded-xl border p-4 ${run.unread ? "border-blue bg-blue/5" : "border-line bg-surface"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{run.automationName}</strong>
                <span className={`text-xs ${run.status === "failed" ? "text-danger" : "text-muted"}`}>
                  {run.status === "failed" ? "失败" : run.status === "succeeded" ? "已完成" : "运行中"} · {formatAutomationDate(run.startedAt || run.createdAt)}
                </span>
              </div>
              {run.missedCount > 0 ? <p className="mt-2 text-xs text-muted">本次为合并补跑，跳过 {run.missedCount} 个旧周期。</p> : null}
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{run.result || run.error || "正在生成结果…"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setExpandedRunId((current) => current === run.id ? undefined : run.id)}>
                  {expandedRunId === run.id ? "收起详情" : "查看详情"}
                </Button>
                {run.unread ? <Button variant="outline" onClick={() => runAction(center.markRead(run.id), "运行记录更新失败")}>标为已读</Button> : null}
              </div>
              {expandedRunId === run.id ? <AutomationRunDetails run={run} onRecoveryAction={onRecoveryAction} /> : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState><strong>收件箱为空</strong><p className="mt-2">任务完成或失败后都会在这里留下可追溯记录。</p></EmptyState>
      )}
    </Panel>
  );
}

/** 展示运行详情，只读取运行记录摘要，不展示完整上下文。 */
function AutomationRunDetails({
  run,
  onRecoveryAction,
}: {
  run: AutomationRun;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
}) {
  const failed = run.status === "failed";
  return (
    <div className="mt-4 rounded-lg border border-line bg-background p-3">
      <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
        <span>触发方式：{run.trigger === "manual" ? "手动" : run.trigger === "catchup" ? "合并补跑" : "计划任务"}</span>
        <span>计划时间：{formatAutomationDate(run.scheduledAt)}</span>
        <span>开始时间：{formatAutomationDate(run.startedAt)}</span>
        <span>完成时间：{formatAutomationDate(run.finishedAt)}</span>
        <span>上下文规模：约 {run.contextCharCount ?? 0} 字符</span>
        <span>提案引用：{run.proposalIds.length} 条</span>
      </div>
      {run.contextSummary?.length ? (
        <div className="mt-3">
          <strong className="text-sm">读取摘要</strong>
          <AutomationSummaryList summary={run.contextSummary} />
        </div>
      ) : null}
      {failed ? (
        <div className="mt-3 rounded-lg border border-red/20 bg-red/5 p-3">
          <strong className="text-sm text-danger">{automationFailureLabel(run.failureCategory)}</strong>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{run.error}</p>
          {run.failureRecoveryAction && run.failureRecoveryAction !== "none" ? (
            <Button className="mt-3" size="sm" variant="outline" onClick={() => onRecoveryAction(run.failureRecoveryAction!)}>
              {automationRecoveryLabel(run.failureRecoveryAction)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
