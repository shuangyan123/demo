"use client";

import type { AutomationDefinition, AutomationRun } from "../../types/review";
import { Button, EmptyState } from "../shared/ui-primitives";
import styles from "./automation-workspace.module.css";
import type { AutomationCenter } from "./use-automation-center";
import type { AutomationStatusFilter } from "./automation-view-model";
import { automationErrorMessage, formatAutomationDate, formatSchedule } from "./automation-ui";

/** 已安排任务主列表：桌面为行式表格，移动端自动折叠为两列摘要。 */
export function AutomationTaskList({
  center,
  definitions,
  latestRuns,
  search,
  selectedDefinitionId,
  statusFilter,
  onEdit,
  onNotice,
  onSearchChange,
  onSelect,
  onStatusFilterChange,
}: {
  center: AutomationCenter;
  definitions: AutomationDefinition[];
  latestRuns: Map<string, AutomationRun>;
  search: string;
  selectedDefinitionId?: string;
  statusFilter: AutomationStatusFilter;
  onEdit: (definition: AutomationDefinition) => void;
  onNotice: (message: string) => void;
  onSearchChange: (value: string) => void;
  onSelect: (definition: AutomationDefinition) => void;
  onStatusFilterChange: (value: AutomationStatusFilter) => void;
}) {
  /** 捕获任务动作错误并转为应用内反馈。 */
  function runAction(task: Promise<unknown>, fallback: string): void {
    void task.catch((error) => onNotice(automationErrorMessage(error, fallback)));
  }

  return (
    <>
      <div className={styles.toolbar}>
        <input
          aria-label="搜索已安排任务"
          className={styles.input}
          placeholder="搜索任务"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
        />
        <select
          aria-label="筛选任务状态"
          className={styles.select}
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.currentTarget.value as AutomationStatusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已停用</option>
          <option value="failed">最近失败</option>
        </select>
      </div>
      <div className={styles.tableHeader} aria-hidden="true">
        <span>任务名</span><span>模板</span><span>下次运行 / 最近结果</span><span>启用</span>
      </div>
      {definitions.length ? definitions.map((definition) => {
        const latestRun = latestRuns.get(definition.id);
        const tone = latestRun?.status === "failed" ? "danger" : latestRun?.status === "succeeded" ? "success" : latestRun ? "warning" : "muted";
        const resultLabel = latestRun?.status === "failed" ? "失败" : latestRun?.status === "succeeded" ? "成功" : latestRun ? "运行中" : "从未运行";
        return (
          <article
            key={definition.id}
            className={styles.taskRow}
            data-selected={selectedDefinitionId === definition.id}
          >
            <button className={styles.taskMain} type="button" onClick={() => onSelect(definition)}>
              <span className={styles.taskName}>
                <strong>{definition.name}</strong>
                <span>{formatSchedule(definition.schedule)}</span>
              </span>
              <span className={styles.taskMeta}>
                <strong>{definition.templateId === "custom" ? "自定义任务" : definition.name}</strong>
                <span>{definition.collectionConfig ? `${definition.collectionConfig.domain} · 最多 ${definition.collectionConfig.maxDocuments} 篇` : "本地只读范围"}</span>
              </span>
              <span className={styles.taskMeta}>
                <strong>{definition.nextRunAt ? formatAutomationDate(definition.nextRunAt) : "尚未安排"}</strong>
                <span className={styles.status} data-tone={tone}>{resultLabel}{latestRun ? ` · ${formatAutomationDate(latestRun.finishedAt || latestRun.createdAt)}` : ""}</span>
              </span>
            </button>
            <label className={styles.switch} aria-label={`${definition.name}启用状态`}>
              <input
                type="checkbox"
                checked={definition.enabled}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  runAction(center.toggle(definition.id, enabled), "已安排状态更新失败");
                }}
              />
            </label>
          </article>
        );
      }) : (
        <EmptyState>
          <div className={styles.empty}>
            <strong>{center.snapshot.definitions.length ? "没有匹配的任务" : "还没有已安排任务"}</strong>
            <p className="mt-2">{center.snapshot.definitions.length ? "调整搜索或状态筛选后重试。" : "创建任务后，它会在应用打开且联网时按计划执行。"}</p>
          </div>
        </EmptyState>
      )}
      {selectedDefinitionId ? (
        <div className={styles.taskActions}>
          {(() => {
            const selected = center.snapshot.definitions.find((item) => item.id === selectedDefinitionId);
            if (!selected) return null;
            const busy = center.busyIds.includes(selected.id);
            return (
              <>
                <Button variant="primary" disabled={busy} onClick={() => runAction(center.runNow(selected.id), "已安排任务运行失败")}>{busy ? "运行中" : "立即运行"}</Button>
                <Button variant="outline" onClick={() => onEdit(selected)}>编辑</Button>
                <Button variant="outline" onClick={() => runAction(center.duplicate(selected.id), "已安排任务复制失败")}>复制</Button>
                <Button variant="outline" onClick={() => {
                  if (window.confirm(`删除“${selected.name}”及其运行记录？`)) runAction(center.remove(selected.id), "已安排任务删除失败");
                }}>删除</Button>
              </>
            );
          })()}
        </div>
      ) : null}
    </>
  );
}
