import type { KnowledgeAttempt } from "./knowledge.ts";
import type { Attempt } from "./review.ts";

export type LearningEventSourceType = "review_attempt" | "knowledge_attempt";
export type LearningEventSubjectType = "mistake" | "knowledge";
export type LearningEventOutcome = "correct" | "uncertain" | "wrong";
export type LearningErrorCause =
  | "knowledge_gap"
  | "memory_lapse"
  | "method_selection"
  | "comprehension"
  | "calculation"
  | "careless"
  | "time_pressure"
  | "changed_answer"
  | "other";

export type LearningEvent = {
  id: string;
  sourceType: LearningEventSourceType;
  sourceId: string;
  subjectType: LearningEventSubjectType;
  subjectId: string;
  outcome: LearningEventOutcome;
  observedAt: string;
  masteryAfter?: number;
  durationSec?: number;
  selfConfidence?: number;
  hintCount?: number;
  errorCause?: LearningErrorCause;
  attemptOrdinal?: number;
  practiceKind?: "standard" | "retry" | "transfer";
};

/** 事件 ID 只由规范化来源类型和 canonical attempt ID 构成，便于回填与幂等重建。 */
export function learningEventId(sourceType: LearningEventSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

/** 把已有错题复盘事实投影为证据事件；legacy confidence 保留为 masteryAfter。 */
export function learningEventFromReviewAttempt(attempt: Attempt): LearningEvent {
  return {
    id: learningEventId("review_attempt", attempt.id),
    sourceType: "review_attempt",
    sourceId: attempt.id,
    subjectType: "mistake",
    subjectId: attempt.mistakeId,
    outcome: attempt.result,
    observedAt: attempt.reviewedAt,
    masteryAfter: attempt.confidence,
    ...(Number.isFinite(attempt.durationSec) ? { durationSec: attempt.durationSec } : {}),
  };
}

/** 把已有知识训练事实投影为证据事件，不把 legacy confidence 误解为 selfConfidence。 */
export function learningEventFromKnowledgeAttempt(attempt: KnowledgeAttempt): LearningEvent {
  return {
    id: learningEventId("knowledge_attempt", attempt.id),
    sourceType: "knowledge_attempt",
    sourceId: attempt.id,
    subjectType: "knowledge",
    subjectId: attempt.knowledgeId,
    outcome: attempt.result,
    observedAt: attempt.reviewedAt,
    masteryAfter: attempt.confidence,
  };
}

/** 核心事实只由来源记录决定；扩展证据不能修改该投影。 */
export function learningEventCoreMatches(event: Partial<LearningEvent>, canonical: LearningEvent): boolean {
  return (["id", "sourceType", "sourceId", "subjectType", "subjectId", "outcome", "observedAt", "masteryAfter", "durationSec"] as const)
    .every((field) => event[field] === canonical[field]);
}

/** 只有完整匹配来源的事件才能补充已显式记录的有效可选证据。 */
export function enrichCanonicalLearningEvent(canonical: LearningEvent, event?: LearningEvent): LearningEvent {
  if (!event || !learningEventCoreMatches(event, canonical)) return { ...canonical };
  const causes: readonly string[] = ["knowledge_gap", "memory_lapse", "method_selection", "comprehension", "calculation", "careless", "time_pressure", "changed_answer", "other"];
  return {
    ...canonical,
    ...(Number.isFinite(event.selfConfidence) ? { selfConfidence: event.selfConfidence } : {}),
    ...(Number.isInteger(event.hintCount) && event.hintCount! >= 0 ? { hintCount: event.hintCount } : {}),
    ...(event.errorCause && causes.includes(event.errorCause) ? { errorCause: event.errorCause } : {}),
    ...(Number.isInteger(event.attemptOrdinal) && event.attemptOrdinal! >= 1 ? { attemptOrdinal: event.attemptOrdinal } : {}),
    ...(event.practiceKind && ["standard", "retry", "transfer"].includes(event.practiceKind) ? { practiceKind: event.practiceKind } : {}),
  };
}
