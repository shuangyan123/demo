import { reviewDb } from "../db/review-db";
import type { KnowledgeEntry, KnowledgeInternalizationDraft, KnowledgeMistakeLink } from "../types/review";

// 合并标签并保持原顺序，避免重复标签持续膨胀。
function mergeTags(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().map((item) => item.trim()).filter(Boolean)));
}

export const knowledgeInternalizationRepository = {
  // 读取尚未确认的内化草稿，按最近更新时间排序。
  async listDrafts(): Promise<KnowledgeInternalizationDraft[]> {
    return reviewDb.knowledgeInternalizationDrafts.orderBy("updatedAt").reverse().toArray();
  },

  // 持久化 AI 或用户编辑后的草稿，刷新页面后仍可继续处理。
  async saveDraft(draft: KnowledgeInternalizationDraft): Promise<void> {
    await reviewDb.knowledgeInternalizationDrafts.put({ ...draft, updatedAt: new Date().toISOString() });
  },

  // 更新草稿局部字段，不触碰正式知识资料。
  async updateDraft(id: string, patch: Partial<KnowledgeInternalizationDraft>): Promise<void> {
    await reviewDb.knowledgeInternalizationDrafts.update(id, { ...patch, updatedAt: new Date().toISOString() });
  },

  // 忽略草稿时仅删除草稿本身。
  async removeDraft(id: string): Promise<void> {
    await reviewDb.knowledgeInternalizationDrafts.delete(id);
  },

  // 确认草稿时在一个事务内创建/合并知识资料、写入来源关联并删除草稿。
  async confirmDraft(id: string): Promise<KnowledgeEntry> {
    return reviewDb.transaction(
      "rw",
      [reviewDb.knowledgeInternalizationDrafts, reviewDb.knowledgeEntries, reviewDb.knowledgeMistakeLinks, reviewDb.mistakes],
      async () => {
        const draft = await reviewDb.knowledgeInternalizationDrafts.get(id);
        if (!draft) throw new Error("内化草稿不存在或已处理");
        const sourceMistakes = await reviewDb.mistakes.bulkGet(draft.sourceMistakeIds);
        if (!sourceMistakes.some(Boolean)) throw new Error("来源错题已不存在");
        const timestamp = new Date().toISOString();
        const existing = draft.mode === "merge" && draft.targetKnowledgeId
          ? await reviewDb.knowledgeEntries.get(draft.targetKnowledgeId)
          : undefined;
        const knowledgeId = existing?.id ?? crypto.randomUUID();
        const mergedContent = existing && !existing.content.includes(draft.content)
          ? `${existing.content.trim()}\n\n---\n\n${draft.content.trim()}`
          : draft.content;
        const entry: KnowledgeEntry = {
          id: knowledgeId,
          category: draft.category,
          title: draft.title,
          summary: draft.summary,
          content: mergedContent,
          tags: mergeTags(existing?.tags ?? [], draft.tags),
          source: existing?.source ? `${existing.source} / 错题内化` : "错题内化",
          favorite: existing?.favorite ?? false,
          mastery: existing?.mastery ?? 1,
          nextReviewAt: existing?.nextReviewAt ?? timestamp.slice(0, 10),
          lastReviewedAt: existing?.lastReviewedAt,
          reviewCount: existing?.reviewCount ?? 0,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        await reviewDb.knowledgeEntries.put(entry);

        for (const mistakeId of draft.sourceMistakeIds) {
          const oldLink = await reviewDb.knowledgeMistakeLinks.where("[mistakeId+knowledgeId]").equals([mistakeId, knowledgeId]).first();
          const link: KnowledgeMistakeLink = {
            id: oldLink?.id ?? crypto.randomUUID(),
            mistakeId,
            knowledgeId,
            kind: "internalized",
            reason: draft.reason,
            score: Math.round(draft.confidence * 100),
            evidence: [draft.principle, ...draft.pitfalls].filter(Boolean).slice(0, 3),
            createdAt: oldLink?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          await reviewDb.knowledgeMistakeLinks.put(link);
        }
        await reviewDb.knowledgeInternalizationDrafts.delete(id);
        return entry;
      },
    );
  },
};
