"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { Button, Chip, ConfirmDialog, EmptyState, Panel, SelectField, SoftBlock, TextAreaField, TextField } from "../shared/ui-primitives";
import { useVisibleLimit } from "../shared/use-visible-limit";
import { toListText } from "../../lib/form-utils";
import { FenbiQuickImportPanel } from "./fenbi-quick-import-panel";
import type { useFenbiQuickImport } from "./use-fenbi-quick-import.ts";
import styles from "./review-import-view.module.css";
import { BOARD_OPTIONS, type Board } from "../../types/domains/review.ts";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeImportDraft } from "../../types/domains/knowledge.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { ImportBatch, ImportDraft, ImportDraftIssue, ImportJob, PersistedImportDraft } from "../../types/domains/import.ts";

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
  importJobs,
  fenbiQuickImport,
  canUndoConfirmation,
  knowledgeDrafts,
  onBulkUpdateDrafts,
  onConfirmDrafts,
  onConfirmKnowledgeDrafts,
  onDeleteDrafts,
  onDeleteKnowledgeDraft,
  onImportKnowledgeText,
  onParseFileImport,
  onParseTextImport,
  onSwitchSettings,
  onUpdateDraft,
  onUpdateDraftList,
  onUpdateKnowledgeDraft,
  onUpdateKnowledgeDraftList,
  onUndoConfirmation,
}: {
  textConnection?: ApiConnectionProfile;
  visionConnection?: ApiConnectionProfile;
  batches: ImportBatch[];
  drafts: PersistedImportDraft[];
  importBusy: boolean;
  importJobs: ImportJob[];
  fenbiQuickImport: ReturnType<typeof useFenbiQuickImport>;
  canUndoConfirmation: boolean;
  knowledgeDrafts: KnowledgeImportDraft[];
  onBulkUpdateDrafts: (ids: string[], patch: Partial<ImportDraft>) => void;
  onConfirmDrafts: (ids?: string[]) => void;
  onConfirmKnowledgeDrafts: () => void;
  onDeleteDrafts: (ids: string[]) => void;
  onDeleteKnowledgeDraft: (id: string) => void;
  onImportKnowledgeText: (event: SubmitReactEvent) => void;
  onParseFileImport: (event: SubmitReactEvent) => void;
  onParseTextImport: (event: SubmitReactEvent, mode: "local" | "ai") => void;
  onSwitchSettings: () => void;
  onUpdateDraft: (id: string, patch: Partial<ImportDraft>) => void;
  onUpdateDraftList: (id: string, key: "reasons" | "tags", value: string) => void;
  onUpdateKnowledgeDraft: (id: string, patch: Partial<KnowledgeImportDraft>) => void;
  onUpdateKnowledgeDraftList: (id: string, value: string) => void;
  onUndoConfirmation: () => void;
}) {
  const [mobileStep, setMobileStep] = useState<ImportMobileStep>("source");
  return (
    <section className={styles.workspace} data-step={mobileStep}>
      <header className={styles.header}>
        <div><h1>导入资料</h1><p>来源解析与草稿确认完全分离；确认前不会写入错题库或知识库。</p></div>
        <Chip tone={drafts.length + knowledgeDrafts.length ? "yellow" : "neutral"}>{drafts.length + knowledgeDrafts.length} 条待确认</Chip>
      </header>
      <nav className={styles.steps} aria-label="导入步骤">
        {([["source", "1 来源"], ["draft", "2 草稿"], ["confirm", "3 确认"]] as Array<[ImportMobileStep, string]>).map(([value, label]) => (
          <button key={value} aria-current={mobileStep === value ? "step" : undefined} type="button" onClick={() => setMobileStep(value)}>{label}</button>
        ))}
      </nav>
      <div className={styles.layout}>
      <div className={styles.sources}>
      <FenbiQuickImportPanel
        credential={fenbiQuickImport.credential}
        error={fenbiQuickImport.error}
        errorCode={fenbiQuickImport.errorCode}
        fallbackRecommended={fenbiQuickImport.fallbackRecommended}
        progress={fenbiQuickImport.progress}
        requestId={fenbiQuickImport.requestId}
        stage={fenbiQuickImport.stage}
        status={fenbiQuickImport.status}
        onCancel={fenbiQuickImport.cancel}
        onParseFileImport={onParseFileImport}
        onSaveCookie={fenbiQuickImport.saveCookie}
        onSync={fenbiQuickImport.sync}
        onValidate={fenbiQuickImport.validate}
      />

      <details className="ui-panel">
        <summary className="cursor-pointer text-sm font-semibold">更多导入方式：粘贴文本与 AI 解析</summary>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
        <form
          className="ui-panel"
          onSubmit={(event) => {
            const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            onParseTextImport(event, submitter?.dataset.mode === "ai" ? "ai" : "local");
          }}
        >
          <p className="text-xs font-extrabold uppercase text-muted">Fenbi Import</p>
          <h3 className="mt-1 text-lg font-extrabold">粉笔错题文本导入</h3>
          <label className="mt-4 grid gap-2 text-sm font-bold text-slate-700">
            原始文本
            <textarea className="ui-textarea min-h-56 resize-y" name="rawText" placeholder="粘贴粉笔错题、答案、解析；支持用空行分隔多题" />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="submit" data-mode="local" disabled={importBusy} variant="primary">
              本地解析
            </Button>
            <Button type="submit" data-mode="ai" disabled={importBusy} variant="soft">
              AI 解析
            </Button>
          </div>
        </form>

        <Panel title="API 与文件" eyebrow="OCR">
          <div className="grid gap-4">
            <SoftBlock>
              <span className="text-xs text-muted">默认文本连接</span>
              <strong className="mt-1 block">{textConnection?.label ?? "未配置"}</strong>
              <span className="mt-3 block text-xs text-muted">默认多模态连接</span>
              <strong className="mt-1 block">{visionConnection?.label ?? "未配置"}</strong>
              <Button className="mt-3" size="sm" type="button" variant="outline" onClick={onSwitchSettings}>
                设置 AI 连接
              </Button>
            </SoftBlock>
            <form className="grid gap-3" onSubmit={onParseFileImport}>
              <label className="grid gap-2 text-sm font-bold text-slate-700">
                批量文件导入
                <input className="ui-input" name="files" type="file" accept="image/*,.pdf,.doc,.docx,.txt,.csv,.json" multiple />
              </label>
              <Button type="submit" disabled={importBusy} variant="primary">
                上传并解析
              </Button>
              <p className="text-xs leading-5 text-muted">图片会调用多模态 OCR；txt、csv、json 本地解析；PDF 先读文本层，无文本时按页 OCR；docx 会提取正文。</p>
            </form>
          </div>
        </Panel>
      </div>
      </details>

      <Panel title="导入为知识库资料" eyebrow="Knowledge">
        <form className="grid gap-3" onSubmit={onImportKnowledgeText}>
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
            <SelectField label="知识分类" name="knowledgeCategory" defaultValue="政治理论" options={[...KNOWLEDGE_CATEGORIES]} />
            <TextField label="标签" name="knowledgeTags" placeholder="时政、法律、写作素材" />
            <TextField label="来源" name="knowledgeSource" placeholder="资料导入 / 课程 / 手动整理" />
          </div>
          <TextAreaField
            label="资料文本"
            name="knowledgeText"
            placeholder="粘贴知识点、申论素材、常识资料；用空行分隔多条资料"
            required
          />
          <Button className="w-fit" type="submit" variant="primary">
            生成资料草稿
          </Button>
        </form>
      </Panel>
      </div>

      <div className={styles.drafts}>
      <KnowledgeImportDrafts
        drafts={knowledgeDrafts}
        onConfirmDrafts={onConfirmKnowledgeDrafts}
        onDeleteDraft={onDeleteKnowledgeDraft}
        onUpdateDraft={onUpdateKnowledgeDraft}
        onUpdateDraftList={onUpdateKnowledgeDraftList}
      />

      <ImportBatchList batches={batches} />

      <ImportDrafts
        drafts={drafts}
        canUndoConfirmation={canUndoConfirmation}
        onConfirmDrafts={onConfirmDrafts}
        onBulkUpdateDrafts={onBulkUpdateDrafts}
        onDeleteDrafts={onDeleteDrafts}
        onUpdateDraft={onUpdateDraft}
        onUpdateDraftList={onUpdateDraftList}
        onUndoConfirmation={onUndoConfirmation}
      />

      <Panel title="导入任务" eyebrow="Jobs">
        <div className="grid gap-3">
          {importJobs.length ? (
            importJobs.map((job) => (
              <article key={job.id} className="ui-list-row">
                <div className="flex items-center justify-between gap-3">
                  <strong>{job.fileName ?? job.type.toUpperCase()}</strong>
                  <Chip tone={job.status === "failed" ? "red" : job.status === "saved" ? "green" : "blue"}>{job.status}</Chip>
                </div>
                <p className="mt-2 text-sm text-muted">{job.message}</p>
                <small className="mt-2 block text-muted">
                  {job.createdAt} · {job.parsedCount} 条
                </small>
              </article>
            ))
          ) : (
            <EmptyState>暂无导入任务</EmptyState>
          )}
        </div>
      </Panel>
      </div>
      </div>
    </section>
  );
}

// 渲染知识库导入草稿预览，用户确认前可以编辑拆分结果并剔除误切分条目。
function KnowledgeImportDrafts({
  drafts,
  onConfirmDrafts,
  onDeleteDraft,
  onUpdateDraft,
  onUpdateDraftList,
}: {
  drafts: KnowledgeImportDraft[];
  onConfirmDrafts: () => void;
  onDeleteDraft: (id: string) => void;
  onUpdateDraft: (id: string, patch: Partial<KnowledgeImportDraft>) => void;
  onUpdateDraftList: (id: string, value: string) => void;
}) {
  const selectedCount = drafts.filter((draft) => draft.selected).length;

  return (
    <Panel title="知识资料草稿" eyebrow="Knowledge Drafts">
      <div className="mb-4 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
        <p className="text-sm text-muted">资料导入会先进入草稿区，确认前不会写入 IndexedDB。</p>
        <Button type="button" disabled={!selectedCount} variant="primary" onClick={onConfirmDrafts}>
          确认保存 {selectedCount || ""} 条
        </Button>
      </div>
      {drafts.length ? (
        <div className="grid gap-4">
          {drafts.map((draft) => (
            <article key={draft.id} className="ui-card ui-card-muted">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-bold">
                  <input checked={draft.selected} type="checkbox" onChange={(event) => onUpdateDraft(draft.id, { selected: event.target.checked })} />
                  选中保存
                </label>
                <div className="flex flex-wrap gap-2">
                  <Chip tone="blue">{draft.category}</Chip>
                  <Button size="sm" type="button" variant="danger" onClick={() => onDeleteDraft(draft.id)}>
                    删除
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                <SelectField label="知识分类" value={draft.category} onChange={(value) => onUpdateDraft(draft.id, { category: value as KnowledgeCategory })} options={[...KNOWLEDGE_CATEGORIES]} />
                <TextField label="来源" value={draft.source} onChange={(value) => onUpdateDraft(draft.id, { source: value })} />
                <TextField label="掌握度" type="number" value={String(draft.mastery)} onChange={(value) => onUpdateDraft(draft.id, { mastery: Math.max(1, Math.min(5, Number(value) || 1)) })} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                <TextField label="标题" value={draft.title} onChange={(value) => onUpdateDraft(draft.id, { title: value })} />
                <TextField label="标签" value={toListText(draft.tags)} onChange={(value) => onUpdateDraftList(draft.id, value)} />
              </div>
              <TextAreaField className="mt-3" label="摘要" value={draft.summary} onChange={(value) => onUpdateDraft(draft.id, { summary: value })} />
              <TextAreaField className="mt-3" label="正文" value={draft.content} onChange={(value) => onUpdateDraft(draft.id, { content: value })} />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState>资料导入后会先显示预览，可编辑确认后再入库。</EmptyState>
      )}
    </Panel>
  );
}

const issueLabels: Record<ImportDraftIssue, string> = {
  duplicate: "疑似重复",
  low_confidence: "低置信度",
  missing_answer: "缺答案",
  unknown_board: "板块待确认",
};

// 渲染粉笔导入批次，帮助用户回看最近一次批量上传的解析状态。
function ImportBatchList({ batches }: { batches: ImportBatch[] }) {
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
        <EmptyState>批量上传或粘贴解析后，会在这里显示导入批次。</EmptyState>
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
          {canUndoConfirmation ? <Button size="sm" type="button" variant="outline" onClick={onUndoConfirmation}>撤销本批</Button> : null}
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
        <EmptyState>{drafts.length ? "正常草稿已折叠，可点击“显示全部”统一确认。" : "导入后会先生成可编辑草稿"}</EmptyState>
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
