"use client";

/** 诊断页的数据管理把四类危险操作拆开，并在执行前显示真实数量。 */
import { useEffect, useRef, useState } from "react";
import { localDataManagementRepository, type LocalDataSummary } from "../../services/local-data-management-repository";
import { Button, Panel } from "../shared/ui-primitives";

type DataManagementPanelProps = { onChanged?: () => Promise<void> | void };

const emptySummary: LocalDataSummary = { importRecords: 0, mistakeReviewRecords: 0, conversationRecords: 0, totalIndexedDbRecords: 0 };

/** 数据管理操作只调用对应 repository 方法，完整重置要求输入固定确认文字。 */
export function DataManagementPanel({ onChanged }: DataManagementPanelProps) {
  const [summary, setSummary] = useState<LocalDataSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState("");
  const resetInputRef = useRef<HTMLInputElement>(null);

  async function refresh(): Promise<void> {
    setSummary(await localDataManagementRepository.loadSummary());
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void localDataManagementRepository.loadSummary().then((next) => {
      if (!active) return;
      setSummary(next);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!resetOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    resetInputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResetOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [resetOpen]);

  /** 分域清理使用原生确认显示数量，完成后刷新工作台快照。 */
  async function clearScope(scope: "imports" | "mistakes" | "conversations"): Promise<void> {
    const count = scope === "imports" ? summary.importRecords : scope === "mistakes" ? summary.mistakeReviewRecords : summary.conversationRecords;
    const label = scope === "imports" ? "导入记录" : scope === "mistakes" ? "错题与复盘" : "对话历史";
    if (!window.confirm(`确认清理 ${count} 条${label}吗？此操作不可撤销。`)) return;
    setBusy(scope);
    try {
      if (scope === "imports") await localDataManagementRepository.clearImports();
      else if (scope === "mistakes") await localDataManagementRepository.clearMistakeReviews();
      else await localDataManagementRepository.clearConversations();
      await onChanged?.();
      await refresh();
      setNotice(`${label}已清理`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${label}清理失败`);
    } finally {
      setBusy("");
    }
  }

  async function resetAll(): Promise<void> {
    if (resetText !== "完整重置") return;
    setBusy("all");
    await localDataManagementRepository.resetAll();
    window.location.reload();
  }

  return (
    <Panel title="数据管理" eyebrow="Data Management">
      <p className="mb-4 text-sm leading-6 text-muted">按数据域清理，不再把错题、导入和对话混在 AI 连接设置中。</p>
      <div className="divide-y divide-line border-y border-line">
        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"><span><strong className="block text-sm">导入记录</strong><small className="text-muted">{loading ? "统计中" : `${summary.importRecords} 条任务、批次与草稿`}</small></span><Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void clearScope("imports")}>{busy === "imports" ? "清理中" : "清理"}</Button></div>
        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"><span><strong className="block text-sm">错题与复盘</strong><small className="text-muted">{loading ? "统计中" : `${summary.mistakeReviewRecords} 条错题和复盘`}</small></span><Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void clearScope("mistakes")}>{busy === "mistakes" ? "清理中" : "清理"}</Button></div>
        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"><span><strong className="block text-sm">对话历史</strong><small className="text-muted">{loading ? "统计中" : `${summary.conversationRecords} 条会话相关记录`}</small></span><Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void clearScope("conversations")}>{busy === "conversations" ? "清理中" : "清理"}</Button></div>
        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"><span><strong className="block text-sm text-danger">完整重置</strong><small className="text-muted">{loading ? "统计中" : `${summary.totalIndexedDbRecords} 条 IndexedDB 记录及本应用本地配置`}</small></span><Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => { setResetText(""); setResetOpen(true); }}>完整重置</Button></div>
      </div>
      {notice ? <p className="mt-3 text-sm text-muted" role="status">{notice}</p> : null}

      {resetOpen ? <div className="ui-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}><section aria-modal="true" className="ui-dialog" role="dialog" aria-labelledby="complete-reset-title"><h3 id="complete-reset-title" className="text-lg font-semibold">确认完整重置</h3><p className="mt-2 text-sm leading-6 text-muted">这会删除全部本地学习数据、连接、个性化、额度配置和缓存。请输入“完整重置”继续。</p><label className="ui-field mt-4">确认文字<input ref={resetInputRef} className="ui-input" value={resetText} onChange={(event) => setResetText(event.currentTarget.value)} /></label><div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button><Button variant="danger" disabled={resetText !== "完整重置" || busy === "all"} onClick={() => void resetAll()}>{busy === "all" ? "重置中" : "永久删除"}</Button></div></section></div> : null}
    </Panel>
  );
}
