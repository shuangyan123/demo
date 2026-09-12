import type { Attempt, Mistake } from "../../types/domains/review.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import { LearningInsightView } from "./learning-insight-view";
import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";

/** 兼容历史 stats 入口，并复用“学习数据 → 薄弱分析”的同一证据视图。 */
export function StatsView({
  recommendations,
  attempts,
  knowledgeEntries,
  mistakes,
  onOpenKnowledgeTraining,
  onOpenReview,
  onRefresh,
}: {
  recommendations?: LearningActionRecommendation[];
  attempts: Attempt[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  onOpenKnowledgeTraining: (entryId?: string) => void;
  onOpenReview: (mistakeId?: string) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <LearningInsightView
      recommendations={recommendations}
      attempts={attempts}
      knowledgeEntries={knowledgeEntries}
      mistakes={mistakes}
      onOpenKnowledgeTraining={onOpenKnowledgeTraining}
      onOpenReview={onOpenReview}
      onRefresh={onRefresh}
    />
  );
}
