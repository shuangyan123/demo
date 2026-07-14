"use client";

/** 诊断页的数据管理以紧凑表格展示范围和数量，所有危险操作使用应用内确认层。 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { localDataManagementRepository, type LocalDataSummary } from "../../services/local-data-management-repository";
import { AppIcon } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";
import styles from "../settings/settings-compact.module.css";

type DataManagementPanelProps = { onChanged?: () => Promise<void> | void };
type ClearScope = "imports" | "mistakes" | "conversations";

const emptySummary: LocalDataSummary = { importRecords: 0, mistakeReviewRecords: 0, conversationRecords: 0, totalIndexedDbRecords: 0 };
const scopeLabels: Record<ClearScope, string> = { imports: "导入记录", mistakes: "错题与复盘", conversations: "对话历史" };

/** 数据管理只调用对应 repository；完整重置仍要求输入固定确认文字。 */
export function DataManagementPanel({ onChanged }: DataManagementPanelProps) {
  const [summary, setSummary] = useState<LocalDataSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<ClearScope | "all">();
  const [resetText, setResetText] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  async function refresh(): Promise<void> {
    setSummary(await localDataManagementRepository.loadSummary());
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void localDataManagementRepository.loadSummary().then((next) => { if (active) { setSummary(next); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pendingAction) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(pendingAction === "all" ? "input" : "button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingAction(undefined);
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [pendingAction]);

  /** 分域清理完成后刷新真实数量和主工作台快照。 */
  async function clearScope(scope: ClearScope): Promise<void> {
    const label = scope === "imports" ? "导入记录" : scope === "mistakes" ? "错题与复盘" : "对话历史";
    setBusy(scope);
    try {
      if (scope === "imports") await localDataManagementRepository.clearImports();
      else if (scope === "mistakes") await localDataManagementRepository.clearMistakeReviews();
      else await localDataManagementRepository.clearConversations();
      await onChanged?.(); await refresh(); setNotice(`${label}已清理`); setPendingAction(undefined);
    } catch (error) { setNotice(error instanceof Error ? error.message : `${label}清理失败`); }
    finally { setBusy(""); }
  }

  async function resetAll(): Promise<void> {
    if (resetText !== "完整重置") return;
    setBusy("all");
    await localDataManagementRepository.resetAll();
    window.location.reload();
  }

  const rows: Array<{ id: ClearScope | "all"; label: string; count: number }> = [
    { id: "imports", label: "导入记录", count: summary.importRecords },
    { id: "mistakes", label: "错题与复盘", count: summary.mistakeReviewRecords },
    { id: "conversations", label: "对话历史", count: summary.conversationRecords },
    { id: "all", label: "完整重置（所有数据）", count: summary.totalIndexedDbRecords },
  ];
  const pendingCount = pendingAction === "imports" ? summary.importRecords : pendingAction === "mistakes" ? summary.mistakeReviewRecords : pendingAction === "conversations" ? summary.conversationRecords : summary.totalIndexedDbRecords;

  return (
    <section className={styles.tableSection} aria-label="数据管理">
      <div className={styles.header}><div><h2>数据管理</h2><p>按数据范围清理，完整重置会删除全部本地数据和设置。</p></div>{notice ? <span className={styles.muted} role="status">{notice}</span> : null}</div>
      <div className={styles.table}>
        <div className={`${styles.tableHeader} ${styles.dataColumns}`}><span>清除范围</span><span>项目数</span><span>操作</span></div>
        {rows.map((row) => (
          <div key={row.id} className={`${styles.tableRow} ${styles.dataColumns}`}>
            <span className={row.id === "all" ? "text-danger" : undefined}>{row.label}</span>
            <span className={styles.muted}>{loading ? "统计中" : `${row.count} 项`}</span>
            <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={(event) => { returnFocusRef.current = event.currentTarget; setResetText(""); setPendingAction(row.id); }}>清除</Button>
          </div>
        ))}
      </div>

      {pendingAction && typeof document !== "undefined" ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingAction(undefined); }}>
          <section ref={dialogRef} aria-labelledby="data-clear-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeader}><h3 id="data-clear-title" className="text-base font-semibold">{pendingAction === "all" ? "完整重置（所有数据）" : `清除${scopeLabels[pendingAction]}`}</h3><button aria-label="关闭数据清理确认" className={styles.iconButton} type="button" onClick={() => setPendingAction(undefined)}><AppIcon name="close" size={16} /></button></div>
            <p className="mt-3 text-sm leading-6 text-muted">此操作将永久删除 {pendingCount} 项数据，无法恢复。</p>
            {pendingAction === "all" ? <label className="ui-field mt-4">请输入“完整重置”以继续<input className={styles.input} value={resetText} onChange={(event) => setResetText(event.currentTarget.value)} /></label> : null}
            <div className={styles.modalActions}><Button size="sm" variant="outline" onClick={() => setPendingAction(undefined)}>取消</Button><Button size="sm" variant="danger" disabled={Boolean(busy) || (pendingAction === "all" && resetText !== "完整重置")} onClick={() => pendingAction === "all" ? void resetAll() : void clearScope(pendingAction)}>{busy ? "清理中" : pendingAction === "all" ? "完整重置" : "确认清除"}</Button></div>
          </section>
        </div>
      ), document.body) : null}
    </section>
  );
}
