"use client";

import type { AutomationRecoveryAction } from "../../types/review";
import { automationRecoveryLabel } from "../../services/automation-failure";
import { Button } from "../shared/ui-primitives";
import { AutomationInbox } from "./automation-inbox";
import { AutomationEditorLayer, AutomationTaskDetailDrawer } from "./automation-overlays";
import { AutomationTaskList } from "./automation-task-list";
import styles from "./automation-workspace.module.css";
import { useAutomationViewController } from "./use-automation-view-controller";
import { useAutomationCenter } from "./use-automation-center";
import { formatAutomationDate } from "./automation-ui";

/** 已安排控制台组合视图：只负责主从布局、导航接线和恢复入口。 */
export function AutomationView({
  center,
  onOpenEntry,
  onOpenImport,
  onOpenKnowledge,
  onOpenSettings,
  onNotice,
}: {
  center: ReturnType<typeof useAutomationCenter>;
  onOpenEntry: () => void;
  onOpenImport: () => void;
  onOpenKnowledge: () => void;
  onOpenSettings: () => void;
  onNotice: (message: string) => void;
}) {
  const view = useAutomationViewController(center);

  /** 恢复动作只做导航或提示，不直接重试运行或触发外部能力。 */
  function handleRecoveryAction(action: AutomationRecoveryAction): void {
    if (action === "configure_ai_connection" || action === "configure_mcp") {
      onOpenSettings();
      if (action === "configure_mcp") onNotice("请在设置 → MCP 中将目标工具设为“允许已安排任务”");
      return;
    }
    if (action === "open_knowledge") return onOpenKnowledge();
    if (action === "open_import") return onOpenImport();
    if (action === "open_entry") return onOpenEntry();
    onNotice(automationRecoveryLabel(action));
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div><h2>已安排</h2><p className="mt-1 text-sm text-muted">任务仅在应用打开、可见且联网时执行或补跑。</p></div>
        <Button variant="primary" onClick={() => view.startCreate()}>新建任务</Button>
      </header>
      <section className={styles.summary} aria-label="已安排状态摘要">
        <div className={styles.summaryItem}><span>启用任务</span><strong>{view.overview.enabledCount} 个</strong></div>
        <div className={styles.summaryItem}><span>下次执行</span><strong>{view.overview.nextRunAt ? formatAutomationDate(view.overview.nextRunAt) : "暂无计划"}</strong></div>
        <div className={styles.summaryItem}><span>待处理结果</span><strong>{view.overview.pendingCount} 条</strong></div>
      </section>
      <div className={styles.tabs} role="tablist" aria-label="已安排内容">
        <button className={styles.tab} role="tab" aria-selected={view.activeTab === "tasks"} onClick={() => view.setActiveTab("tasks")}>任务</button>
        <button className={styles.tab} role="tab" aria-selected={view.activeTab === "inbox"} onClick={() => view.setActiveTab("inbox")}>收件箱{center.snapshot.unreadCount ? ` ${center.snapshot.unreadCount}` : ""}</button>
      </div>
      <section className={styles.columns}>
        <div className={styles.column} data-hidden-mobile={view.activeTab !== "tasks"}>
          <header className={styles.columnHeader}><strong>任务</strong><span className="text-xs text-muted">共 {view.definitions.length} 个</span></header>
          <AutomationTaskList
            center={center}
            definitions={view.definitions}
            latestRuns={view.latestRuns}
            search={view.search}
            selectedDefinitionId={view.selectedDefinition?.id}
            statusFilter={view.statusFilter}
            onEdit={view.startEdit}
            onNotice={onNotice}
            onSearchChange={view.setSearch}
            onSelect={view.selectDefinition}
            onStatusFilterChange={view.setStatusFilter}
          />
        </div>
        <div className={styles.column} data-hidden-mobile={view.activeTab !== "inbox"}>
          <header className={styles.columnHeader}><strong>运行收件箱</strong><span className="text-xs text-muted">{center.snapshot.unreadCount} 未读</span></header>
          <AutomationInbox
            center={center}
            filter={view.inboxFilter}
            runs={view.runs}
            onFilterChange={view.setInboxFilter}
            onNotice={onNotice}
            onRecoveryAction={handleRecoveryAction}
          />
        </div>
      </section>
      {view.editor.mode !== "closed" ? (
        <AutomationEditorLayer
          center={center}
          editor={view.editor}
          onClose={view.closeEditor}
          onFinished={view.closeEditor}
          onNotice={onNotice}
          onRecoveryAction={handleRecoveryAction}
        />
      ) : null}
      {view.mobileDetailOpen && view.selectedDefinition ? (
        <AutomationTaskDetailDrawer
          center={center}
          definition={view.selectedDefinition}
          run={view.selectedRun}
          onClose={view.closeMobileDetail}
          onEdit={() => view.startEdit(view.selectedDefinition!)}
          onNotice={onNotice}
        />
      ) : null}
    </div>
  );
}
