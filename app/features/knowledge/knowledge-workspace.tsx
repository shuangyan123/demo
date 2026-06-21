"use client";

import type { SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { AssociationPanel } from "../shared/association-panel";
import { BulkToolbar, Button, CardButton, Chip, ConfirmDialog, DetailBlock, DetailCard, EmptyState, MasteryDots, MetricCard, Panel, SelectField, SoftBlock, TextAreaField, TextField } from "../shared/ui-primitives";
import { useBulkSelection } from "../shared/use-bulk-selection";
import { KnowledgeInternalizationPanel } from "./knowledge-internalization-panel";
import type { KnowledgeInternalizationController } from "./use-knowledge-internalization";
import { splitInput, textValue, toListText } from "../../lib/form-utils";
import { formatShortDate, masteryLabel } from "../../lib/review-utils";
import type { KnowledgeMatch, RelatedMistakeMatch } from "../../services/association-matcher";
import {
  KNOWLEDGE_CATEGORIES,
  type AssociationSuggestion,
  type ExportFormat,
  type ExportScope,
  type KnowledgeCategory,
  type KnowledgeCategorySummary,
  type KnowledgeEntry,
  type KnowledgeFilters,
  type KnowledgeMistakeLink,
  type KnowledgeQueueFilter,
  type Mistake,
  type ReviewResult,
} from "../../types/review";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

const knowledgeTemplateCopy: Record<KnowledgeCategory, { title: string; summary: string; tags: string; source: string; content: string }> = {
  政治理论: {
    title: "例如：新发展理念核心要点",
    summary: "概念、关键词、易混点和对应题型",
    tags: "理论关键词、时政、易混概念",
    source: "教材 / 课程 / 时政整理",
    content: "整理概念定义、关键词、常见问法和易混表述。",
  },
  常识判断: {
    title: "例如：行政法高频概念",
    summary: "定义、适用条件、例外和易错点",
    tags: "法律、科技、人文、地理",
    source: "题库 / 课程 / 手动整理",
    content: "整理知识点、判断标准、典型例子和容易混淆的选项。",
  },
  申论: {
    title: "例如：基层治理写作框架",
    summary: "适用主题、表达框架和可迁移素材",
    tags: "写作框架、素材、治理",
    source: "范文 / 材料 / 手动整理",
    content: "整理问题表现、原因分析、对策表达和可复用句式。",
  },
};

// 汇总三类知识库的资料、待训、薄弱和收藏数量，供知识中枢卡片复用。
export function buildKnowledgeCategorySummaries(entries: KnowledgeEntry[], dueEntries: KnowledgeEntry[], lowEntries: KnowledgeEntry[]): KnowledgeCategorySummary[] {
  const dueIds = new Set(dueEntries.map((entry) => entry.id));
  const lowIds = new Set(lowEntries.map((entry) => entry.id));
  return KNOWLEDGE_CATEGORIES.map((category) => {
    const categoryEntries = entries.filter((entry) => entry.category === category);
    return {
      category,
      total: categoryEntries.length,
      due: categoryEntries.filter((entry) => dueIds.has(entry.id)).length,
      weak: categoryEntries.filter((entry) => lowIds.has(entry.id)).length,
      favorites: categoryEntries.filter((entry) => entry.favorite).length,
    };
  });
}

// 根据训练队列筛选器生成当前训练列表，默认保持到期和薄弱资料优先。
export function filterKnowledgeTrainingQueue(entries: KnowledgeEntry[], dueEntries: KnowledgeEntry[], lowEntries: KnowledgeEntry[], filter: KnowledgeQueueFilter): KnowledgeEntry[] {
  const source =
    filter === "due"
      ? dueEntries
      : filter === "weak"
        ? lowEntries
        : filter === "favorite"
          ? entries.filter((entry) => entry.favorite)
          : [...dueEntries, ...lowEntries, ...entries];
  const seen = new Set<string>();
  return source
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt) || b.updatedAt.localeCompare(a.updatedAt));
}

// 展示错题关联到的知识库资料，点击条目会跳转到知识库并选中对应资料。
export function RelatedKnowledgeList({
  compact = false,
  matches,
  onOpenKnowledgeEntry,
}: {
  compact?: boolean;
  matches: KnowledgeMatch[];
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
}) {
  if (!matches.length) {
    return <p className="text-sm leading-6 text-muted">暂无匹配资料，可先在知识库补充同类知识点或标签。</p>;
  }

  return (
    <div className="grid gap-2">
      {matches.map((match) => (
        <CardButton
          key={match.entry.id}
          className="p-3"
          onClick={() => onOpenKnowledgeEntry(match.entry)}
        >
          <div className="flex items-start justify-between gap-3">
            <strong className={compact ? "line-clamp-1 text-sm" : "line-clamp-2"}>{match.entry.title}</strong>
            <Chip tone="blue">{match.entry.category}</Chip>
          </div>
          {!compact && <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{match.entry.summary || match.entry.content}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {match.reasons.slice(0, compact ? 1 : 2).map((reason) => (
              <span key={reason} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-muted">
                {reason}
              </span>
            ))}
          </div>
        </CardButton>
      ))}
    </div>
  );
}

// 渲染知识训练页，把每条知识资料当作闭卷自测卡片，并写回训练计划。
export function KnowledgeTrainingView({
  answerOpen,
  attemptsCount,
  correctRate,
  currentEntry,
  dueEntries,
  lowEntries,
  queueEntries,
  queueFilter,
  trainingIndex,
  onChangeQueueFilter,
  onMove,
  onOpenKnowledgeEntry,
  onRecordReview,
  onSkip,
  onSelectEntry,
  onToggleAnswer,
}: {
  answerOpen: boolean;
  attemptsCount: number;
  correctRate: number;
  currentEntry: KnowledgeEntry | null;
  dueEntries: KnowledgeEntry[];
  lowEntries: KnowledgeEntry[];
  queueEntries: KnowledgeEntry[];
  queueFilter: KnowledgeQueueFilter;
  trainingIndex: number;
  onChangeQueueFilter: (filter: KnowledgeQueueFilter) => void;
  onMove: (delta: -1 | 1) => void;
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onRecordReview: (result: ReviewResult) => void;
  onSkip: () => void;
  onSelectEntry: (entryId?: string) => void;
  onToggleAnswer: () => void;
}) {
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_320px] gap-4 max-xl:grid-cols-1">
      <DetailCard className="min-h-[570px]">
        <QueueFilterTabs active={queueFilter} onChange={onChangeQueueFilter} />
        {currentEntry ? (
          <>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-muted">
                  {currentEntry.category} · {currentEntry.source}
                </p>
                <h3 className="mt-1 text-xl font-extrabold">
                  第 {Math.min(trainingIndex + 1, queueEntries.length)} 条 / {queueEntries.length}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="yellow">{masteryLabel(currentEntry.mastery)}</Chip>
                <MasteryDots value={currentEntry.mastery} />
              </div>
            </div>

            <SoftBlock className="my-5">
              <strong className="block text-2xl leading-snug">{currentEntry.title}</strong>
              <p className="mt-3 text-base leading-7 text-muted">{currentEntry.summary || "先闭卷回想这条资料的关键词、适用场景和易混点。"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {currentEntry.tags.map((tag) => (
                  <Chip key={tag}>{tag}</Chip>
                ))}
              </div>
            </SoftBlock>

            <div className="flex flex-wrap gap-3 border-b border-line pb-4">
              <Button variant="outline" onClick={onToggleAnswer}>
                {answerOpen ? "收起资料" : "查看资料"}
              </Button>
              <Button className="border-emerald-200 text-green" variant="outline" onClick={() => onRecordReview("correct")}>
                会了
              </Button>
              <Button className="border-amber-200 text-yellow" variant="outline" onClick={() => onRecordReview("uncertain")}>
                犹豫
              </Button>
              <Button variant="danger" onClick={() => onRecordReview("wrong")}>
                不会
              </Button>
              <Button variant="outline" onClick={() => onMove(-1)}>
                上一条
              </Button>
              <Button variant="outline" onClick={() => onMove(1)}>
                下一条
              </Button>
              <Button variant="outline" onClick={onSkip}>
                跳过本次
              </Button>
              <Button variant="soft" onClick={() => onOpenKnowledgeEntry(currentEntry)}>
                编辑资料
              </Button>
            </div>

            {answerOpen && (
              <div className="mt-5 space-y-4 leading-relaxed">
                <DetailBlock title="资料正文">{currentEntry.content}</DetailBlock>
                <DetailBlock title="训练计划">
                  下次训练 {currentEntry.nextReviewAt} · 已训练 {currentEntry.reviewCount} 次
                  {currentEntry.lastReviewedAt ? ` · 最近 ${currentEntry.lastReviewedAt}` : ""}
                </DetailBlock>
              </div>
            )}
          </>
        ) : (
          <div className="mt-4">
            <EmptyState>当前筛选下没有知识资料。可以切换队列筛选，或先在知识库新增资料。</EmptyState>
          </div>
        )}
      </DetailCard>

      <aside className="space-y-4">
        <Panel title="训练概况" eyebrow="Session">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-blue/10 p-3 text-blue">
                <span className="text-xs font-bold">今日到期</span>
                <strong className="mt-1 block text-2xl">{dueEntries.length}</strong>
              </div>
              <div className="rounded-lg bg-red/10 p-3 text-red">
                <span className="text-xs font-bold">薄弱资料</span>
                <strong className="mt-1 block text-2xl">{lowEntries.length}</strong>
              </div>
            </div>
            <div className="ui-list-row text-sm leading-6 text-muted">
              已训练 {attemptsCount} 次，历史会了率 {correctRate}%。
            </div>
          </div>
        </Panel>

        <Panel title="训练队列" eyebrow="Queue">
          <div className="grid gap-2">
            {queueEntries.length ? (
              queueEntries.map((entry, index) => (
                <button
                  key={entry.id}
                  className={`grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg border p-3 text-left transition ${
                    currentEntry?.id === entry.id ? "border-blue/30 bg-blue/10" : "border-line hover:bg-surface-muted"
                  }`}
                  type="button"
                  onClick={() => onSelectEntry(entry.id)}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-surface text-sm font-extrabold text-blue">{index + 1}</span>
                  <span className="min-w-0">
                    <strong className="block truncate">{entry.title}</strong>
                    <small className="mt-1 block text-muted">
                      {entry.category} · {formatShortDate(entry.nextReviewAt)}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState>当前队列为空</EmptyState>
            )}
          </div>
        </Panel>
      </aside>
    </section>
  );
}

// 渲染三类知识库工作台，支持分类、搜索、收藏筛选和右侧编辑。
export function KnowledgeView({
  aiAssociationBusy,
  apiReady,
  allKnowledgeEntries,
  allMistakes,
  associationLinks,
  associationSuggestions,
  entries,
  filters,
  internalization,
  relatedMistakes,
  selectedEntry,
  summaries,
  tagOptions,
  onAddEntry,
  onAnalyzeKnowledgeAssociations,
  onChangeFilters,
  onClearAssociationSuggestions,
  onConfirmAssociationSuggestions,
  onCreateStarterDrafts,
  onDeleteAssociationSuggestion,
  onBulkDeleteEntries,
  onDeleteEntry,
  onExportKnowledgeEntries,
  onOpenRelatedMistake,
  onOpenSettings,
  onRemoveAssociationLink,
  onSelectEntry,
  onStartTraining,
  onToggleAssociationSuggestion,
  onToggleFavorite,
  onUpdateEntry,
}: {
  aiAssociationBusy: boolean;
  apiReady: boolean;
  allKnowledgeEntries: KnowledgeEntry[];
  allMistakes: Mistake[];
  associationLinks: KnowledgeMistakeLink[];
  associationSuggestions: AssociationSuggestion[];
  entries: KnowledgeEntry[];
  filters: KnowledgeFilters;
  internalization: KnowledgeInternalizationController;
  relatedMistakes: RelatedMistakeMatch[];
  selectedEntry: KnowledgeEntry | null;
  summaries: KnowledgeCategorySummary[];
  tagOptions: string[];
  onAddEntry: (event: SubmitReactEvent) => void;
  onAnalyzeKnowledgeAssociations: (entry: KnowledgeEntry) => void;
  onChangeFilters: (filters: KnowledgeFilters) => void;
  onClearAssociationSuggestions: (targetId: string) => void;
  onConfirmAssociationSuggestions: () => void;
  onCreateStarterDrafts: (category?: KnowledgeCategory) => void;
  onDeleteAssociationSuggestion: (id: string) => void;
  onBulkDeleteEntries: (ids: string[]) => void;
  onDeleteEntry: (id: string) => void;
  onExportKnowledgeEntries: (items: KnowledgeEntry[], format: ExportFormat, scope: ExportScope) => void;
  onOpenRelatedMistake: (mistake: Mistake) => void;
  onOpenSettings: () => void;
  onRemoveAssociationLink: (id: string) => void;
  onSelectEntry: (id: string) => void;
  onStartTraining: (entryId?: string) => void;
  onToggleAssociationSuggestion: (id: string, selected: boolean) => void;
  onToggleFavorite: (entry: KnowledgeEntry) => void;
  onUpdateEntry: (id: string, patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>) => void;
}) {
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const favorites = summaries.reduce((sum, item) => sum + item.favorites, 0);
  const dueCount = summaries.reduce((sum, item) => sum + item.due, 0);
  const weakCount = summaries.reduce((sum, item) => sum + item.weak, 0);
  const visibleEntryIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const bulkSelection = useBulkSelection(visibleEntryIds);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => bulkSelection.state.ids.has(entry.id)),
    [bulkSelection.state.ids, entries],
  );

  // 根据用户选择的范围导出知识资料，导出文件和通知由父级统一处理。
  function exportKnowledgeScope(scope: ExportScope, format: ExportFormat) {
    onExportKnowledgeEntries(scope === "selected" ? selectedEntries : entries, format, scope);
  }

  // 确认批量删除后清空选择，避免筛选切换后旧选区继续参与操作。
  function confirmBulkDelete() {
    onBulkDeleteEntries(Array.from(bulkSelection.state.ids));
    bulkSelection.clear();
    setBulkDeleteOpen(false);
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-5 gap-4 max-2xl:grid-cols-3 max-lg:grid-cols-1">
        <MetricCard label="资料总数" value={total} hint="政治理论、常识判断、申论三类资料" tone="bg-blue/10 text-blue" />
        <MetricCard label="收藏资料" value={favorites} hint="常用知识点可优先过滤" tone="bg-amber-50 text-yellow" />
        <MetricCard label="今日待训" value={dueCount} hint="下次训练日期已到期" tone="bg-blue/10 text-blue" />
        <MetricCard label="薄弱资料" value={weakCount} hint="掌握度 1-2 的资料" tone="bg-red/10 text-red" />
        <MetricCard label="当前结果" value={entries.length} hint="受分类、标签和搜索条件影响" tone="bg-emerald-50 text-green" />
      </div>

      <KnowledgeInternalizationPanel controller={internalization} entries={allKnowledgeEntries} mistakes={allMistakes} onOpenSettings={onOpenSettings} />

      <Panel title="三类知识中枢" eyebrow="Knowledge Hub">
        <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-1">
          {summaries.map((item) => (
            <article
              key={item.category}
              className="ui-card ui-card-muted grid gap-4 text-left transition hover:border-blue/40 hover:bg-blue/5"
            >
              <button className="text-left" type="button" onClick={() => onChangeFilters({ ...filters, category: item.category })}>
                <strong className="text-lg">{item.category}</strong>
              </button>
              <span className="grid grid-cols-4 gap-2 text-sm text-muted">
                <span><b className="block text-xl text-foreground">{item.total}</b>资料</span>
                <span><b className="block text-xl text-blue">{item.due}</b>待训</span>
                <span><b className="block text-xl text-red">{item.weak}</b>薄弱</span>
                <span><b className="block text-xl text-yellow">{item.favorites}</b>收藏</span>
              </span>
              <Button className="w-fit" size="sm" type="button" variant="outline" onClick={() => onCreateStarterDrafts(item.category)}>
                生成模板草稿
              </Button>
            </article>
          ))}
        </div>
      </Panel>

      <KnowledgeStarterGuide summaries={summaries} onCreateStarterDrafts={onCreateStarterDrafts} />

      <div className="grid grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] gap-4 max-2xl:grid-cols-1">
        <div className="space-y-4">
          <KnowledgeFiltersPanel filters={filters} summaries={summaries} tagOptions={tagOptions} onChangeFilters={onChangeFilters} />
          <BulkToolbar
            allVisibleSelected={bulkSelection.state.allVisibleSelected}
            selectedCount={bulkSelection.state.count}
            totalCount={entries.length}
            onClearSelection={bulkSelection.clear}
            onDeleteSelected={() => setBulkDeleteOpen(true)}
            onExportFiltered={(format) => exportKnowledgeScope("filtered", format)}
            onExportSelected={(format) => exportKnowledgeScope("selected", format)}
            onSelectAllVisible={bulkSelection.selectAllVisible}
          />
          <KnowledgeEntryList
            entries={entries}
            selectedEntry={selectedEntry}
            selectedIds={bulkSelection.state.ids}
            onSelectEntry={onSelectEntry}
            onToggleSelected={bulkSelection.toggle}
          />
        </div>

        <div className="space-y-4">
          <KnowledgeEntryEditor
            aiAssociationBusy={aiAssociationBusy}
            apiReady={apiReady}
            associationLinks={associationLinks}
            associationSuggestions={associationSuggestions}
            knowledgeEntries={allKnowledgeEntries}
            entry={selectedEntry}
            mistakes={allMistakes}
            relatedMistakes={relatedMistakes}
            onAnalyzeKnowledgeAssociations={onAnalyzeKnowledgeAssociations}
            onClearAssociationSuggestions={onClearAssociationSuggestions}
            onConfirmAssociationSuggestions={onConfirmAssociationSuggestions}
            onDeleteAssociationSuggestion={onDeleteAssociationSuggestion}
            onDeleteEntry={onDeleteEntry}
            onOpenRelatedMistake={onOpenRelatedMistake}
            onOpenSettings={onOpenSettings}
            onRemoveAssociationLink={onRemoveAssociationLink}
            onStartTraining={onStartTraining}
            onToggleAssociationSuggestion={onToggleAssociationSuggestion}
            onToggleFavorite={onToggleFavorite}
            onUpdateEntry={onUpdateEntry}
          />
          <KnowledgeCreateForm defaultCategory={filters.category === "全部" ? "政治理论" : filters.category} onAddEntry={onAddEntry} />
        </div>
      </div>
      <ConfirmDialog
        confirmLabel="删除"
        description={`将删除 ${bulkSelection.state.count} 条知识资料，并同步清理训练记录和错题关联。此操作不会删除错题、API 设置或导入任务。`}
        open={bulkDeleteOpen}
        title="确认批量删除知识资料？"
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
      />
    </section>
  );
}

// 渲染知识库搭建引导，帮助空库用户按三类资料先生成可编辑模板草稿。
function KnowledgeStarterGuide({
  onCreateStarterDrafts,
  summaries,
}: {
  onCreateStarterDrafts: (category?: KnowledgeCategory) => void;
  summaries: KnowledgeCategorySummary[];
}) {
  const emptyCategories = summaries.filter((item) => item.total === 0);
  return (
    <Panel title="资料搭建助手" eyebrow="Starter">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 max-lg:grid-cols-1">
        <div className="text-sm leading-6 text-muted">
          <strong className="mb-1 block text-base text-foreground">先搭框架，再填内容。</strong>
          政治理论、常识判断、申论会生成不同的整理模板，进入草稿区后可逐条编辑、删除或确认入库。
          {emptyCategories.length > 0 && (
            <span className="mt-1 block">当前空分类：{emptyCategories.map((item) => item.category).join("、")}。</span>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-lg:justify-start">
          {summaries.map((item) => (
            <Button
              key={item.category}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onCreateStarterDrafts(item.category)}
            >
              {item.category}
            </Button>
          ))}
          <Button size="sm" type="button" variant="primary" onClick={() => onCreateStarterDrafts()}>
            全部模板
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// 渲染知识库筛选区，保持分类、标签、搜索和收藏筛选集中在一块。
function KnowledgeFiltersPanel({
  filters,
  summaries,
  tagOptions,
  onChangeFilters,
}: {
  filters: KnowledgeFilters;
  summaries: KnowledgeCategorySummary[];
  tagOptions: string[];
  onChangeFilters: (filters: KnowledgeFilters) => void;
}) {
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  return (
    <Panel title="筛选" eyebrow="Search">
      <div className="grid gap-3">
        <button
          className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
            filters.category === "全部" ? "border-blue/30 bg-blue/10 text-blue" : "border-line hover:bg-surface-muted"
          }`}
          type="button"
          onClick={() => onChangeFilters({ ...filters, category: "全部" })}
        >
          <strong>全部资料</strong>
          <span className="text-sm text-muted">{total}</span>
        </button>
        {summaries.map((item) => (
          <button
            key={item.category}
            className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition ${
              filters.category === item.category ? "border-blue/30 bg-blue/10 text-blue" : "border-line hover:bg-surface-muted"
            }`}
            type="button"
            onClick={() => onChangeFilters({ ...filters, category: item.category })}
          >
            <span>
              <strong className="block">{item.category}</strong>
              <small className="text-muted">待训 {item.due} · 薄弱 {item.weak}</small>
            </span>
            <span className="text-sm text-muted">{item.total}</span>
          </button>
        ))}
        <TextField label="搜索" value={filters.search} placeholder="标题、摘要、正文、来源" onChange={(value) => onChangeFilters({ ...filters, search: value })} />
        <SelectField label="标签" value={filters.tag} options={tagOptions} onChange={(value) => onChangeFilters({ ...filters, tag: value })} />
        <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
          <input checked={filters.favoriteOnly} type="checkbox" onChange={(event) => onChangeFilters({ ...filters, favoriteOnly: event.target.checked })} />
          只看收藏
        </label>
      </div>
    </Panel>
  );
}

// 渲染知识库条目列表，列表中直接展示训练状态，便于快速扫弱项。
function KnowledgeEntryList({
  entries,
  selectedEntry,
  selectedIds,
  onSelectEntry,
  onToggleSelected,
}: {
  entries: KnowledgeEntry[];
  selectedEntry: KnowledgeEntry | null;
  selectedIds: Set<string>;
  onSelectEntry: (id: string) => void;
  onToggleSelected: (id: string, checked: boolean) => void;
}) {
  return (
    <Panel title="知识条目" eyebrow="Entries">
      <div className="grid gap-3">
        {entries.length ? (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`ui-card ui-card-muted grid grid-cols-[28px_minmax(0,1fr)] gap-3 p-3 transition hover:border-blue/40 hover:bg-blue/5 ${
                selectedEntry?.id === entry.id ? "ui-list-row-active" : ""
              }`}
            >
              <input
                aria-label={`选择知识资料：${entry.title}`}
                checked={selectedIds.has(entry.id)}
                className="ui-checkbox mt-1"
                type="checkbox"
                onChange={(event) => onToggleSelected(entry.id, event.target.checked)}
              />
              <button className="min-w-0 text-left" type="button" onClick={() => onSelectEntry(entry.id)}>
                <div className="flex items-start justify-between gap-3">
                  <strong>{entry.title}</strong>
                  <span className="text-yellow">{entry.favorite ? "★" : ""}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{entry.summary || entry.content}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Chip tone="blue">{entry.category}</Chip>
                  <Chip tone={entry.mastery <= 2 ? "yellow" : "green"}>{formatShortDate(entry.nextReviewAt)} 训练</Chip>
                  {entry.tags.slice(0, 3).map((tag) => (
                    <Chip key={tag}>{tag}</Chip>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
                  <span>已训练 {entry.reviewCount} 次</span>
                  <MasteryDots value={entry.mastery} />
                </div>
              </button>
            </div>
          ))
        ) : (
          <EmptyState>暂无匹配资料</EmptyState>
        )}
      </div>
    </Panel>
  );
}

// 渲染选中知识条目的编辑区；保存时只提交表单字段，避免覆盖创建时间和 ID。
function KnowledgeEntryEditor({
  aiAssociationBusy,
  apiReady,
  associationLinks,
  associationSuggestions,
  entry,
  knowledgeEntries,
  mistakes,
  relatedMistakes,
  onAnalyzeKnowledgeAssociations,
  onClearAssociationSuggestions,
  onConfirmAssociationSuggestions,
  onDeleteAssociationSuggestion,
  onDeleteEntry,
  onOpenRelatedMistake,
  onOpenSettings,
  onRemoveAssociationLink,
  onStartTraining,
  onToggleAssociationSuggestion,
  onToggleFavorite,
  onUpdateEntry,
}: {
  aiAssociationBusy: boolean;
  apiReady: boolean;
  associationLinks: KnowledgeMistakeLink[];
  associationSuggestions: AssociationSuggestion[];
  entry: KnowledgeEntry | null;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  relatedMistakes: RelatedMistakeMatch[];
  onAnalyzeKnowledgeAssociations: (entry: KnowledgeEntry) => void;
  onClearAssociationSuggestions: (targetId: string) => void;
  onConfirmAssociationSuggestions: () => void;
  onDeleteAssociationSuggestion: (id: string) => void;
  onDeleteEntry: (id: string) => void;
  onOpenRelatedMistake: (mistake: Mistake) => void;
  onOpenSettings: () => void;
  onRemoveAssociationLink: (id: string) => void;
  onStartTraining: (entryId?: string) => void;
  onToggleAssociationSuggestion: (id: string, selected: boolean) => void;
  onToggleFavorite: (entry: KnowledgeEntry) => void;
  onUpdateEntry: (id: string, patch: Partial<Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">>) => void;
}) {
  if (!entry) {
    return (
      <Panel title="详情编辑" eyebrow="Detail">
        <EmptyState>选择一条资料后在这里编辑；也可以直接新增资料。</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel title="详情编辑" eyebrow="Detail">
      <form
        key={entry.id}
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          onUpdateEntry(entry.id, {
            category: textValue(formData.get("category")) as KnowledgeCategory,
            title: textValue(formData.get("title")),
            summary: textValue(formData.get("summary")),
            content: textValue(formData.get("content")),
            tags: splitInput(formData.get("tags")),
            source: textValue(formData.get("source")),
            favorite: entry.favorite,
          });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Chip tone="blue">{entry.category}</Chip>
          <div className="flex gap-2">
            <Button size="sm" type="button" variant="soft" onClick={() => onStartTraining(entry.id)}>
              训练
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={() => onToggleFavorite(entry)}>
              {entry.favorite ? "取消收藏" : "收藏"}
            </Button>
            <Button size="sm" type="button" variant="danger" onClick={() => onDeleteEntry(entry.id)}>
              删除
            </Button>
          </div>
        </div>
        <SelectField label="分类" name="category" defaultValue={entry.category} options={[...KNOWLEDGE_CATEGORIES]} />
        <TextField label="标题" name="title" defaultValue={entry.title} required />
        <TextField label="摘要" name="summary" defaultValue={entry.summary} placeholder="列表中显示的短摘要" />
        <TextField label="标签" name="tags" defaultValue={toListText(entry.tags)} placeholder="用逗号或顿号分隔" />
        <TextField label="来源" name="source" defaultValue={entry.source} placeholder="手动整理 / 课程 / 资料导入" />
        <TextAreaField className="min-h-64" label="正文" name="content" defaultValue={entry.content} required />
        <Button type="submit" variant="primary">
          保存修改
        </Button>
        <SoftBlock className="grid gap-2 text-sm text-muted">
          <div className="flex flex-wrap items-center gap-3">
            <span>掌握度：{masteryLabel(entry.mastery)}</span>
            <MasteryDots value={entry.mastery} />
          </div>
          <span>
            下次训练：{entry.nextReviewAt} · 已训练 {entry.reviewCount} 次{entry.lastReviewedAt ? ` · 最近训练 ${entry.lastReviewedAt}` : ""}
          </span>
        </SoftBlock>
      </form>
      <div className="mt-4">
        <AssociationPanel
          aiBusy={aiAssociationBusy}
          apiReady={apiReady}
          knowledgeEntries={knowledgeEntries}
          links={associationLinks}
          localMistakeMatches={relatedMistakes}
          mistakes={mistakes}
          mode="knowledge"
          suggestions={associationSuggestions}
          onAnalyze={() => onAnalyzeKnowledgeAssociations(entry)}
          onClearSuggestions={() => onClearAssociationSuggestions(entry.id)}
          onConfirmSuggestions={onConfirmAssociationSuggestions}
          onDeleteSuggestion={onDeleteAssociationSuggestion}
          onOpenKnowledgeEntry={() => undefined}
          onOpenMistake={onOpenRelatedMistake}
          onOpenSettings={onOpenSettings}
          onRemoveLink={onRemoveAssociationLink}
          onToggleSuggestion={onToggleAssociationSuggestion}
        />
      </div>
    </Panel>
  );
}

// 渲染新增知识资料表单，分类变化时只调整提示模板，不自动写入任何示例资料。
function KnowledgeCreateForm({ defaultCategory, onAddEntry }: { defaultCategory: KnowledgeCategory; onAddEntry: (event: SubmitReactEvent) => void }) {
  const [category, setCategory] = useState<KnowledgeCategory>(defaultCategory);
  const template = knowledgeTemplateCopy[category];
  return (
    <Panel title="新增资料" eyebrow="Create">
      <form className="grid gap-3" onSubmit={onAddEntry}>
        <SelectField label="分类" name="category" value={category} onChange={(value) => setCategory(value as KnowledgeCategory)} options={[...KNOWLEDGE_CATEGORIES]} />
        <TextField label="标题" name="title" placeholder={template.title} required />
        <TextField label="摘要" name="summary" placeholder={template.summary} />
        <TextField label="标签" name="tags" placeholder={template.tags} />
        <TextField label="来源" name="source" placeholder={template.source} />
        <TextAreaField label="正文" name="content" placeholder={template.content} required />
        <Button type="submit" variant="primary">
          保存到知识库
        </Button>
      </form>
    </Panel>
  );
}

// 渲染训练队列筛选按钮，四个模式只影响前端队列，不修改资料数据。
function QueueFilterTabs({ active, onChange }: { active: KnowledgeQueueFilter; onChange: (filter: KnowledgeQueueFilter) => void }) {
  const options: Array<[KnowledgeQueueFilter, string]> = [
    ["due", "今日到期"],
    ["weak", "薄弱"],
    ["favorite", "收藏"],
    ["all", "全部"],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([value, label]) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={active === value ? "soft" : "outline"}
          onClick={() => onChange(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
