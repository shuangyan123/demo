"use client";

import { useMemo, useState } from "react";
import { AssociationPanel } from "../shared/association-panel";
import { BulkToolbar, Button, Chip, ConfirmDialog, DetailBlock, DetailCard, EmptyState, MasteryDots, SelectField } from "../shared/ui-primitives";
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
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
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

  const dueCount = boardStats.reduce((sum, item) => sum + item.due, 0);
  const weakCount = boardStats.reduce((sum, item) => sum + item.weak, 0);

  return (
    <section className="learning-page">
      <header className="learning-page-header">
        <p className="text-sm text-muted">集中筛选、复盘并沉淀高价值错题。</p>
        <div className="learning-metrics" aria-label="错题库概览">
          <span><strong>{mistakes.length}</strong>全部错题</span>
          <span><strong>{dueCount}</strong>今日待复盘</span>
          <span><strong>{weakCount}</strong>薄弱项</span>
          <span><strong>{filteredMistakes.length}</strong>当前结果</span>
        </div>
      </header>
      <LibraryBoardList
                      aiAssociationBusy={aiAssociationBusy}
                      apiReady={apiReady}
                      associationLinks={associationLinks}
                      associationSuggestions={associationSuggestions}
                      boardStats={boardStats}
                      filteredMistakes={filteredMistakes}
                      filters={filters}
                      knowledgeEntries={knowledgeEntries}
                      mistakes={mistakes}
                      relatedKnowledge={relatedKnowledge}
                      reasonFilter={reasonFilter}
                      reasonOptions={reasonOptions}
                      selectedId={selectedId}
                      selectedMistake={selectedMistake}
                      selectedBoard={selectedBoard}
                      visibleMistakes={visibleMistakes}
                      setFilters={setFilters}
                      setReasonFilter={setReasonFilter}
                      setSelectedId={setSelectedId}
                      setSelectedBoard={setSelectedBoard}
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
                      mobileDetailOpen={mobileDetailOpen}
                      onCloseMobileDetail={() => setMobileDetailOpen(false)}
                      onOpenMistake={(id) => {
                        setSelectedId(id);
                        setMobileDetailOpen(true);
                      }}
                    />
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

// 渲染统一筛选区、紧凑错题列表和详情栏。
function LibraryBoardList({
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
  selectedId,
  selectedBoard,
  selectedMistake,
  visibleMistakes,
  setFilters,
  setReasonFilter,
  setSelectedBoard,
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
  mobileDetailOpen,
  onCloseMobileDetail,
  onOpenMistake,
}: Omit<LibraryViewProps, "onBulkDeleteMistakes" | "onExportMistakes"> & {
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
  mobileDetailOpen: boolean;
  onCloseMobileDetail: () => void;
  onOpenMistake: (id: string) => void;
}) {
  return (
    <>
      <div className="learning-toolbar">
        <SelectField
          label="板块"
          value={selectedBoard ?? "全部"}
          onChange={(value) => {
            const board = value === "全部" ? null : value as Board;
            setSelectedBoard(board);
            setFilters((current) => ({ ...current, board: board ?? "全部" }));
          }}
          options={[["全部", "全部板块"], ...boardStats.map((item) => [item.board, item.board] as [string, string])]}
        />
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

      <div className="learning-master-detail">
        <section className="learning-list" aria-label="错题列表">
          <div className="learning-list-head">
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
                className="learning-list-row"
                data-active={item.id === selectedId}
              >
                <input
                  aria-label={`选择错题：${item.stem.slice(0, 24)}`}
                  checked={bulkSelectedIds.has(item.id)}
                  className="ui-checkbox"
                  type="checkbox"
                  onChange={(event) => onBulkToggleMistake(item.id, event.target.checked)}
                />
                <button className="contents text-left" type="button" onClick={() => onOpenMistake(item.id)}>
                  <span className="min-w-0">
                    <strong className="block truncate">{item.stem}</strong>
                    <span className="mt-1 block text-xs text-muted">{item.source}</span>
                  </span>
                  <span>{item.reasons.slice(0, 2).join(" / ")}</span>
                  <span>{formatShortDate(item.nextReviewAt)}</span>
                  <span>
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

        <div className="learning-detail" data-mobile-open={mobileDetailOpen}>
          <Button className="learning-mobile-detail-close" size="sm" variant="ghost" onClick={onCloseMobileDetail}>返回错题列表</Button>
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
      </div>
    </>
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
