import { reviewDb } from "../db/review-db.ts";
import type { LearningEvent, LearningEventSourceType, LearningEventSubjectType } from "../types/domains/learning-event.ts";
import { learningEventId } from "../types/domains/learning-event.ts";

const DEFAULT_RECENT_LIMIT = 50;

function compareNewest(left: LearningEvent, right: LearningEvent): number {
  return right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id);
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RECENT_LIMIT;
  return Math.max(0, Math.floor(limit));
}

/** 学习事件只提供稳定的历史读取；learner-state 在读取边界按已过滤 subject 使用它们派生信号。 */
export const learningEventRepository = {
  async listForSubject(subjectType: LearningEventSubjectType, subjectId: string): Promise<LearningEvent[]> {
    const events = await reviewDb.learningEvents.where("[subjectType+subjectId]").equals([subjectType, subjectId]).toArray();
    return events.toSorted(compareNewest);
  },

  async listRecent(limit?: number): Promise<LearningEvent[]> {
    const events = await reviewDb.learningEvents.orderBy("observedAt").reverse().toArray();
    return events.toSorted(compareNewest).slice(0, normalizedLimit(limit));
  },

  async getBySource(sourceType: LearningEventSourceType, sourceId: string): Promise<LearningEvent | undefined> {
    return reviewDb.learningEvents.get(learningEventId(sourceType, sourceId));
  },
};
