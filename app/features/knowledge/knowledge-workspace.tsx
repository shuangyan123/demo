"use client";

import type { SyntheticEvent } from "react";
import { useState } from "react";
import { BulkToolbar, Button, CardButton, Chip, ConfirmDialog, DetailBlock, DetailCard, EmptyState, MasteryDots, Panel, SoftBlock } from "../shared/ui-primitives";
import { KnowledgeInternalizationPanel } from "./knowledge-internalization-panel";
import { KnowledgeEntryEditor } from "./knowledge-entry-editor";
import { KnowledgeLibraryFilters, KnowledgeLibraryList } from "./knowledge-library-list";
import { KnowledgeCreateForm, KnowledgeStarterGuide } from "./knowledge-starter-controls";
import { ObsidianKnowledgePanel } from "./obsidian-knowledge-panel";
import { useKnowledgeListController } from "./use-knowledge-list-controller.ts";
import { useObsidianKnowledgeBridge } from "./use-obsidian-knowledge-bridge.ts";
import type { KnowledgeInternalizationController } from "./use-knowledge-internalization.ts";
import { formatShortDate, masteryLabel } from "../../lib/review-utils";
import type { KnowledgeMatch, RelatedMistakeMatch } from "../../services/association-matcher";
import { KNOWLEDGE_CATEGORIES, type KnowledgeCategory, type KnowledgeCategorySummary, type KnowledgeEntry, type KnowledgeFilters, type KnowledgeQueueFilter } from "../../types/domains/knowledge.ts";
import type { AssociationSuggestion, KnowledgeMistakeLink } from "../../types/domains/association.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { ExportFormat, ExportScope, Mistake, ReviewResult } from "../../types/domains/review.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";

type SubmitReactEvent = SyntheticEvent<HTMLFormElement, SubmitEvent>;

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
    return <p className="text-sm leading-6 text-muted" data-review-state="knowledge.suggestions.filtered-empty">暂无匹配资料，可先在知识库补充同类知识点或标签。</p>;
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
            <EmptyState stateId="knowledge.workspace.results.empty">当前筛选下没有知识资料。可以切换队列筛选，或先在知识库新增资料。</EmptyState>
          </div>
        )}
      </DetailCard>

      <aside className="space-y-4">
        <Panel title="训练概况" eyebrow="Session">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--interactive-selected-bg)] p-3 text-foreground">
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
                    currentEntry?.id === entry.id ? "border-foreground/30 bg-[var(--interactive-selected-bg)]" : "border-line hover:bg-surface-muted"
                  }`}
                  type="button"
                  onClick={() => onSelectEntry(entry.id)}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-surface text-sm font-extrabold text-foreground">{index + 1}</span>
                  <span className="min-w-0">
                    <strong className="block truncate">{entry.title}</strong>
                    <small className="mt-1 block text-muted">
                      {entry.category} · {formatShortDate(entry.nextReviewAt)}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState reviewPack="learning" stateId="knowledge.workspace.queue.empty">当前队列为空</EmptyState>
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
  onKnowledgeChanged,
  onNotice,
  personalizationSettings,
  textConnection,
  sampleMode = false,
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
  onKnowledgeChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  personalizationSettings: PersonalizationSettings;
  textConnection?: ApiConnectionProfile;
  sampleMode?: boolean;
}) {
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const favorites = summaries.reduce((sum, item) => sum + item.favorites, 0);
  const dueCount = summaries.reduce((sum, item) => sum + item.due, 0);
  const weakCount = summaries.reduce((sum, item) => sum + item.weak, 0);
  const obsidian = useObsidianKnowledgeBridge({ entries: allKnowledgeEntries, personalization: personalizationSettings, textConnection, onChanged: onKnowledgeChanged, onNotice, sampleMode });
  const knowledgeList = useKnowledgeListController({ entries, filters, onBulkDeleteEntries, onExportKnowledgeEntries });
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  return (
    <section className="learning-page">
      <header className="learning-page-header">
        <p className="text-sm text-muted">整理资料、训练薄弱知识，并同步到 Obsidian。</p>
        <div className="learning-metrics" aria-label="知识库概览">
          <span><strong>{total}</strong>全部资料</span>
          <span><strong>{favorites}</strong>收藏</span>
          <span><strong>{dueCount}</strong>今日待训</span>
          <span><strong>{weakCount}</strong>薄弱项</span>
          <span><strong>{entries.length}</strong>当前结果</span>
        </div>
      </header>

      <KnowledgeLibraryFilters filters={filters} summaries={summaries} tagOptions={tagOptions} onChangeFilters={onChangeFilters} />
      <BulkToolbar
        allVisibleSelected={knowledgeList.bulkSelection.state.allVisibleSelected}
        selectedCount={knowledgeList.bulkSelection.state.count}
        totalCount={knowledgeList.visibleEntries.length}
        onClearSelection={knowledgeList.bulkSelection.clear}
        onDeleteSelected={() => knowledgeList.setBulkDeleteOpen(true)}
        onExportFiltered={(format) => knowledgeList.exportKnowledgeScope("filtered", format)}
        onExportSelected={(format) => knowledgeList.exportKnowledgeScope("selected", format)}
        onSelectAllVisible={knowledgeList.bulkSelection.selectAllVisible}
      />
      <div className="learning-master-detail">
        <div className="learning-list">
          <KnowledgeLibraryList
            entries={knowledgeList.visibleEntries}
            hasMoreEntries={knowledgeList.hasMoreEntries}
            selectedEntry={selectedEntry}
            selectedIds={knowledgeList.bulkSelection.state.ids}
            totalCount={entries.length}
            onLoadMore={knowledgeList.loadMoreEntries}
            onSelectEntry={(id) => {
              onSelectEntry(id);
              setMobileDetailOpen(true);
            }}
            onToggleSelected={knowledgeList.bulkSelection.toggle}
          />
        </div>

        <div className="learning-detail" data-mobile-open={mobileDetailOpen}>
          <Button className="learning-mobile-detail-close" size="sm" variant="ghost" onClick={() => setMobileDetailOpen(false)}>返回知识列表</Button>
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
            obsidianUri={selectedEntry ? obsidian.uriForKnowledge(selectedEntry.id) : undefined}
          />
          <KnowledgeCreateForm defaultCategory={filters.category === "全部" ? "政治理论" : filters.category} onAddEntry={onAddEntry} />
        </div>
      </div>
      <KnowledgeInternalizationPanel controller={internalization} entries={allKnowledgeEntries} mistakes={allMistakes} onOpenSettings={onOpenSettings} />

      <ObsidianKnowledgePanel controller={obsidian} />

      <details className="ui-board-panel">
        <summary className="cursor-pointer px-4 py-3 font-bold">分类模板与知识工具</summary>
        <div className="border-t border-line p-4">
        <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-1">
          {summaries.map((item) => (
            <article
              key={item.category}
              className="ui-card ui-card-muted grid gap-4 text-left transition hover:border-foreground/40 hover:bg-[var(--interactive-hover-bg)]"
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
        </div>
      </details>

      <KnowledgeStarterGuide summaries={summaries} onCreateStarterDrafts={onCreateStarterDrafts} />

      <ConfirmDialog
        confirmLabel="删除"
        description={`将删除 ${knowledgeList.bulkSelection.state.count} 条知识资料，并同步清理训练记录和错题关联。此操作不会删除错题、API 设置或导入任务。`}
        open={knowledgeList.bulkDeleteOpen}
        title="确认批量删除知识资料？"
        onCancel={() => knowledgeList.setBulkDeleteOpen(false)}
        onConfirm={knowledgeList.confirmBulkDelete}
      />
    </section>
  );
}

// 渲染训练队列筛选项，切换仅改变当前内存中的训练范围。
function QueueFilterTabs({ active, onChange }: { active: KnowledgeQueueFilter; onChange: (filter: KnowledgeQueueFilter) => void }) {
  const options: Array<[KnowledgeQueueFilter, string]> = [["due", "今日到期"], ["weak", "薄弱"], ["favorite", "收藏"], ["all", "全部"]];
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([value, label]) => (
        <Button key={value} type="button" size="sm" variant={active === value ? "soft" : "outline"} onClick={() => onChange(value)}>{label}</Button>
      ))}
    </div>
  );
}
