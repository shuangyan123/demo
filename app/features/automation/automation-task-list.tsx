"use client";

import { useMemo } from "react";
import { AUTOMATION_TEMPLATES } from "../../services/automation-executor";
import type { AutomationDefinition, AutomationTemplateId } from "../../types/review";
import { Button, EmptyState, Panel } from "../shared/ui-primitives";
import type { AutomationCenter } from "./use-automation-center";
import {
  AUTOMATION_SOURCE_OPTIONS,
  automationErrorMessage,
  countRunsByAutomation,
  formatAutomationDate,
  formatSchedule,
} from "./automation-ui";

/** 渲染自动化定义列表，并将异步操作错误统一反馈到应用通知。 */
export function AutomationTaskList({
  center,
  onCreateTemplate,
  onEdit,
  onNotice,
}: {
  center: AutomationCenter;
  onCreateTemplate: (templateId: AutomationTemplateId) => void;
  onEdit: (definition: AutomationDefinition) => void;
  onNotice: (message: string) => void;
}) {
  const runsByTask = useMemo(() => countRunsByAutomation(center.snapshot.runs), [center.snapshot.runs]);

  /** 启动界面动作并捕获 Promise 拒绝，避免产生未处理异常。 */
  function runAction(task: Promise<unknown>, fallback: string): void {
    void task.catch((error) => onNotice(automationErrorMessage(error, fallback)));
  }

  return (
    <Panel title="自动化任务" eyebrow="应用打开时执行 · 漏跑合并一次">
      <div className="mb-4 flex flex-wrap gap-2">
        {AUTOMATION_TEMPLATES.map((template) => (
          <Button key={template.id} variant="outline" onClick={() => onCreateTemplate(template.id)}>{template.name}</Button>
        ))}
      </div>
      {center.snapshot.definitions.length ? (
        <div className="grid gap-3">
          {center.snapshot.definitions.map((definition) => {
            const busy = center.busyIds.includes(definition.id);
            const sourceLabels = definition.sourceScopes
              .map((id) => AUTOMATION_SOURCE_OPTIONS.find((item) => item.id === id)?.label)
              .filter(Boolean)
              .join("、");
            return (
              <article key={definition.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{definition.name}</strong>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${definition.enabled ? "bg-success-soft text-success" : "bg-subtle text-muted"}`}>
                        {definition.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{formatSchedule(definition.schedule)} · 下次 {formatAutomationDate(definition.nextRunAt)}</p>
                    <p className="mt-1 text-xs text-muted">运行 {runsByTask.get(definition.id) ?? 0} 次 · {sourceLabels}</p>
                  </div>
                  <label className="flex flex-none items-center gap-2 whitespace-nowrap text-sm">
                    <input type="checkbox" checked={definition.enabled} onChange={(event) => runAction(center.toggle(definition.id, event.currentTarget.checked), "自动化状态更新失败")} />
                    启用
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => runAction(center.runNow(definition.id), "自动化运行失败")}>{busy ? "运行中" : "立即运行"}</Button>
                  <Button variant="outline" onClick={() => onEdit(definition)}>编辑</Button>
                  <Button variant="outline" onClick={() => runAction(center.duplicate(definition.id), "自动化复制失败")}>复制</Button>
                  <Button variant="outline" onClick={() => {
                    if (window.confirm(`删除“${definition.name}”及其运行记录？`)) runAction(center.remove(definition.id), "自动化删除失败");
                  }}>删除</Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState><strong>还没有自动化</strong><p className="mt-2">选择上方模板，或创建一个只读的自定义任务。</p></EmptyState>
      )}
    </Panel>
  );
}
