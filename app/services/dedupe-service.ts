import type { ImportDraft, ImportDraftIssue } from "../types/domains/import.ts";
import type { Mistake } from "../types/domains/review.ts";

// 归一化题干文本，用于在本地错题库和当前批次草稿中做轻量重复判断。
export function normalizeQuestionStem(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、“”‘’（）《》【】,.!?;:'"()[\]{}]/g, "")
    .toLowerCase()
    .slice(0, 240);
}

// 根据已有错题和当前草稿标记疑似重复；只加提示，不自动删除用户数据。
export function markDuplicateDrafts(drafts: ImportDraft[], mistakes: Mistake[], existingDrafts: Array<{ stem: string; sourceId?: string }> = []): ImportDraft[] {
  const existing = new Set(mistakes.map((mistake) => normalizeQuestionStem(mistake.stem)).filter(Boolean));
  const existingSourceIds = new Set(mistakes.map((mistake) => mistake.sourceId).filter((id): id is string => Boolean(id)));
  for (const draft of existingDrafts) {
    const key = normalizeQuestionStem(draft.stem);
    if (key) existing.add(key);
    if (draft.sourceId) existingSourceIds.add(draft.sourceId);
  }
  const seenInBatch = new Set<string>();
  const seenSourceIds = new Set<string>();

  return drafts.map((draft) => {
    const key = normalizeQuestionStem(draft.stem);
    const duplicatedBySource = Boolean(draft.sourceId && (existingSourceIds.has(draft.sourceId) || seenSourceIds.has(draft.sourceId)));
    const duplicated = duplicatedBySource || Boolean(key && (existing.has(key) || seenInBatch.has(key)));
    if (key) seenInBatch.add(key);
    if (draft.sourceId) seenSourceIds.add(draft.sourceId);
    const issues = new Set<ImportDraftIssue>(draft.issues ?? []);
    if (duplicated) issues.add("duplicate");
    return {
      ...draft,
      issues: Array.from(issues),
      needsReview: draft.needsReview || duplicated,
    };
  });
}
