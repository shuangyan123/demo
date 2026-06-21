import type { ImportDraft, ImportDraftIssue, Mistake } from "../types/review";

// 归一化题干文本，用于在本地错题库和当前批次草稿中做轻量重复判断。
export function normalizeQuestionStem(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、“”‘’（）《》【】,.!?;:'"()[\]{}]/g, "")
    .toLowerCase()
    .slice(0, 240);
}

// 根据已有错题和当前草稿标记疑似重复；只加提示，不自动删除用户数据。
export function markDuplicateDrafts(drafts: ImportDraft[], mistakes: Mistake[], existingDrafts: Array<{ stem: string }> = []): ImportDraft[] {
  const existing = new Set(mistakes.map((mistake) => normalizeQuestionStem(mistake.stem)).filter(Boolean));
  for (const draft of existingDrafts) {
    const key = normalizeQuestionStem(draft.stem);
    if (key) existing.add(key);
  }
  const seenInBatch = new Set<string>();

  return drafts.map((draft) => {
    const key = normalizeQuestionStem(draft.stem);
    const duplicated = Boolean(key && (existing.has(key) || seenInBatch.has(key)));
    if (key) seenInBatch.add(key);
    const issues = new Set<ImportDraftIssue>(draft.issues ?? []);
    if (duplicated) issues.add("duplicate");
    return {
      ...draft,
      issues: Array.from(issues),
      needsReview: draft.needsReview || duplicated,
    };
  });
}
