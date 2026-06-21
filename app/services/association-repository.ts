import { reviewDb } from "../db/review-db";
import { toISODate } from "../lib/review-utils";
import type { AssociationSuggestion, KnowledgeMistakeLink } from "../types/review";

type LinkInput = Omit<KnowledgeMistakeLink, "id" | "createdAt" | "updatedAt">;

// 把 AI 或本地推荐转换成可落库的关联输入，调用方负责保证 ID 来自当前本地候选。
export function suggestionToLinkInput(suggestion: AssociationSuggestion): LinkInput {
  return {
    mistakeId: suggestion.mistakeId,
    knowledgeId: suggestion.knowledgeId,
    kind: "related",
    reason: suggestion.reason,
    score: suggestion.score,
    evidence: suggestion.evidence,
  };
}

// 管理错题和知识资料之间的确认式关联；所有写入都只发生在用户确认之后。
export const associationRepository = {
  // 读取全部确认关联，页面侧用它和当前错题/资料列表做内存映射。
  async listAll(): Promise<KnowledgeMistakeLink[]> {
    return reviewDb.knowledgeMistakeLinks.orderBy("updatedAt").reverse().toArray();
  },

  // 读取单道错题已经确认的知识资料关联。
  async listForMistake(mistakeId: string): Promise<KnowledgeMistakeLink[]> {
    return reviewDb.knowledgeMistakeLinks.where("mistakeId").equals(mistakeId).reverse().sortBy("updatedAt");
  },

  // 读取单条知识资料已经确认的错题关联。
  async listForKnowledge(knowledgeId: string): Promise<KnowledgeMistakeLink[]> {
    return reviewDb.knowledgeMistakeLinks.where("knowledgeId").equals(knowledgeId).reverse().sortBy("updatedAt");
  },

  // 批量保存用户确认的关联；相同错题和资料组合会更新说明与分数，不重复插入。
  async saveLinks(inputs: LinkInput[], today: Date): Promise<KnowledgeMistakeLink[]> {
    const now = toISODate(today);
    const saved: KnowledgeMistakeLink[] = [];

    await reviewDb.transaction("rw", reviewDb.knowledgeMistakeLinks, async () => {
      for (const input of inputs) {
        const existing = await reviewDb.knowledgeMistakeLinks
          .where("[mistakeId+knowledgeId]")
          .equals([input.mistakeId, input.knowledgeId])
          .first();

        if (existing) {
          const nextLink: KnowledgeMistakeLink = {
            ...existing,
            kind: existing.kind ?? input.kind,
            reason: input.reason,
            score: input.score,
            evidence: input.evidence,
            updatedAt: now,
          };
          await reviewDb.knowledgeMistakeLinks.put(nextLink);
          saved.push(nextLink);
        } else {
          const link: KnowledgeMistakeLink = {
            ...input,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          };
          await reviewDb.knowledgeMistakeLinks.add(link);
          saved.push(link);
        }
      }
    });

    return saved;
  },

  // 删除单条确认关联，不影响错题或知识资料本身。
  async removeLink(id: string): Promise<void> {
    await reviewDb.knowledgeMistakeLinks.delete(id);
  },

  // 删除错题时清理所有关联，避免知识资料详情里出现已经不存在的错题。
  async removeLinksForMistake(mistakeId: string): Promise<void> {
    await reviewDb.knowledgeMistakeLinks.where("mistakeId").equals(mistakeId).delete();
  },

  // 删除知识资料时清理所有关联，避免错题详情里出现已经不存在的资料。
  async removeLinksForKnowledge(knowledgeId: string): Promise<void> {
    await reviewDb.knowledgeMistakeLinks.where("knowledgeId").equals(knowledgeId).delete();
  },
};
