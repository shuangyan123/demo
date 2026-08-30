"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { AppIcon } from "../shared/app-icon";
import { Button, Chip, ConfirmDialog, EmptyState, Panel, SelectField, TextAreaField, TextField } from "../shared/ui-primitives";
import { useVisibleLimit } from "../shared/use-visible-limit";
import { toListText } from "../../lib/form-utils";
import { FenbiQuickImportPanel } from "./fenbi-quick-import-panel";
import type { useFenbiQuickImport } from "./use-fenbi-quick-import.ts";
import styles from "./review-import-view.module.css";
import { BOARD_OPTIONS, type Board } from "../../types/domains/review.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { ImportBatch, ImportDraft, ImportDraftIssue, PersistedImportDraft } from "../../types/domains/import.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const IMPORT_DRAFT_VISIBLE_STEP = 60;
type ImportMobileStep = "source" | "draft" | "confirm";

// 导入页只负责展示导入入口和草稿编辑；实际解析、入库和 API 调用都由父级状态编排传入。
export function ImportView({
  textConnection,
  visionConnection,
  batches,
  drafts,
  importBusy,
  fenbiQuickImport,
  canUndoConfirmation,
  onBulkUpdateDrafts,
  onConfirmDrafts,
  onDeleteDrafts,
  onParseFileImport,
  onParseTextImport,
  onSwitchSettings,
  onUpdateDraft,
  onUpdateDraftList,
  onUndoConfirmation,
}: {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  batches: ImportBatch[];
  drafts: PersistedImportDraft[];
  importBusy: boolean;
  fenbiQuickImport: ReturnType<typeof useFenbiQuickImport>;
  canUndoConfirmation: boolean;
  onBulkUpdateDrafts: (ids: string[], patch: Partial<ImportDraft>) => void;
  onConfirmDrafts: (ids?: string[]) => void;
  onDeleteDrafts: (ids: string[]) => void;
  onParseFileImport: (event: SubmitReactEvent) => void;
  onParseTextImport: (event: SubmitReactEvent, mode: "local" | "ai") => void;
  onSwitchSettings: () => void;
  onUpdateDraft: (id: string, patch: Partial<ImportDraft>) => void;
  onUpdateDraftList: (id: string, key: "reasons" | "tags", value: string) => void;
  onUndoConfirmation: () => void;
}) {
  const [mobileStep, setMobileStep] = useState<ImportMobileStep>("source");
  const [draftFilter, setDraftFilter] = useState<"pending" | "problem" | "imported">("pending");
  const [query, setQuery] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const sourceRef = useRef<HTMLElement>(null);
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.id, batch])), [batches]);
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null;
  const selectedBatch = (selectedDraft ? batchById.get(selectedDraft.batchId) : undefined) ?? batches[0] ?? null;
  const visibleDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return drafts.filter((draft) => {
      if (draftFilter === "problem" && !(draft.needsReview || draft.issues.length)) return false;
      if (draftFilter === "imported") return false;
      return !normalizedQuery || `${draft.stem} ${draft.fileName ?? ""} ${draft.board}`.toLowerCase().includes(normalizedQuery);
    });
  }, [draftFilter, drafts, query]);
  const importedBatches = batches.filter((batch) => batch.status === "saved");
  const problemCount = drafts.filter((draft) => draft.needsReview || draft.issues.length).length;

  return (
    <section className={styles.workspace} data-step={mobileStep}>
      <header className={styles.header}>
        <div><h1>导入</h1><p><strong>来源：粉笔</strong> · 同步账户错题，或导入官方导出文件、截图与错题文本；确认前不会写入题库。</p></div>
        <Button type="button" variant="primary" onClick={() => { setMobileStep("source"); sourceRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }}><AppIcon name="import" size={16} />开始导入</Button>
      </header>
      <nav className={styles.steps} aria-label="导入步骤">
        {([["source", "1 来源"], ["draft", "2 草稿"], ["confirm", "3 确认"]] as Array<[ImportMobileStep, string]>).map(([value, label]) => (
          <button key={value} aria-current={mobileStep === value ? "step" : undefined} type="button" onClick={() => setMobileStep(value)}>{label}</button>
        ))}
      </nav>
      <div className={styles.layout}>
        <aside ref={sourceRef} className={styles.sources}>
          <section className={styles.sourcePanel}>
            <h2>1. 粉笔账户同步</h2>
            <FenbiQuickImportPanel credential={fenbiQuickImport.credential} error={fenbiQuickImport.error} errorCode={fenbiQuickImport.errorCode} fallbackRecommended={fenbiQuickImport.fallbackRecommended} progress={fenbiQuickImport.progress} requestId={fenbiQuickImport.requestId} stage={fenbiQuickImport.stage} status={fenbiQuickImport.status} onCancel={fenbiQuickImport.cancel} onSaveCookie={fenbiQuickImport.saveCookie} onSync={fenbiQuickImport.sync} onValidate={fenbiQuickImport.validate} />
          </section>
          <section className={styles.recentPanel}>
            <h3>最近导入</h3>
            <div className={styles.recentList}>{batches.slice(0, 6).map((batch) => <button key={batch.id} type="button" onClick={() => { const first = drafts.find((draft) => draft.batchId === batch.id); setSelectedDraftId(first?.id ?? null); setMobileStep("draft"); }}><AppIcon name={batch.status === "failed" ? "warning" : batch.status === "parsing" ? "refresh" : "import"} size={18} /><span><strong>{batch.fileNames[0] ?? "粉笔错题文本"}</strong><small>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(batch.createdAt))} · {batch.parsedCount} 条</small></span><em data-status={batch.status}>{batchStatusLabels[batch.status]}</em></button>)}</div>
          </section>
          <details className={styles.advancedSource} open><summary>其他粉笔导入方式</summary><form className={styles.fenbiFileForm} onSubmit={onParseFileImport}><div><strong>官方导出文件与截图</strong><span>支持 PDF、Word、图片、TXT、CSV 和 JSON；图片及无文本 PDF 使用默认多模态连接。</span></div><input aria-label="选择粉笔导出文件或截图" name="files" type="file" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json" multiple /><Button size="sm" type="submit" disabled={importBusy}><AppIcon name="upload" size={16} />上传并解析</Button></form><form onSubmit={(event) => { const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; onParseTextImport(event, submitter?.dataset.mode === "ai" ? "ai" : "local"); }}><TextAreaField label="粘贴粉笔错题文本" name="rawText" required /><div><Button size="sm" type="submit" data-mode="local"><AppIcon name="import" size={16} />本地解析</Button><Button size="sm" type="submit" data-mode="ai" variant="outline"><AppIcon name="sparkles" size={16} />AI 解析</Button></div><small>文本：{textConnection?.label ?? "本地解析可用"} · 多模态：{visionConnection?.label ?? "未配置"}</small><Button size="sm" variant="ghost" onClick={onSwitchSettings}><AppIcon name="configure" size={16} />设置 AI 连接</Button></form></details>
        </aside>

        <main className={styles.console}>
          <section className={styles.draftTablePanel}>
            <h2>2. 解析结果与草稿</h2>
            <div className={styles.draftTabs}><button aria-pressed={draftFilter === "pending"} type="button" onClick={() => setDraftFilter("pending")}>待确认 <span>{drafts.length}</span></button><button aria-pressed={draftFilter === "problem"} type="button" onClick={() => setDraftFilter("problem")}>有问题 <span>{problemCount}</span></button><button aria-pressed={draftFilter === "imported"} type="button" onClick={() => setDraftFilter("imported")}>已导入 <span>{importedBatches.length}</span></button></div>
            <div className={styles.tableToolbar}><label><AppIcon name="search" size={16} /><input aria-label="搜索草稿标题" placeholder="搜索草稿标题" value={query} onChange={(event) => setQuery(event.currentTarget.value)} /></label><span>{draftFilter === "imported" ? importedBatches.length : visibleDrafts.length} 条记录</span></div>
            <div className={styles.tableScroller}>
              <table className={styles.draftTable}><thead><tr><th /><th>标题</th><th>类型</th><th>来源文件</th><th>页面范围</th><th>解析时间</th><th>状态</th></tr></thead><tbody>
                {draftFilter === "imported" ? importedBatches.map((batch) => <tr key={batch.id}><td><span className={styles.radio} /></td><td><strong>{batch.fileNames[0] ?? "粉笔已入库批次"}</strong><small>{batch.savedCount} 条已入库</small></td><td>粉笔错题</td><td>{batch.fileNames[0] ?? "粉笔错题文本"}</td><td>{batch.documentMetadata?.pageRange ?? "--"}</td><td>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(batch.updatedAt))}</td><td><em data-tone="success">已入库</em></td></tr>) : visibleDrafts.map((draft) => <tr key={draft.id} aria-selected={selectedDraft?.id === draft.id} onClick={() => { setSelectedDraftId(draft.id); setMobileStep("confirm"); }}><td><span className={styles.radio} /></td><td><strong>{draft.stem}</strong><small>{draft.board}</small></td><td>粉笔错题</td><td>{draft.fileName ?? "粉笔错题文本"}</td><td>{batchById.get(draft.batchId)?.documentMetadata?.pageRange ?? "--"}</td><td>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(draft.updatedAt))}</td><td><em data-tone={draft.needsReview || draft.issues.length ? "warning" : "pending"}>{draft.needsReview || draft.issues.length ? "有问题" : "待确认"}</em></td></tr>)}
              </tbody></table>
            </div>
          </section>

          <section className={styles.detailPanel}>
            <h2>3. 草稿详情 {selectedDraft ? `（${selectedDraft.fileName ?? selectedDraft.board}）` : ""}</h2>
            {selectedDraft ? <div className={styles.detailBody}><dl className={styles.metadata}><div><dt>资料类型</dt><dd>{selectedBatch?.documentMetadata?.documentType ?? "试题集"}</dd></div><div><dt>科目分类</dt><dd>{selectedBatch?.documentMetadata?.category ?? selectedDraft.board}</dd></div><div><dt>适用考试</dt><dd>{selectedBatch?.documentMetadata?.exam ?? "国家公务员考试"}</dd></div><div><dt>年份</dt><dd>{selectedBatch?.documentMetadata?.year ?? "--"}</dd></div><div><dt>页面范围</dt><dd>{selectedBatch?.documentMetadata?.pageRange ?? "--"}</dd></div><div><dt>题目数量</dt><dd>{selectedBatch?.documentMetadata?.questionCount ?? 1} 题</dd></div></dl><section className={styles.validation}><div className={styles.validationTabs}><strong>字段校验</strong><span>解析预览</span></div>{(selectedBatch?.diagnostics ?? [{ field: "资料类型", tone: "success" as const, message: "识别为试题集" }, { field: "科目分类", tone: "success" as const, message: `识别为${selectedDraft.board}` }, ...selectedDraft.issues.map((issue) => ({ field: issueLabels[issue], tone: "warning" as const, message: "需要人工确认后再入库" }))]).map((item) => <p key={`${item.field}:${item.message}`} data-tone={item.tone}><AppIcon name={item.tone === "success" ? "check" : "warning"} size={14} /><b>{item.field}</b><span>{item.message}</span></p>)}</section><aside className={styles.diagnosis}><h3>诊断说明</h3><p>{selectedDraft.needsReview || selectedDraft.issues.length ? "发现需要确认的字段。修改完成后可重新确认入库。" : "字段完整，可以确认入库。"}</p><small>确认前不会写入正式题库。</small></aside></div> : <EmptyState reviewPack="import" stateId="import.preview.empty">选择一条草稿查看字段校验与解析预览。</EmptyState>}
            <footer className={styles.detailActions}>{canUndoConfirmation ? <Button variant="outline" onClick={onUndoConfirmation}><AppIcon name="undo" size={16} />撤销本批</Button> : null}<Button variant="danger" disabled={!selectedDraft} onClick={() => selectedDraft && onDeleteDrafts([selectedDraft.id])}><AppIcon name="trash" size={16} />删除</Button><Button variant="outline" disabled={!selectedDraft} onClick={() => setMobileStep("draft")}><AppIcon name="back" size={16} />返回修改</Button><Button variant="primary" disabled={!selectedDraft} onClick={() => selectedDraft && onConfirmDrafts([selectedDraft.id])}><AppIcon name="check" size={16} />确认入库</Button></footer>
          </section>

          <details className={styles.advancedDrafts}><summary>批量校对粉笔草稿</summary><ImportDrafts drafts={drafts} canUndoConfirmation={canUndoConfirmation} onConfirmDrafts={onConfirmDrafts} onBulkUpdateDrafts={onBulkUpdateDrafts} onDeleteDrafts={onDeleteDrafts} onUpdateDraft={onUpdateDraft} onUpdateDraftList={onUpdateDraftList} onUndoConfirmation={onUndoConfirmation} /></details>
        </main>
      </div>
    </section>
  );
}

const issueLabels: Record<ImportDraftIssue, string> = {
  duplicate: "疑似重复",
  low_confidence: "低置信度",
  missing_answer: "缺答案",
  unknown_board: "板块待确认",
};

const batchStatusLabels: Record<ImportBatch["status"], string> = {
  queued: "等待解析",
  parsing: "解析中",
  parsed: "待确认",
  saved: "已入库",
  failed: "解析失败",
};

// 渲染粉笔导入批次，帮助用户回看最近一次批量上传的解析状态。
export function ImportBatchList({ batches }: { batches: ImportBatch[] }) {
  return (
    <Panel title="粉笔导入批次" eyebrow="Batches">
      {batches.length ? (
        <div className="grid gap-3">
          {batches.slice(0, 8).map((batch) => (
            <article key={batch.id} className="ui-import-batch">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate">{batch.fileNames.join("、") || "粘贴文本"}</strong>
                  <Chip tone={batch.status === "failed" ? "red" : batch.status === "saved" ? "green" : batch.status === "parsing" ? "yellow" : "blue"}>
                    {batch.status}
                  </Chip>
                </div>
                <p className="mt-1 text-sm text-muted">{batch.message}</p>
                {batch.error && <p className="mt-1 text-xs text-red">{batch.error}</p>}
              </div>
              <div className="text-right text-sm text-muted">
                <strong className="block text-foreground">{batch.parsedCount} 条</strong>
                已入库 {batch.savedCount} 条
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState reviewPack="import" stateId="import.batches.empty">批量上传或粘贴解析后，会在这里显示导入批次。</EmptyState>
      )}
    </Panel>
  );
}

// 渲染导入后的可编辑草稿列表，确认后才能批量入库。
function ImportDrafts({
  drafts,
  canUndoConfirmation,
  onBulkUpdateDrafts,
  onConfirmDrafts,
  onDeleteDrafts,
  onUpdateDraft,
  onUpdateDraftList,
  onUndoConfirmation,
}: {
  drafts: PersistedImportDraft[];
  canUndoConfirmation: boolean;
  onBulkUpdateDrafts: (ids: string[], patch: Partial<ImportDraft>) => void;
  onConfirmDrafts: (ids?: string[]) => void;
  onDeleteDrafts: (ids: string[]) => void;
  onUpdateDraft: (id: string, patch: Partial<ImportDraft>) => void;
  onUpdateDraftList: (id: string, key: "reasons" | "tags", value: string) => void;
  onUndoConfirmation: () => void;
}) {
  const [bulkBoard, setBulkBoard] = useState<Board>("常识判断");
  const [bulkSource, setBulkSource] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const visibleResetKey = `${drafts.length}|${drafts[0]?.id ?? "empty"}|${drafts.at(-1)?.id ?? "empty"}`;
  const { loadMore: loadMoreDrafts, visibleLimit } = useVisibleLimit(visibleResetKey, IMPORT_DRAFT_VISIBLE_STEP);
  const exceptionDrafts = useMemo(() => drafts.filter((draft) => draft.needsReview || draft.issues.length > 0), [drafts]);
  const displayedDrafts = showAllDrafts ? drafts : exceptionDrafts;
  const visibleDrafts = useMemo(() => displayedDrafts.slice(0, visibleLimit), [displayedDrafts, visibleLimit]);
  const selectedIds = useMemo(() => drafts.filter((draft) => draft.selected).map((draft) => draft.id), [drafts]);
  const selectedCount = selectedIds.length;
  const allDraftIds = useMemo(() => visibleDrafts.map((draft) => draft.id), [visibleDrafts]);
  const hasMoreDrafts = visibleDrafts.length < displayedDrafts.length;

  // 将批量输入写回选中草稿，空字段不覆盖已有内容。
  function applyBulkPatch() {
    const patch: Partial<ImportDraft> = { board: bulkBoard, needsReview: false };
    if (bulkSource.trim()) patch.source = bulkSource.trim();
    if (bulkTags.trim()) patch.tags = bulkTags.split(/[,，;；、\n]/).map((item) => item.trim()).filter(Boolean);
    onBulkUpdateDrafts(selectedIds, patch);
  }

  return (
    <Panel title="粉笔错题草稿" eyebrow="Drafts">
      <div className="ui-import-toolbar">
        <div>
          <p className="text-sm font-bold">已选 {selectedCount} 条 / 草稿 {drafts.length} 条</p>
          <p className="mt-1 text-xs text-muted">低置信度、缺答案、疑似重复和板块不确定会标记为需确认。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUndoConfirmation ? <Button size="sm" type="button" variant="outline" onClick={onUndoConfirmation}><AppIcon name="undo" size={14} />撤销本批</Button> : null}
          {drafts.length > exceptionDrafts.length ? <Button size="sm" type="button" variant="ghost" onClick={() => setShowAllDrafts((value) => !value)}>{showAllDrafts ? "只看异常" : `显示全部 ${drafts.length}`}</Button> : null}
          <Button size="sm" type="button" variant="outline" disabled={!visibleDrafts.length || visibleDrafts.every((draft) => draft.selected)} onClick={() => onBulkUpdateDrafts(allDraftIds, { selected: true })}>
            全选
          </Button>
          <Button size="sm" type="button" variant="ghost" disabled={!selectedCount} onClick={() => onBulkUpdateDrafts(selectedIds, { selected: false })}>
            清空
          </Button>
          <Button size="sm" type="button" variant="danger" disabled={!selectedCount} onClick={() => setDeleteOpen(true)}>
            删除已选
          </Button>
          <Button size="sm" type="button" variant="primary" disabled={!selectedCount} onClick={() => onConfirmDrafts(selectedIds)}>
            确认入库
          </Button>
        </div>
      </div>
      <div className="ui-import-bulk-grid">
        <SelectField label="批量板块" value={bulkBoard} onChange={(value) => setBulkBoard(value as Board)} options={[...BOARD_OPTIONS]} />
        <TextField label="批量来源" value={bulkSource} onChange={setBulkSource} placeholder="留空不覆盖" />
        <TextField label="批量标签" value={bulkTags} onChange={setBulkTags} placeholder="多个标签用逗号分隔" />
        <Button className="self-end" type="button" variant="soft" disabled={!selectedCount} onClick={applyBulkPatch}>
          应用到已选
        </Button>
      </div>
      {displayedDrafts.length ? (
        <div className="grid gap-4">
          {visibleDrafts.map((draft) => (
            <article key={draft.id} className="ui-card ui-card-muted">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-bold">
                  <input checked={draft.selected} type="checkbox" onChange={(event) => onUpdateDraft(draft.id, { selected: event.target.checked })} />
                  选中
                </label>
                <div className="flex flex-wrap gap-2">
                  {draft.fileName && <Chip>{draft.fileName}</Chip>}
                  {(draft.issues ?? []).map((issue) => (
                    <Chip key={issue} tone={issue === "duplicate" || issue === "missing_answer" ? "red" : "yellow"}>
                      {issueLabels[issue]}
                    </Chip>
                  ))}
                  {draft.needsReview && <Chip tone="yellow">需确认</Chip>}
                  {typeof draft.confidence === "number" && <Chip>置信度 {Math.round(draft.confidence * 100)}%</Chip>}
                  <Button size="sm" type="button" variant="danger" onClick={() => onDeleteDrafts([draft.id])}>
                    删除
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                <SelectField label="板块" value={draft.board} onChange={(value) => onUpdateDraft(draft.id, { board: value as Board, needsReview: false })} options={[...BOARD_OPTIONS]} />
                <TextField label="来源" value={draft.source} onChange={(value) => onUpdateDraft(draft.id, { source: value })} />
                <TextField label="掌握度" type="number" value={String(draft.mastery)} onChange={(value) => onUpdateDraft(draft.id, { mastery: Number(value) })} />
              </div>
              {draft.options.length > 0 && <TextAreaField className="mt-3" label="选项" value={toListText(draft.options)} onChange={(value) => onUpdateDraft(draft.id, { options: value.split(/\n|[,，]/).map((item) => item.trim()).filter(Boolean) })} />}
              <TextAreaField className="mt-3" label="题干" value={draft.stem} onChange={(value) => onUpdateDraft(draft.id, { stem: value })} />
              <div className="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <TextAreaField label="答案" value={draft.answer} onChange={(value) => onUpdateDraft(draft.id, { answer: value })} />
                <TextAreaField label="我的答案" value={draft.myAnswer} onChange={(value) => onUpdateDraft(draft.id, { myAnswer: value })} />
              </div>
              <div className="mt-3 grid gap-3">
                <TextAreaField label="解析" value={draft.explanation} onChange={(value) => onUpdateDraft(draft.id, { explanation: value })} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <TextField label="错因" value={toListText(draft.reasons)} onChange={(value) => onUpdateDraftList(draft.id, "reasons", value)} />
                <TextField label="标签" value={toListText(draft.tags)} onChange={(value) => onUpdateDraftList(draft.id, "tags", value)} />
              </div>
            </article>
          ))}
          {hasMoreDrafts && (
            <div className="text-center">
              <Button type="button" variant="soft" onClick={loadMoreDrafts}>
                显示更多（{visibleDrafts.length}/{displayedDrafts.length}）
              </Button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState reviewPack="import" stateId="import.drafts.empty">{drafts.length ? "正常草稿已折叠，可点击“显示全部”统一确认。" : "导入后会先生成可编辑草稿"}</EmptyState>
      )}
      <ConfirmDialog
        confirmLabel="删除草稿"
        description={`将删除 ${selectedCount} 条未入库草稿，不会影响已经保存的错题。`}
        open={deleteOpen}
        title="删除选中草稿？"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          onDeleteDrafts(selectedIds);
          setDeleteOpen(false);
        }}
      />
    </Panel>
  );
}
