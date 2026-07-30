"use client";

import { useState } from "react";
import { automationFailureLabel, automationRecoveryLabel } from "../../services/automation-failure";
import type { AutomationRecoveryAction, AutomationRun } from "../../types/domains/automation.ts";
import { Button, EmptyState } from "../shared/ui-primitives";
import { AutomationSummaryList } from "./automation-editor";
import styles from "./automation-workspace.module.css";
import type { AutomationCenter } from "./use-automation-center.ts";
import { automationErrorMessage, formatAutomationDate } from "./automation-ui.ts";

/** 运行收件箱：在有限侧栏宽度内展示状态、摘要和按需详情。 */
export function AutomationInbox({
  center,
  filter,
  runs,
  onFilterChange,
  onNotice,
  onRecoveryAction,
}: {
  center: AutomationCenter;
  filter: "all" | "unread" | "succeeded" | "failed";
  runs: AutomationRun[];
  onFilterChange: (value: "all" | "unread" | "succeeded" | "failed") => void;
  onNotice: (message: string) => void;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string>();

  /** 捕获收件箱动作错误并转成即时中文反馈。 */
  function runAction(task: Promise<unknown>, fallback: string): void {
    void task.catch((error) => onNotice(automationErrorMessage(error, fallback)));
  }

  return (
    <>
      <div className={styles.inboxToolbar}>
        <select
          aria-label="筛选运行收件箱"
          className={styles.select}
          value={filter}
          onChange={(event) => onFilterChange(event.currentTarget.value as typeof filter)}
        >
          <option value="all">全部运行</option>
          <option value="unread">未读优先</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
        </select>
        <Button variant="outline" disabled={!center.snapshot.unreadCount} onClick={() => runAction(center.markAllRead(), "收件箱更新失败")}>全部已读</Button>
      </div>
      {runs.length ? (
        <div className={styles.inboxList}>
          {runs.map((run) => (
            <article key={run.id} className={styles.runCard} data-status={run.status} data-unread={run.unread}>
              <button aria-label={`查看详情：${run.automationName}`} className={styles.runSummary} type="button" onClick={() => setExpandedRunId((current) => current === run.id ? undefined : run.id)}>
                <span>
                  <strong>{run.automationName}</strong>
                  <small>{run.status === "failed" ? "失败" : run.status === "succeeded" ? "成功" : "运行中"} · {formatAutomationDate(run.startedAt || run.createdAt)}</small>
                </span>
                <span>{run.unread ? "未读" : ""} ›</span>
              </button>
              <p className={styles.runExcerpt}>{run.result || run.error || "正在生成结果…"}</p>
              {run.collectionSummary ? (
                <div className={styles.metricStrip} aria-label="采集运行摘要">
                  <span>发现 <strong>{run.collectionSummary.discoveredCount}</strong></span>
                  <span>抓取 <strong>{run.collectionSummary.fetchedCount}</strong></span>
                  <span>去重 <strong>{run.collectionSummary.duplicateCount}</strong></span>
                  <span>A/B/C <strong>{run.collectionSummary.gradeA}/{run.collectionSummary.gradeB}/{run.collectionSummary.gradeC}</strong></span>
                  <span>争议 <strong>{run.collectionSummary.disputedCount}</strong></span>
                </div>
              ) : null}
              {expandedRunId === run.id ? (
                <AutomationRunDetails run={run} onRecoveryAction={onRecoveryAction} onMarkRead={() => runAction(center.markRead(run.id), "运行记录更新失败")} />
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState reviewPack={center.snapshot.runs.length ? undefined : "automation"} stateId={center.snapshot.runs.length ? "automation.inbox.filtered-empty" : "automation.inbox.empty"}>
          <div className={styles.empty}>
            <strong>{center.snapshot.runs.length ? "没有匹配的运行记录" : "收件箱为空"}</strong>
            <p className="mt-2">任务完成或失败后都会在这里留下可追溯摘要。</p>
          </div>
        </EmptyState>
      )}
      <div className={styles.inboxFooter}>
        <Button variant="outline" onClick={() => runAction(center.requestNotifications(), "浏览器通知开启失败")}>浏览器通知</Button>
        <span>共 {runs.length} 条</span>
      </div>
    </>
  );
}

/** 展示运行详情，只读取运行记录摘要，不展示完整上下文。 */
function AutomationRunDetails({
  run,
  onMarkRead,
  onRecoveryAction,
}: {
  run: AutomationRun;
  onMarkRead: () => void;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
}) {
  return (
    <div className={styles.runDetails}>
      <p>{run.result || run.error || "正在生成结果…"}</p>
      <div className={styles.detailGrid}>
        <span>触发方式：{run.trigger === "manual" ? "手动" : run.trigger === "catchup" ? "合并补跑" : "计划任务"}</span>
        <span>上下文规模：约 {run.contextCharCount ?? 0} 字符</span>
        <span>完成：{formatAutomationDate(run.finishedAt)}</span>
        <span>提案引用：{run.proposalIds.length} 条</span>
      </div>
      {run.collectionSummary ? (
        <p className="text-xs text-muted">
          A 级 {run.collectionSummary.gradeA} · B 级 {run.collectionSummary.gradeB} · C 级 {run.collectionSummary.gradeC} ·
          复核 {run.collectionSummary.reviewStatus === "not_configured" ? "未交叉" : run.collectionSummary.reviewStatus === "disputed" ? "有分歧" : "一致"}
        </p>
      ) : null}
      {run.contextSummary?.length ? <div><strong className="text-sm">读取摘要</strong><AutomationSummaryList summary={run.contextSummary} /></div> : null}
      {run.status === "failed" ? (
        <div className={styles.failure}>
          <strong>{automationFailureLabel(run.failureCategory)}</strong>
          {run.failureRecoveryAction && run.failureRecoveryAction !== "none" ? (
            <Button size="sm" variant="outline" onClick={() => onRecoveryAction(run.failureRecoveryAction!)}>
              {automationRecoveryLabel(run.failureRecoveryAction)}
            </Button>
          ) : null}
        </div>
      ) : null}
      {run.unread ? <Button size="sm" variant="outline" onClick={onMarkRead}>标为已读</Button> : null}
    </div>
  );
}
