import type { Attempt, Mistake } from "../../types/domains/review.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { LearnerStateSnapshot } from "../../types/domains/learner-state.ts";
import type { LearningEvent } from "../../types/domains/learning-event.ts";
import { LearningInsightView } from "./learning-insight-view";
import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";

/** 兼容历史 stats 入口，并复用“学习数据 → 薄弱分析”的同一证据视图。 */
export function StatsView({
  recommendations,
  attempts,
  learningEvents,
  knowledgeAttempts,
  knowledgeEntries,
  learnerState,
  mistakes,
  onOpenKnowledgeTraining,
  onOpenReview,
  onRefresh,
}: {
  recommendations?: LearningActionRecommendation[];
  attempts: Attempt[];
  learningEvents: LearningEvent[];
  knowledgeAttempts: KnowledgeAttempt[];
  knowledgeEntries: KnowledgeEntry[];
  learnerState: LearnerStateSnapshot;
  mistakes: Mistake[];
  onOpenKnowledgeTraining: (entryId?: string) => void;
  onOpenReview: (mistakeId?: string) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <LearningInsightView
      recommendations={recommendations}
      attempts={attempts}
      learningEvents={learningEvents}
      knowledgeAttempts={knowledgeAttempts}
      knowledgeEntries={knowledgeEntries}
      learnerState={learnerState}
      mistakes={mistakes}
      onOpenKnowledgeTraining={onOpenKnowledgeTraining}
      onOpenReview={onOpenReview}
      onRefresh={onRefresh}
    />
  );
}
