import { findRelatedKnowledgeEntries, findRelatedMistakesForKnowledge } from "../services/association-matcher";
import { BOARD_OPTIONS, type Board, type Filters, type Mistake } from "../types/domains/review.ts";
import type { AssociationSuggestion, KnowledgeMistakeLink } from "../types/domains/association.ts";
import type { KnowledgeEntry, KnowledgeFilters } from "../types/domains/knowledge.ts";
import { countBy, isDue, toISODate } from "./review-utils.ts";

export type BoardStat = {
  board: Board;
  total: number;
  due: number;
  weak: number;
};

export type KnowledgeAssociationSummary = {
  links: KnowledgeMistakeLink[];
  suggestions: AssociationSuggestion[];
  selectedSuggestionCount: number;
};

// 构建错题复盘队列，统一按照薄弱程度和下次复盘时间排序，避免多个视图排序规则分叉。
export function buildReviewQueue(mistakes: Mistake[], today: Date): Mistake[] {
  return mistakes
    .filter((item) => isDue(item, today))
    .sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt));
}

// 找出掌握度较低的错题，供总览、分析和板块统计共用。
export function buildLowMistakes(mistakes: Mistake[]): Mistake[] {
  return mistakes.filter((item) => item.mastery <= 2);
}

// 生成六大板块统计，所有看板和板块入口都复用这份聚合结果。
export function buildBoardStats(mistakes: Mistake[], today: Date): BoardStat[] {
  return BOARD_OPTIONS.map((board) => {
    const boardMistakes = mistakes.filter((item) => item.board === board);
    return {
      board,
      total: boardMistakes.length,
      due: boardMistakes.filter((item) => isDue(item, today)).length,
      weak: boardMistakes.filter((item) => item.mastery <= 2).length,
    };
  });
}

// 从错题集合中提取筛选项，保持错因和标签解析规则一致。
export function buildMistakeFilterOptions(mistakes: Mistake[]): { reasonOptions: string[]; tagOptions: string[] } {
  return {
    reasonOptions: ["全部", ...countBy(mistakes.flatMap((item) => item.reasons), (reason) => reason).map(([reason]) => reason)],
    tagOptions: ["全部", ...countBy(mistakes.flatMap((item) => item.tags), (tag) => tag).map(([tag]) => tag)],
  };
}

// 从知识资料集合中提取标签筛选项，和错题筛选保持同一套计数逻辑。
export function buildKnowledgeTagOptions(entries: KnowledgeEntry[]): string[] {
  return ["全部", ...countBy(entries.flatMap((item) => item.tags), (tag) => tag).map(([tag]) => tag)];
}

// 计算平均掌握度，返回已格式化字符串，避免展示层重复处理空数据。
export function calculateAverageMastery(mistakes: Mistake[]): string {
  return mistakes.length ? (mistakes.reduce((sum, item) => sum + item.mastery, 0) / mistakes.length).toFixed(1) : "0.0";
}

// 计算复盘正确率，空记录时返回 0，避免页面侧额外判空。
export function calculateCorrectRate(total: number, correct: number): number {
  return total ? Math.round((correct / total) * 100) : 0;
}

// 根据板块、掌握度、错因、标签和关键词筛选错题库列表。
export function filterMistakes(mistakes: Mistake[], filters: Filters, selectedBoard: Board | null, reasonFilter: string, tagFilter: string): Mistake[] {
  const term = filters.search.trim().toLowerCase();
  const activeBoard = selectedBoard ?? (filters.board === "全部" ? null : filters.board);

  return mistakes.filter((item) => {
    const matchesBoard = !activeBoard || item.board === activeBoard;
    const matchesMastery =
      filters.mastery === "all" ||
      (filters.mastery === "low" && item.mastery <= 2) ||
      (filters.mastery === "mid" && item.mastery === 3) ||
      (filters.mastery === "high" && item.mastery >= 4);
    const matchesReason = reasonFilter === "全部" || item.reasons.includes(reasonFilter);
    const matchesTag = tagFilter === "全部" || item.tags.includes(tagFilter);
    const haystack = [item.stem, item.answer, item.explanation, item.source, item.board, ...item.tags, ...item.reasons].join(" ").toLowerCase();
    return matchesBoard && matchesMastery && matchesReason && matchesTag && (!term || haystack.includes(term));
  });
}

// 当前选中错题失效时回退到筛选结果第一项，防止详情栏出现悬空 ID。
export function resolveActiveMistakeId(selectedId: string | null, filteredMistakes: Mistake[]): string | null {
  return selectedId && filteredMistakes.some((item) => item.id === selectedId) ? selectedId : filteredMistakes[0]?.id ?? null;
}

// 根据分类、标签、收藏和关键词筛选知识库资料列表。
export function filterKnowledgeEntries(entries: KnowledgeEntry[], filters: KnowledgeFilters): KnowledgeEntry[] {
  const term = filters.search.trim().toLowerCase();
  return entries.filter((item) => {
    const matchesCategory = filters.category === "全部" || item.category === filters.category;
    const matchesTag = filters.tag === "全部" || item.tags.includes(filters.tag);
    const matchesFavorite = !filters.favoriteOnly || item.favorite;
    const haystack = [item.category, item.title, item.summary, item.content, item.source, ...item.tags].join(" ").toLowerCase();
    return matchesCategory && matchesTag && matchesFavorite && (!term || haystack.includes(term));
  });
}

// 当前选中知识资料失效时回退到筛选结果第一项，保持编辑区和列表同步。
export function resolveActiveKnowledgeId(selectedKnowledgeId: string | null, filteredEntries: KnowledgeEntry[]): string | null {
  return selectedKnowledgeId && filteredEntries.some((item) => item.id === selectedKnowledgeId)
    ? selectedKnowledgeId
    : filteredEntries[0]?.id ?? null;
}

// 构建知识资料训练队列的基础集合，供训练页、总览和统计页共用。
export function buildKnowledgeDueEntries(entries: KnowledgeEntry[], today: Date): KnowledgeEntry[] {
  const todayText = toISODate(today);
  return entries
    .filter((entry) => entry.nextReviewAt <= todayText)
    .sort((a, b) => a.mastery - b.mastery || a.nextReviewAt.localeCompare(b.nextReviewAt));
}

// 找出低掌握度知识资料，和错题薄弱定义保持一致。
export function buildLowKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return entries.filter((entry) => entry.mastery <= 2);
}

// 为错题或知识详情整理已确认关联和 AI 预览建议，减少两个详情页重复筛选。
export function buildKnowledgeAssociationSummary(
  links: KnowledgeMistakeLink[],
  suggestions: AssociationSuggestion[],
  targetId: string | null,
  mode: "mistake" | "knowledge",
): KnowledgeAssociationSummary {
  if (!targetId) {
    return { links: [], suggestions: [], selectedSuggestionCount: 0 };
  }

  const scopedLinks = links.filter((link) => (mode === "mistake" ? link.mistakeId === targetId : link.knowledgeId === targetId));
  const scopedSuggestions = suggestions.filter((suggestion) => (mode === "mistake" ? suggestion.mistakeId === targetId : suggestion.knowledgeId === targetId));
  return {
    links: scopedLinks,
    suggestions: scopedSuggestions,
    selectedSuggestionCount: scopedSuggestions.filter((suggestion) => suggestion.selected).length,
  };
}

// 统一生成详情页本地关联候选，AI 分析前也复用这套候选预筛规则。
export function buildLocalAssociationMatches(mistake: Mistake | null, entry: KnowledgeEntry | null, knowledgeEntries: KnowledgeEntry[], mistakes: Mistake[]) {
  return {
    relatedKnowledge: findRelatedKnowledgeEntries(mistake, knowledgeEntries, 4),
    relatedMistakes: findRelatedMistakesForKnowledge(entry, mistakes, 6),
  };
}
