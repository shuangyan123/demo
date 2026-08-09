"use client";

/** 诊断页的数据管理以紧凑表格展示范围和数量，所有危险操作使用应用内确认层。 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LOCAL_DATA_IMPORT_MAX_BYTES,
  localDataManagementRepository,
  type LocalDataRepairBackup,
  type LocalDataRepairPreview,
  type LocalDataHealthReport,
  type LocalDataRestorePreview,
  type LocalDataSummary,
} from "../../services/local-data-management-repository";
import { AppIcon } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";
import styles from "../settings/settings-compact.module.css";

type DataManagementPanelProps = { onChanged?: () => Promise<void> | void };
type ClearScope = "imports" | "mistakes" | "conversations";

const emptySummary: LocalDataSummary = { importRecords: 0, mistakeReviewRecords: 0, conversationRecords: 0, extensionRecords: 0, totalIndexedDbRecords: 0 };
const scopeLabels: Record<ClearScope, string> = { imports: "导入记录", mistakes: "错题与复盘", conversations: "对话历史" };

/** 数据管理只调用对应 repository；完整重置仍要求输入固定确认文字。 */
export function DataManagementPanel({ onChanged }: DataManagementPanelProps) {
  const [summary, setSummary] = useState<LocalDataSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<ClearScope | "all">();
  const [restorePreview, setRestorePreview] = useState<LocalDataRestorePreview>();
  const [healthReport, setHealthReport] = useState<LocalDataHealthReport>();
  const [repairPreview, setRepairPreview] = useState<LocalDataRepairPreview>();
  const [repairBackup, setRepairBackup] = useState<LocalDataRepairBackup>();
  const [repairBackupAcknowledged, setRepairBackupAcknowledged] = useState(false);
  const [resetText, setResetText] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  async function refresh(): Promise<void> {
    setSummary(await localDataManagementRepository.loadSummary());
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void localDataManagementRepository.loadSummary()
      .then((next) => { if (active) { setSummary(next); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!pendingAction && !restorePreview && !repairPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(pendingAction === "all" ? "input" : "button")?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPendingAction(undefined); setRestorePreview(undefined); setRepairPreview(undefined); }
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
  }, [pendingAction, repairPreview, restorePreview]);

  function downloadJson(source: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportBackup(): Promise<void> {
    setBusy("export");
    try {
      const source = await localDataManagementRepository.exportAll();
      downloadJson(source, `review-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice("备份已导出；凭据与 Vault 目录未包含");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导出备份失败");
    } finally {
      setBusy("");
    }
  }

  async function previewRepair(repairId: "delete-orphan-conversation-run-steps"): Promise<void> {
    setBusy("repair-preview");
    try {
      setRepairPreview(await localDataManagementRepository.inspectRepair(repairId));
      setRepairBackup(undefined);
      setRepairBackupAcknowledged(false);
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法生成修复预览");
    } finally {
      setBusy("");
    }
  }

  async function downloadRepairBackup(): Promise<void> {
    if (!repairPreview) return;
    setBusy("repair-backup");
    try {
      const backup = await localDataManagementRepository.prepareRepairBackup(repairPreview);
      downloadJson(backup.source, `review-workspace-before-repair-${new Date().toISOString().slice(0, 10)}.json`);
      setRepairBackup(backup);
      setRepairBackupAcknowledged(false);
      setNotice("已请求浏览器下载 fresh V2 安全备份；请确认文件确实保存后再继续。待清理的孤立运行元数据不进入该可恢复快照。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "修复前备份生成失败");
    } finally {
      setBusy("");
    }
  }

  async function executeRepair(): Promise<void> {
    if (!repairPreview || !repairBackup || !repairBackupAcknowledged) return;
    setBusy("repair-execute");
    try {
      const result = await localDataManagementRepository.executeRepair(repairPreview, repairBackup, true);
      await onChanged?.();
      await refresh();
      const report = await localDataManagementRepository.inspectHealth();
      setHealthReport(report);
      setRepairPreview(undefined);
      setRepairBackup(undefined);
      setRepairBackupAcknowledged(false);
      setNotice(`已定向清理 ${result.affectedRecords} 条孤立运行元数据，并通过修复后完整性验证。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "定向修复失败；事务未提交");
    } finally {
      setBusy("");
    }
  }

  function closeRepairPreview(): void {
    setRepairPreview(undefined);
    setRepairBackup(undefined);
    setRepairBackupAcknowledged(false);
  }

  async function inspectHealth(): Promise<void> {
    setBusy("health");
    try {
      const report = await localDataManagementRepository.inspectHealth();
      setHealthReport(report);
      setNotice(report.healthy ? "本地数据健康检查通过" : `发现 ${report.errors.length + report.warnings.length} 项数据可靠性问题`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "本地数据健康检查失败");
    } finally {
      setBusy("");
    }
  }

  async function inspectBackup(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > LOCAL_DATA_IMPORT_MAX_BYTES) {
      setNotice("备份文件超过 100MB 限制");
      return;
    }
    setBusy("inspect");
    try {
      setRestorePreview(await localDataManagementRepository.inspectRestore(await file.text()));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "备份校验失败");
    } finally {
      setBusy("");
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function restoreBackup(): Promise<void> {
    if (!restorePreview) return;
    setBusy("restore");
    try {
      await localDataManagementRepository.restore(restorePreview);
      await onChanged?.();
      await refresh();
      setRestorePreview(undefined);
      setNotice("备份已恢复；请重新输入凭据并重新选择 Obsidian Vault");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "恢复失败，旧数据已回滚");
    } finally {
      setBusy("");
    }
  }

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
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted p-3">
        <div className="flex-1">
          <strong className="block text-sm">浏览器 / Electron 数据迁移</strong>
          <span className="mt-1 block text-xs text-muted">仅迁移安全业务数据；凭据与 Vault 目录始终排除。</span>
        </div>
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void inspectHealth()}>{busy === "health" ? "检查中" : "检查数据健康"}</Button>
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void exportBackup()}>导出备份</Button>
        <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => importInputRef.current?.click()}>导入备份</Button>
        <input
          ref={importInputRef}
          accept="application/json,.json"
          aria-label="选择本地数据备份"
          className="sr-only"
          type="file"
          onChange={(event) => void inspectBackup(event.currentTarget.files?.[0])}
        />
      </div>
      {healthReport ? (
        <div className="mb-4 rounded-lg border border-line bg-surface-muted p-3 text-sm" role="status">
          <strong>{healthReport.healthy ? "本地业务数据正常" : "本地业务数据需要关注"}</strong>
          {healthReport.healthy ? <p className="mt-1 text-xs leading-5 text-muted">表分类、关键关联、恢复事务、Vault mapping 与本机密钥可用性检查未发现问题。</p> : (
            <ul aria-label="数据健康问题" className="mt-3">
              {[...healthReport.errors, ...healthReport.warnings].map((issue, index) => {
                const candidate = issue.repairability === "targeted-safe"
                  ? healthReport.repairable.find((item) => item.scope === issue.scope)
                  : undefined;
                return <li key={`${issue.code}:${issue.scope}:${issue.recordId ?? index}`} className="rounded-md border border-line bg-surface p-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1"><span className="text-xs font-medium">{issue.repairability === "targeted-safe" ? "可定向修复" : issue.repairability === "manual-only" ? "需要手动处理" : "仅报告"}</span><p className="mt-1 text-xs leading-5 text-muted">{issue.message}</p>{issue.manualAction ? <p className="mt-1 text-xs leading-5 text-muted">下一步：{issue.manualAction}</p> : null}</div>
                    {candidate ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={(event) => { returnFocusRef.current = event.currentTarget; void previewRepair(candidate.id); }}>查看修复预览</Button> : null}
                  </div>
                </li>;
              })}
            </ul>
          )}
        </div>
      ) : null}
      <div className={styles.table}>
        <div className={`${styles.tableHeader} ${styles.dataColumns}`}><span>清除范围</span><span className={styles.cellCenter}>项目数</span><span className={styles.cellCenter}>操作</span></div>
        {rows.map((row) => (
          <div key={row.id} className={`${styles.tableRow} ${styles.dataColumns}`}>
            <span className={row.id === "all" ? "text-danger" : undefined}>{row.label}</span>
            <span className={`${styles.muted} ${styles.cellCenter}`}>{loading ? "统计中" : `${row.count} 项`}</span>
            <span className={styles.cellCenter}><Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={(event) => { returnFocusRef.current = event.currentTarget; setResetText(""); setPendingAction(row.id); }}>清除</Button></span>
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
      {restorePreview && typeof document !== "undefined" ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRestorePreview(undefined); }}>
          <section ref={dialogRef} aria-labelledby="data-restore-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeader}>
              <h3 id="data-restore-title" className="text-base font-semibold">确认恢复本地备份</h3>
              <button aria-label="关闭备份恢复确认" className={styles.iconButton} type="button" onClick={() => setRestorePreview(undefined)}><AppIcon name="close" size={16} /></button>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              备份创建于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(restorePreview.exportedAt))}，
              将用 {restorePreview.incomingRecords} 项记录替换当前 {restorePreview.replacingRecords} 项可迁移数据。
            </p>
            <ul className="mt-3 pl-5 text-xs text-muted">
              {restorePreview.reminders.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <div className={styles.modalActions}>
              <Button size="sm" variant="outline" onClick={() => setRestorePreview(undefined)}>取消</Button>
              <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void restoreBackup()}>{busy === "restore" ? "恢复中" : "确认替换"}</Button>
            </div>
          </section>
        </div>
      ), document.body) : null}
      {repairPreview && typeof document !== "undefined" ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRepairPreview(); }}>
          <section ref={dialogRef} aria-labelledby="data-repair-title" aria-modal="true" className={styles.modal} role="dialog">
            <div className={styles.modalHeader}>
              <h3 id="data-repair-title" className="text-base font-semibold">定向修复预览</h3>
              <button aria-label="关闭修复预览" className={styles.iconButton} type="button" onClick={closeRepairPreview}><AppIcon name="close" size={16} /></button>
            </div>
            <dl className="mt-3 grid gap-2 text-sm">
              <div><dt className="font-medium">会修改什么</dt><dd className="mt-1 text-muted">{repairPreview.action}</dd></div>
              <div><dt className="font-medium">影响范围</dt><dd className="mt-1 text-muted">{repairPreview.scope} · {repairPreview.affectedRecords} 条精确记录</dd></div>
              <div><dt className="font-medium">数据风险</dt><dd className="mt-1 text-muted">低；只删除没有父对话、无法被产品读取的脱敏运行元数据，不级联删除其他记录。</dd></div>
              <div><dt className="font-medium">验证计划</dt><dd className="mt-1 text-muted">{repairPreview.verificationPlan}</dd></div>
            </dl>
            <details className="mt-3 text-xs text-muted"><summary>查看受影响记录 ID</summary><ul className="mt-2 pl-5">{repairPreview.affectedRecordIds.map((id) => <li key={id} className="break-all">{id}</li>)}</ul></details>
            <div className="mt-4 rounded-md border border-line bg-surface-muted p-3 text-xs leading-5 text-muted">
              修复前必须下载 fresh LocalDataExportV2 安全备份。浏览器只能发起下载，应用无法证明文件已经保存，因此需要你明确确认。
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void downloadRepairBackup()}>{busy === "repair-backup" ? "生成中" : "下载修复前备份"}</Button>
              {repairBackup ? <label className="flex items-start gap-2 text-xs text-muted"><input checked={repairBackupAcknowledged} className="mt-0.5" type="checkbox" onChange={(event) => setRepairBackupAcknowledged(event.currentTarget.checked)} />我已确认浏览器已保存这份备份</label> : null}
            </div>
            <div className={styles.modalActions}>
              <Button size="sm" variant="outline" onClick={closeRepairPreview}>取消</Button>
              <Button size="sm" variant="danger" disabled={Boolean(busy) || !repairBackup || !repairBackupAcknowledged} onClick={() => void executeRepair()}>{busy === "repair-execute" ? "修复并验证中" : "确认定向修复"}</Button>
            </div>
          </section>
        </div>
      ), document.body) : null}
    </section>
  );
}
