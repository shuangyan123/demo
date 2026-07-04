"use client";

import { useMemo, useState } from "react";
import { AssociationPanel } from "../shared/association-panel";
import { BulkToolbar, Button, Chip, ConfirmDialog, DetailBlock, DetailCard, EmptyState, MasteryDots, SelectField, SoftBlock } from "../shared/ui-primitives";
import { useBulkSelection } from "../shared/use-bulk-selection";
import { useVisibleLimit } from "../shared/use-visible-limit";
import type { BoardStat } from "../../lib/review-selectors";
import { formatShortDate, masteryLabel } from "../../lib/review-utils";
import type { KnowledgeMatch } from "../../services/association-matcher";
import type {
  AssociationSuggestion,
  Board,
  ExportFormat,
  ExportScope,
  Filters,
  KnowledgeEntry,
  KnowledgeMistakeLink,
  Mistake,
} from "../../types/review";

type LibraryViewProps = {
  aiAssociationBusy: boolean;
  apiReady: boolean;
  associationLinks: KnowledgeMistakeLink[];
  associationSuggestions: AssociationSuggestion[];
  boardStats: BoardStat[];
  filteredMistakes: Mistake[];
  filters: Filters;
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  relatedKnowledge: KnowledgeMatch[];
  reasonFilter: string;
  reasonOptions: string[];
  selectedBoard: Board | null;
  selectedId: string | null;
  selectedMistake: Mistake | null;
  setFilters: (updater: (current: Filters) => Filters) => void;
  setReasonFilter: (value: string) => void;
  setSelectedBoard: (value: Board | null) => void;
  setSelectedId: (value: string | null) => void;
  setTagFilter: (value: string) => void;
  tagFilter: string;
  tagOptions: string[];
  onAnalyzeMistakeAssociations: (mistake: Mistake) => void;
  onBulkDeleteMistakes: (ids: string[]) => void;
  onClearAssociationSuggestions: (targetId: string) => void;
  onConfirmAssociationSuggestions: () => void;
  onCreateKnowledgeDraft: (mistake: Mistake) => void;
  onDeleteAssociationSuggestion: (id: string) => void;
  onDeleteMistake: (mistake: Mistake) => void;
  onExportMistakes: (items: Mistake[], format: ExportFormat, scope: ExportScope) => void;
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onOpenSettings: () => void;
  onRemoveAssociationLink: (id: string) => void;
  onToggleAssociationSuggestion: (id: string, selected: boolean) => void;
};

const MISTAKE_VISIBLE_STEP = 80;

// 渲染错题库页的六大板块列表；只负责列表交互，数据刷新由主工作台统一编排。
export function LibraryView({
  aiAssociationBusy,
  apiReady,
  associationLinks,
  associationSuggestions,
  boardStats,
  filteredMistakes,
  filters,
  knowledgeEntries,
  mistakes,
  relatedKnowledge,
  reasonFilter,
  reasonOptions,
  selectedBoard,
  selectedId,
  selectedMistake,
  setFilters,
  setReasonFilter,
  setSelectedBoard,
  setSelectedId,
  setTagFilter,
  tagFilter,
  tagOptions,
  onAnalyzeMistakeAssociations,
  onBulkDeleteMistakes,
  onClearAssociationSuggestions,
  onConfirmAssociationSuggestions,
  onCreateKnowledgeDraft,
  onDeleteAssociationSuggestion,
  onDeleteMistake,
  onExportMistakes,
  onOpenKnowledgeEntry,
  onOpenSettings,
  onRemoveAssociationLink,
  onToggleAssociationSuggestion,
}: LibraryViewProps) {
  const visibleResetKey = `${selectedBoard ?? "all"}|${filters.board}|${filters.mastery}|${filters.search}|${reasonFilter}|${tagFilter}`;
  const { loadMore: loadMoreMistakes, visibleLimit } = useVisibleLimit(visibleResetKey, MISTAKE_VISIBLE_STEP);
  const visibleMistakes = useMemo(() => filteredMistakes.slice(0, visibleLimit), [filteredMistakes, visibleLimit]);
  const visibleMistakeIds = useMemo(() => visibleMistakes.map((item) => item.id), [visibleMistakes]);
  const bulkSelection = useBulkSelection(visibleMistakeIds);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const selectedMistakes = useMemo(
    () => filteredMistakes.filter((item) => bulkSelection.state.ids.has(item.id)),
    [bulkSelection.state.ids, filteredMistakes],
  );
  const hasMoreMistakes = visibleMistakes.length < filteredMistakes.length;

  // 根据用户选择的范围导出错题，导出文件生成交给父级统一处理通知。
  function exportMistakeScope(scope: ExportScope, format: ExportFormat) {
    onExportMistakes(scope === "selected" ? selectedMistakes : filteredMistakes, format, scope);
  }

  // 确认批量删除后清空选择状态，防止刷新后旧选区继续影响后续操作。
  function confirmBulkDelete() {
    onBulkDeleteMistakes(Array.from(bulkSelection.state.ids));
    bulkSelection.clear();
    setBulkDeleteOpen(false);
  }

  return (
    <section className="space-y-4">
      <section className="ui-board-panel">
        <div className="ui-board-header">
          <strong className="text-2xl">专项练习</strong>
          <span className="ui-board-header-badge">六大固定板块</span>
        </div>
        <div className="px-7 py-4 max-sm:px-4">
          {boardStats.map((item) => {
            const expanded = selectedBoard === item.board;
            return (
              <div key={item.board} className="ui-board-row">
                <button
                  className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-5 py-5 text-left"
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    setSelectedBoard(expanded ? null : item.board);
                    setFilters((current) => ({ ...current, board: item.board }));
                  }}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-blue/10 text-blue">{expanded ? "v" : ">"}</span>
                  <strong className="ui-board-title max-sm:text-xl">{item.board}</strong>
                  <span className="text-sm text-muted">
                    {item.total} 题 · {item.due} 待复盘 · {item.weak} 薄弱
                  </span>
                </button>
                {expanded && (
                  <div className="pb-5">
                    <LibraryBoardList
                      aiAssociationBusy={aiAssociationBusy}
                      apiReady={apiReady}
                      associationLinks={associationLinks}
                      associationSuggestions={associationSuggestions}
                      filteredMistakes={filteredMistakes}
                      filters={filters}
                      knowledgeEntries={knowledgeEntries}
                      mistakes={mistakes}
                      relatedKnowledge={relatedKnowledge}
                      reasonFilter={reasonFilter}
                      reasonOptions={reasonOptions}
                      selectedId={selectedId}
                      selectedMistake={selectedMistake}
                      visibleMistakes={visibleMistakes}
                      setFilters={setFilters}
                      setReasonFilter={setReasonFilter}
                      setSelectedId={setSelectedId}
                      setTagFilter={setTagFilter}
                      tagFilter={tagFilter}
                      tagOptions={tagOptions}
                      bulkSelectedIds={bulkSelection.state.ids}
                      bulkSelectedCount={bulkSelection.state.count}
                      bulkAllVisibleSelected={bulkSelection.state.allVisibleSelected}
                      onBulkClearSelection={bulkSelection.clear}
                      onBulkDelete={() => setBulkDeleteOpen(true)}
                      onBulkSelectAll={bulkSelection.selectAllVisible}
                      onBulkToggleMistake={bulkSelection.toggle}
                      onLoadMoreMistakes={loadMoreMistakes}
                      onAnalyzeMistakeAssociations={onAnalyzeMistakeAssociations}
                      onClearAssociationSuggestions={onClearAssociationSuggestions}
                      onConfirmAssociationSuggestions={onConfirmAssociationSuggestions}
                      onCreateKnowledgeDraft={onCreateKnowledgeDraft}
                      onDeleteAssociationSuggestion={onDeleteAssociationSuggestion}
                      onDeleteMistake={onDeleteMistake}
                      onExportFiltered={(format) => exportMistakeScope("filtered", format)}
                      onExportSelected={(format) => exportMistakeScope("selected", format)}
                      onOpenKnowledgeEntry={onOpenKnowledgeEntry}
                      onOpenSettings={onOpenSettings}
                      onRemoveAssociationLink={onRemoveAssociationLink}
                      onToggleAssociationSuggestion={onToggleAssociationSuggestion}
                      hasMoreMistakes={hasMoreMistakes}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <ConfirmDialog
        confirmLabel="删除"
        description={`将删除 ${bulkSelection.state.count} 道错题，并同步清理对应复盘记录和知识关联。此操作不会影响知识库资料、API 设置或导入任务。`}
        open={bulkDeleteOpen}
        title="确认批量删除错题？"
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
      />
    </section>
  );
}

// 渲染单个板块展开后的筛选区、错题列表和详情栏。
function LibraryBoardList({
  aiAssociationBusy,
  apiReady,
  associationLinks,
  associationSuggestions,
  filteredMistakes,
  filters,
  knowledgeEntries,
  mistakes,
  relatedKnowledge,
  reasonFilter,
  reasonOptions,
  selectedId,
  selectedMistake,
  visibleMistakes,
  setFilters,
  setReasonFilter,
  setSelectedId,
  setTagFilter,
  tagFilter,
  tagOptions,
  bulkSelectedIds,
  bulkSelectedCount,
  bulkAllVisibleSelected,
  onBulkClearSelection,
  onBulkDelete,
  onBulkSelectAll,
  onBulkToggleMistake,
  onLoadMoreMistakes,
  onAnalyzeMistakeAssociations,
  onClearAssociationSuggestions,
  onConfirmAssociationSuggestions,
  onCreateKnowledgeDraft,
  onDeleteAssociationSuggestion,
  onDeleteMistake,
  onExportFiltered,
  onExportSelected,
  onOpenKnowledgeEntry,
  onOpenSettings,
  onRemoveAssociationLink,
  onToggleAssociationSuggestion,
  hasMoreMistakes,
}: Omit<LibraryViewProps, "boardStats" | "selectedBoard" | "setSelectedBoard" | "onBulkDeleteMistakes" | "onExportMistakes"> & {
  bulkAllVisibleSelected: boolean;
  bulkSelectedCount: number;
  bulkSelectedIds: Set<string>;
  hasMoreMistakes: boolean;
  visibleMistakes: Mistake[];
  onBulkClearSelection: () => void;
  onBulkDelete: () => void;
  onBulkSelectAll: () => void;
  onBulkToggleMistake: (id: string, checked: boolean) => void;
  onExportFiltered: (format: ExportFormat) => void;
  onExportSelected: (format: ExportFormat) => void;
  onLoadMoreMistakes: () => void;
}) {
  return (
    <SoftBlock className="space-y-4">
      <div className="grid grid-cols-[150px_150px_150px_minmax(220px,1fr)] gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <SelectField
          label="掌握度"
          value={filters.mastery}
          onChange={(value) => setFilters((prev) => ({ ...prev, mastery: value as Filters["mastery"] }))}
          options={[
            ["all", "全部"],
            ["low", "薄弱"],
            ["mid", "巩固中"],
            ["high", "较稳"],
          ]}
        />
        <SelectField label="错因" value={reasonFilter} onChange={setReasonFilter} options={reasonOptions} />
        <SelectField label="标签" value={tagFilter} onChange={setTagFilter} options={tagOptions} />
        <label className="ui-field">
          搜索
          <input
            className="ui-input"
            placeholder="题干、答案、解析、来源"
            type="search"
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          />
        </label>
      </div>
      <BulkToolbar
        allVisibleSelected={bulkAllVisibleSelected}
        selectedCount={bulkSelectedCount}
        totalCount={visibleMistakes.length}
        onClearSelection={onBulkClearSelection}
        onDeleteSelected={onBulkDelete}
        onExportFiltered={onExportFiltered}
        onExportSelected={onExportSelected}
        onSelectAllVisible={onBulkSelectAll}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 max-xl:grid-cols-1">
        <section className="ui-board-panel">
          <div className="grid min-h-12 grid-cols-[36px_minmax(260px,1fr)_150px_120px_96px] items-center gap-3 bg-surface-muted px-4 text-xs font-extrabold text-muted max-lg:hidden">
            <span>选择</span>
            <span>题目</span>
            <span>错因</span>
            <span>下次复盘</span>
            <span>掌握</span>
          </div>
          {filteredMistakes.length ? (
            visibleMistakes.map((item) => (
              <article
                key={item.id}
                className={`grid w-full grid-cols-[36px_minmax(260px,1fr)_150px_120px_96px] items-center gap-3 border-t border-line px-4 py-3 text-left hover:bg-blue/5 max-lg:grid-cols-[36px_minmax(0,1fr)] ${
                  item.id === selectedId ? "bg-blue/5" : "bg-surface"
                }`}
              >
                <input
                  aria-label={`选择错题：${item.stem.slice(0, 24)}`}
                  checked={bulkSelectedIds.has(item.id)}
                  className="ui-checkbox"
                  type="checkbox"
                  onChange={(event) => onBulkToggleMistake(item.id, event.target.checked)}
                />
                <button className="contents text-left" type="button" onClick={() => setSelectedId(item.id)}>
                  <span className="min-w-0">
                    <strong className="block truncate">{item.stem}</strong>
                    <span className="mt-1 block text-xs text-muted">{item.source}</span>
                  </span>
                  <span className="max-lg:hidden">{item.reasons.slice(0, 2).join(" / ")}</span>
                  <span className="max-lg:hidden">{formatShortDate(item.nextReviewAt)}</span>
                  <span className="max-lg:hidden">
                    <MasteryDots value={item.mastery} />
                  </span>
                </button>
              </article>
            ))
          ) : (
            <div className="m-4">
              <EmptyState>没有匹配的错题</EmptyState>
            </div>
          )}
          {hasMoreMistakes && (
            <div className="border-t border-line p-4 text-center">
              <Button type="button" variant="soft" onClick={onLoadMoreMistakes}>
                显示更多（{visibleMistakes.length}/{filteredMistakes.length}）
              </Button>
            </div>
          )}
        </section>

        <MistakeDetail
          aiAssociationBusy={aiAssociationBusy}
          apiReady={apiReady}
          associationLinks={associationLinks}
          associationSuggestions={associationSuggestions}
          knowledgeEntries={knowledgeEntries}
          mistakes={mistakes}
          relatedKnowledge={relatedKnowledge}
          selectedMistake={selectedMistake}
          onAnalyzeMistakeAssociations={onAnalyzeMistakeAssociations}
          onClearAssociationSuggestions={onClearAssociationSuggestions}
          onConfirmAssociationSuggestions={onConfirmAssociationSuggestions}
          onCreateKnowledgeDraft={onCreateKnowledgeDraft}
          onDeleteAssociationSuggestion={onDeleteAssociationSuggestion}
          onDeleteMistake={onDeleteMistake}
          onOpenKnowledgeEntry={onOpenKnowledgeEntry}
          onOpenSettings={onOpenSettings}
          onRemoveAssociationLink={onRemoveAssociationLink}
          onToggleAssociationSuggestion={onToggleAssociationSuggestion}
        />
      </div>
    </SoftBlock>
  );
}

// 渲染右侧错题详情，集中展示答案、解析、错因、复盘计划和确认式关联区。
function MistakeDetail({
  aiAssociationBusy,
  apiReady,
  associationLinks,
  associationSuggestions,
  knowledgeEntries,
  mistakes,
  relatedKnowledge,
  selectedMistake,
  onAnalyzeMistakeAssociations,
  onClearAssociationSuggestions,
  onConfirmAssociationSuggestions,
  onCreateKnowledgeDraft,
  onDeleteAssociationSuggestion,
  onDeleteMistake,
  onOpenKnowledgeEntry,
  onOpenSettings,
  onRemoveAssociationLink,
  onToggleAssociationSuggestion,
}: Omit<LibraryViewProps, "boardStats" | "filteredMistakes" | "filters" | "reasonFilter" | "reasonOptions" | "selectedBoard" | "selectedId" | "setFilters" | "setReasonFilter" | "setSelectedBoard" | "setSelectedId" | "setTagFilter" | "tagFilter" | "tagOptions" | "onBulkDeleteMistakes" | "onExportMistakes">) {
  return (
    <DetailCard className="min-h-[460px] max-xl:min-h-0">
      {selectedMistake ? (
        <>
          <p className="text-xs font-extrabold uppercase text-muted">
            {selectedMistake.board} · {selectedMistake.source}
          </p>
          <h3 className="mt-2 text-lg font-extrabold leading-relaxed">{selectedMistake.stem}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedMistake.tags.map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </div>
          <DetailBlock title="答案">{selectedMistake.answer}</DetailBlock>
          <DetailBlock title="解析">{selectedMistake.explanation}</DetailBlock>
          <DetailBlock title="错因">
            <div className="flex flex-wrap gap-2">
              {selectedMistake.reasons.map((reason) => (
                <Chip key={reason} tone="yellow">
                  {reason}
                </Chip>
              ))}
            </div>
          </DetailBlock>
          <DetailBlock title="计划">
            下次复盘 {selectedMistake.nextReviewAt} · {masteryLabel(selectedMistake.mastery)}
          </DetailBlock>
          <Button className="mt-4 w-full" variant="soft" onClick={() => onCreateKnowledgeDraft(selectedMistake)}>
            沉淀为知识草稿
          </Button>
          <Button className="mt-2 w-full" variant="danger" onClick={() => onDeleteMistake(selectedMistake)}>
            删除错题
          </Button>
          <div className="mt-4">
            <AssociationPanel
              aiBusy={aiAssociationBusy}
              apiReady={apiReady}
              knowledgeEntries={knowledgeEntries}
              links={associationLinks}
              localKnowledgeMatches={relatedKnowledge}
              mistakes={mistakes}
              mode="mistake"
              suggestions={associationSuggestions}
              onAnalyze={() => onAnalyzeMistakeAssociations(selectedMistake)}
              onClearSuggestions={() => onClearAssociationSuggestions(selectedMistake.id)}
              onConfirmSuggestions={onConfirmAssociationSuggestions}
              onDeleteSuggestion={onDeleteAssociationSuggestion}
              onOpenKnowledgeEntry={onOpenKnowledgeEntry}
              onOpenMistake={() => undefined}
              onOpenSettings={onOpenSettings}
              onRemoveLink={onRemoveAssociationLink}
              onToggleSuggestion={onToggleAssociationSuggestion}
            />
          </div>
        </>
      ) : (
        <EmptyState>选择一道错题查看详情</EmptyState>
      )}
    </DetailCard>
  );
}
