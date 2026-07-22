"use client";

// 文件说明：提供知识库的紧凑筛选条与可批量操作列表。

import { Button, EmptyState, MasteryDots, SelectField, TextField } from "../shared/ui-primitives";
import { formatShortDate } from "../../lib/review-utils";
import type { KnowledgeCategorySummary, KnowledgeEntry, KnowledgeFilters } from "../../types/review";

/** 渲染知识库单行筛选工具条，保持分类、搜索、标签与收藏在同一作用域。 */
export function KnowledgeLibraryFilters({
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
    <div className="learning-toolbar">
      <SelectField
        label="分类"
        value={filters.category}
        options={[["全部", `全部资料（${total}）`], ...summaries.map((item) => [item.category, `${item.category}（${item.total}）`] as [string, string])]}
        onChange={(value) => onChangeFilters({ ...filters, category: value as KnowledgeFilters["category"] })}
      />
      <TextField label="搜索" value={filters.search} placeholder="标题、摘要、正文、来源" onChange={(value) => onChangeFilters({ ...filters, search: value })} />
      <SelectField label="标签" value={filters.tag} options={tagOptions} onChange={(value) => onChangeFilters({ ...filters, tag: value })} />
      <label className="inline-flex min-h-10 items-center gap-2 text-sm font-bold text-foreground">
        <input className="ui-checkbox" checked={filters.favoriteOnly} type="checkbox" onChange={(event) => onChangeFilters({ ...filters, favoriteOnly: event.target.checked })} />
        只看收藏
      </label>
    </div>
  );
}

/** 渲染渐进显示的知识条目列表，批量选择与详情选择互不干扰。 */
export function KnowledgeLibraryList({
  entries,
  hasMoreEntries,
  selectedEntry,
  selectedIds,
  totalCount,
  onLoadMore,
  onSelectEntry,
  onToggleSelected,
}: {
  entries: KnowledgeEntry[];
  hasMoreEntries: boolean;
  selectedEntry: KnowledgeEntry | null;
  selectedIds: Set<string>;
  totalCount: number;
  onLoadMore: () => void;
  onSelectEntry: (id: string) => void;
  onToggleSelected: (id: string, checked: boolean) => void;
}) {
  return (
    <>
      <div className="learning-list-head">
        <span>选择</span><span>知识条目</span><span>分类</span><span>下次训练</span><span>掌握</span>
      </div>
      {entries.length ? entries.map((entry) => (
        <article key={entry.id} className="learning-list-row" data-active={selectedEntry?.id === entry.id}>
          <input
            aria-label={`选择知识资料：${entry.title}`}
            checked={selectedIds.has(entry.id)}
            className="ui-checkbox"
            type="checkbox"
            onChange={(event) => onToggleSelected(entry.id, event.target.checked)}
          />
          <button type="button" onClick={() => onSelectEntry(entry.id)}>
            <strong className="block truncate">{entry.title}{entry.favorite ? <span className="ml-2 text-yellow">★</span> : null}</strong>
            <span className="mt-1 block truncate text-xs text-muted">{entry.summary || entry.content}</span>
          </button>
          <span>{entry.category}</span>
          <span>{formatShortDate(entry.nextReviewAt)}</span>
          <MasteryDots value={entry.mastery} />
        </article>
      )) : <div className="m-4"><EmptyState>暂无匹配资料</EmptyState></div>}
      {hasMoreEntries ? (
        <div className="border-t border-line p-4 text-center">
          <Button type="button" variant="soft" onClick={onLoadMore}>显示更多（{entries.length}/{totalCount}）</Button>
        </div>
      ) : null}
    </>
  );
}
