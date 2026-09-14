import type { KnowledgeAttempt } from "./knowledge.ts";
import type { Attempt } from "./review.ts";

export type LearningEventSourceType = "review_attempt" | "knowledge_attempt";
export type LearningEventSubjectType = "mistake" | "knowledge";
export type LearningEventOutcome = "correct" | "uncertain" | "wrong";
export const SELF_CONFIDENCE_PROTOCOL_V1 = "pre_feedback_1_5_v1" as const;
export type SelfConfidence = 1 | 2 | 3 | 4 | 5;
export type LearningAttemptEvidenceInput = {
  selfConfidence?: SelfConfidence;
};
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
  selfConfidenceProtocol?: string;
  hintCount?: number;
  errorCause?: LearningErrorCause;
  attemptOrdinal?: number;
  practiceKind?: "standard" | "retry" | "transfer";
};

/** 首方复盘只接受窄化的、反馈前的 1-5 自评；不在边界处截断或隐式转换。 */
export function validateLearningAttemptEvidence(
  input: LearningAttemptEvidenceInput | undefined,
): SelfConfidence | undefined {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("学习自信度证据必须是可选的窄输入对象");
  }
  const keys = Object.keys(input as object);
  if (keys.some((key) => key !== "selfConfidence")) {
    throw new TypeError("学习自信度证据不接受协议或其他扩展字段");
  }
  const value = (input as { selfConfidence?: unknown }).selfConfidence;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new RangeError("反馈前自信度必须是 1 到 5 的整数");
  }
  return value as SelfConfidence;
}

/** 首方写入固定协议并只允许 standard/retry；transfer 永远不是复盘入口可选项。 */
export function attachFirstPartyAttemptEvidence(
  canonical: LearningEvent,
  practiceKind: "standard" | "retry",
  selfConfidence: SelfConfidence | undefined,
): LearningEvent {
  return {
    ...canonical,
    practiceKind,
    ...(selfConfidence === undefined
      ? {}
      : { selfConfidence, selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1 }),
  };
}

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
    // L6 自评属于描述性洞察；不把固定协议的值传播到 L4/LearnerState。无协议 legacy 值仍按既有通用事件兼容。
    ...(Number.isFinite(event.selfConfidence) && event.selfConfidenceProtocol !== SELF_CONFIDENCE_PROTOCOL_V1 ? { selfConfidence: event.selfConfidence } : {}),
    ...(Number.isInteger(event.hintCount) && event.hintCount! >= 0 ? { hintCount: event.hintCount } : {}),
    ...(event.errorCause && causes.includes(event.errorCause) ? { errorCause: event.errorCause } : {}),
    ...(Number.isInteger(event.attemptOrdinal) && event.attemptOrdinal! >= 1 ? { attemptOrdinal: event.attemptOrdinal } : {}),
    ...(event.practiceKind && ["standard", "retry", "transfer"].includes(event.practiceKind) ? { practiceKind: event.practiceKind } : {}),
  };
}
