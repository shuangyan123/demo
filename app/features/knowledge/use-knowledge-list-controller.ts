"use client";

import { useMemo, useState } from "react";
import { useBulkSelection } from "../shared/use-bulk-selection";
import { useVisibleLimit } from "../shared/use-visible-limit";
import type { ExportFormat, ExportScope } from "../../types/domains/review.ts";
import type { KnowledgeEntry, KnowledgeFilters } from "../../types/domains/knowledge.ts";

const KNOWLEDGE_VISIBLE_STEP = 80;

/** 知识库列表控制器：集中渐进渲染、批量选择、批量删除和导出范围计算。 */
export function useKnowledgeListController({
  entries,
  filters,
  onBulkDeleteEntries,
  onExportKnowledgeEntries,
}: {
  entries: KnowledgeEntry[];
  filters: KnowledgeFilters;
  onBulkDeleteEntries: (ids: string[]) => void;
  onExportKnowledgeEntries: (items: KnowledgeEntry[], format: ExportFormat, scope: ExportScope) => void;
}) {
  const visibleResetKey = `${filters.category}|${filters.favoriteOnly}|${filters.search}|${filters.tag}`;
  const { loadMore: loadMoreEntries, visibleLimit } = useVisibleLimit(visibleResetKey, KNOWLEDGE_VISIBLE_STEP);
  const visibleEntries = useMemo(() => entries.slice(0, visibleLimit), [entries, visibleLimit]);
  const visibleEntryIds = useMemo(() => visibleEntries.map((entry) => entry.id), [visibleEntries]);
  const bulkSelection = useBulkSelection(visibleEntryIds);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => bulkSelection.state.ids.has(entry.id)),
    [bulkSelection.state.ids, entries],
  );

  function exportKnowledgeScope(scope: ExportScope, format: ExportFormat) {
    onExportKnowledgeEntries(scope === "selected" ? selectedEntries : entries, format, scope);
  }

  function confirmBulkDelete() {
    onBulkDeleteEntries(Array.from(bulkSelection.state.ids));
    bulkSelection.clear();
    setBulkDeleteOpen(false);
  }

  return {
    bulkDeleteOpen,
    bulkSelection,
    confirmBulkDelete,
    exportKnowledgeScope,
    hasMoreEntries: visibleEntries.length < entries.length,
    loadMoreEntries,
    setBulkDeleteOpen,
    visibleEntries,
  };
}
