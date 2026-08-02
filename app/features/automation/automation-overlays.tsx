"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { AutomationDefinition, AutomationRecoveryAction, AutomationRun } from "../../types/domains/automation.ts";
import { Button, IconButton } from "../shared/ui-primitives";
import { AppIcon } from "../shared/app-icon";
import { AutomationEditor } from "./automation-editor";
import styles from "./automation-workspace.module.css";
import type { AutomationEditorState } from "./use-automation-view-controller.ts";
import type { AutomationCenter } from "./use-automation-center.ts";
import { automationErrorMessage, formatAutomationDate } from "./automation-ui.ts";

/** 为编辑层和移动抽屉提供焦点锁定、Escape 与滚动锁定。 */
function FocusLayer({
  children,
  className,
  label,
  onClose,
}: {
  children: ReactNode;
  className: string;
  label: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, []);

  /** 在当前浮层内循环 Tab，并允许 Escape 关闭。 */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={className}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} aria-label={label} aria-modal="true" className={styles.layerDialog} role="dialog" tabIndex={-1} onKeyDown={handleKeyDown}>
        {children}
      </div>
    </div>
  );
}

/** 独立承载新建/编辑表单；桌面为侧栏，移动端为全屏编辑器。 */
export function AutomationEditorLayer({
  center,
  editor,
  onClose,
  onFinished,
  onNotice,
  onRecoveryAction,
}: {
  center: AutomationCenter;
  editor: Exclude<AutomationEditorState, { mode: "closed" }>;
  onClose: () => void;
  onFinished: () => void;
  onNotice: (message: string) => void;
  onRecoveryAction: (action: AutomationRecoveryAction) => void;
}) {
  const definition = editor.mode === "edit" ? editor.definition : undefined;
  const templateId = editor.mode === "edit" ? editor.definition.templateId : editor.templateId;
  return (
    <FocusLayer className={styles.editorBackdrop} label={definition ? "编辑已安排任务" : "新建已安排任务"} onClose={onClose}>
      <div className={styles.editorPanel}>
        <header className={styles.layerHeader}>
          <div><strong>{definition ? "编辑任务" : "新建任务"}</strong><p className="text-xs text-muted">结果只进入运行收件箱，不会自动改写学习数据。</p></div>
          <IconButton icon="close" label="关闭任务编辑器" onClick={onClose} />
        </header>
        <div className={styles.stepRail} aria-label="任务编辑步骤">
          <span>1 基本信息</span><span>2 来源与执行</span><span>3 检查与保存</span>
        </div>
        <AutomationEditor
          key={`${definition?.id ?? templateId}:${editor.revision}`}
          center={center}
          definition={definition}
          initialTemplateId={templateId}
          onRecoveryAction={onRecoveryAction}
          onFinished={onFinished}
          onNotice={onNotice}
        />
      </div>
    </FocusLayer>
  );
}

/** 移动端任务详情抽屉，所有操作复用中心服务，不复制业务状态。 */
export function AutomationTaskDetailDrawer({
  center,
  definition,
  run,
  onClose,
  onEdit,
  onNotice,
}: {
  center: AutomationCenter;
  definition: AutomationDefinition;
  run?: AutomationRun;
  onClose: () => void;
  onEdit: () => void;
  onNotice: (message: string) => void;
}) {
  function runAction(task: Promise<unknown>, fallback: string): void {
    void task.catch((error) => onNotice(automationErrorMessage(error, fallback)));
  }
  return (
    <FocusLayer className={styles.drawerBackdrop} label={`${definition.name}任务详情`} onClose={onClose}>
      <div className={styles.drawerPanel}>
        <header className={styles.layerHeader}>
          <div><strong>{definition.name}</strong><p className="text-xs text-muted">{definition.enabled ? "启用中" : "已停用"}</p></div>
          <IconButton icon="close" label="关闭任务详情" onClick={onClose} />
        </header>
        <div className={styles.detailList}>
          <div><span>下一次运行</span><strong>{formatAutomationDate(definition.nextRunAt)}</strong></div>
          <div><span>最近运行</span><strong>{formatAutomationDate(run?.finishedAt || run?.createdAt)}</strong></div>
          <div><span>最近结果</span><strong>{run?.status === "failed" ? "失败" : run?.status === "succeeded" ? "成功" : run ? "运行中" : "从未运行"}</strong></div>
        </div>
        <div className="mt-4 grid gap-2 pb-[env(safe-area-inset-bottom)]">
          <Button variant="primary" disabled={center.busyIds.includes(definition.id)} onClick={() => runAction(center.runNow(definition.id), "已安排任务运行失败")}>立即运行</Button>
          <Button variant="outline" onClick={onEdit}><AppIcon name="edit" size={16} />编辑</Button>
          <Button variant="outline" onClick={() => runAction(center.duplicate(definition.id), "已安排任务复制失败")}>复制任务</Button>
        </div>
      </div>
    </FocusLayer>
  );
}
