import { reviewDb } from "../db/review-db.ts";
import type { LearningEvent, LearningEventSourceType, LearningEventSubjectType } from "../types/domains/learning-event.ts";
import { learningEventId } from "../types/domains/learning-event.ts";

const DEFAULT_RECENT_LIMIT = 50;
export const LEARNING_EVENT_BATCH_SIZE = 256;

export type LearningEventSubjectRef = {
  subjectType: LearningEventSubjectType;
  subjectId: string;
};

function compareNewest(left: LearningEvent, right: LearningEvent): number {
  return right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id);
}

function subjectRefKey(subject: LearningEventSubjectRef): string {
  return JSON.stringify([subject.subjectType, subject.subjectId]);
}

function compareSubjectRefs(left: LearningEventSubjectRef, right: LearningEventSubjectRef): number {
  return left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId);
}

/** 先去重并稳定排序，再按固定大小切分，确保批量读取不会退化为 N 次查询。 */
export function planLearningEventSubjectBatches(
  subjects: readonly LearningEventSubjectRef[],
): LearningEventSubjectRef[][] {
  const unique = new Map<string, LearningEventSubjectRef>();
  for (const subject of subjects) {
    const ref = { subjectType: subject.subjectType, subjectId: subject.subjectId };
    if (!unique.has(subjectRefKey(ref))) unique.set(subjectRefKey(ref), ref);
  }

  const sorted = [...unique.values()].toSorted(compareSubjectRefs);
  const batches: LearningEventSubjectRef[][] = [];
  for (let index = 0; index < sorted.length; index += LEARNING_EVENT_BATCH_SIZE) {
    batches.push(sorted.slice(index, index + LEARNING_EVENT_BATCH_SIZE));
  }
  return batches;
}

function compoundKey(subject: LearningEventSubjectRef): [LearningEventSubjectType, string] {
  return [subject.subjectType, subject.subjectId];
}

async function readForSubjects(subjects: readonly LearningEventSubjectRef[]): Promise<LearningEvent[]> {
  const batches = planLearningEventSubjectBatches(subjects);
  if (!batches.length) return [];

  const requestedKeys = new Set(batches.flat().map(subjectRefKey));
  const events = (await Promise.all(batches.map((batch) => reviewDb.learningEvents
    .where("[subjectType+subjectId]")
    .anyOf(batch.map(compoundKey))
    .toArray()))).flat();

  return events
    .filter((event) => requestedKeys.has(subjectRefKey(event)))
    .toSorted(compareNewest);
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RECENT_LIMIT;
  return Math.max(0, Math.floor(limit));
}

/** 学习事件只提供稳定的历史读取；learner-state 在读取边界按已过滤 subject 使用它们派生信号。 */
export const learningEventRepository = {
  async listForSubject(subjectType: LearningEventSubjectType, subjectId: string): Promise<LearningEvent[]> {
    return readForSubjects([{ subjectType, subjectId }]);
  },

  async listForSubjects(subjects: readonly LearningEventSubjectRef[]): Promise<LearningEvent[]> {
    return readForSubjects(subjects);
  },

  async listRecent(limit?: number): Promise<LearningEvent[]> {
    const events = await reviewDb.learningEvents.orderBy("observedAt").reverse().toArray();
    return events.toSorted(compareNewest).slice(0, normalizedLimit(limit));
  },

  async getBySource(sourceType: LearningEventSourceType, sourceId: string): Promise<LearningEvent | undefined> {
    return reviewDb.learningEvents.get(learningEventId(sourceType, sourceId));
  },
};
