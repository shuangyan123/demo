import { addStudyDays, requireStudyDay, studyDay } from "./study-day.ts";
import {
  SELF_CONFIDENCE_PROTOCOL_V1,
  learningEventCoreMatches,
  learningEventFromKnowledgeAttempt,
  learningEventFromReviewAttempt,
  type LearningEvent,
  type SelfConfidence,
} from "../types/domains/learning-event.ts";
import type { KnowledgeAttempt } from "../types/domains/knowledge.ts";
import type { Attempt, ReviewResult } from "../types/domains/review.ts";

export type LearningCalibrationRange = 7 | 30 | 90 | "all";

export type LearningCalibrationRecord = {
  sourceType: "review_attempt" | "knowledge_attempt";
  sourceId: string;
  subjectType: "mistake" | "knowledge";
  subjectId: string;
  studyDay: string;
  outcome: ReviewResult;
  selfConfidence: SelfConfidence;
  selfConfidenceProtocol: typeof SELF_CONFIDENCE_PROTOCOL_V1;
  practiceKind?: "standard" | "retry" | "transfer";
  attemptOrdinal: number;
};

export type LearningCalibrationMismatch = LearningCalibrationRecord & {
  kind: "high_confidence_wrong" | "low_confidence_correct";
};

export type DelayedRecallPair = {
  sourceType: "review_attempt" | "knowledge_attempt";
  subjectType: "mistake" | "knowledge";
  subjectId: string;
  previousStudyDay: string;
  previousSourceId: string;
  previousOutcome: ReviewResult;
  currentStudyDay: string;
  currentSourceId: string;
  currentOutcome: ReviewResult;
};

export type LearningCalibrationEvidence = {
  eligibleAttemptCount: number;
  confidenceCount: number;
  highConfidenceCount: number;
  highConfidenceWrongCount: number;
  lowConfidenceCount: number;
  lowConfidenceCorrectCount: number;
  confidenceRecords: LearningCalibrationRecord[];
  mismatches: LearningCalibrationMismatch[];
};

export type DelayedRecallEvidence = {
  denominator: number;
  correctCount: number;
  pairs: DelayedRecallPair[];
};

export type LearningEvidence = {
  calibration: LearningCalibrationEvidence;
  delayedRecall: DelayedRecallEvidence;
};

type SourceAttempt = {
  sourceType: "review_attempt" | "knowledge_attempt";
  sourceId: string;
  subjectType: "mistake" | "knowledge";
  subjectId: string;
  reviewedAt: string;
  studyDay: string;
  outcome: ReviewResult;
  canonical: LearningEvent;
};

const resultRank: Record<ReviewResult, number> = { correct: 1, uncertain: 2, wrong: 3 };

function isReviewResult(value: unknown): value is ReviewResult {
  return value === "correct" || value === "uncertain" || value === "wrong";
}

function sourceKey(sourceType: SourceAttempt["sourceType"] | LearningEvent["sourceType"], sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

function subjectKey(subjectType: SourceAttempt["subjectType"], subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function actualTimestamp(value: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isEligibleStudyValue(reviewedAt: string, today: string, nowTime: number): string | null {
  if (typeof reviewedAt !== "string" || !reviewedAt.trim()) return null;
  const day = studyDay(reviewedAt);
  if (day === null || day > today) return null;
  const timestamp = actualTimestamp(reviewedAt);
  if (timestamp !== null && timestamp > nowTime) return null;
  return day;
}

function isInRange(day: string, range: LearningCalibrationRange, today: string): boolean {
  if (range === "all") return day <= today;
  return day >= addStudyDays(today, -(range - 1)) && day <= today;
}

function compareSourceHistory(left: SourceAttempt, right: SourceAttempt): number {
  const dayOrder = left.studyDay.localeCompare(right.studyDay);
  if (dayOrder) return dayOrder;
  const leftTimestamp = actualTimestamp(left.reviewedAt);
  const rightTimestamp = actualTimestamp(right.reviewedAt);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  return sourceKey(left.sourceType, left.sourceId).localeCompare(sourceKey(right.sourceType, right.sourceId));
}

function compareNewestDelayedPair(left: DelayedRecallPair, right: DelayedRecallPair): number {
  return right.currentStudyDay.localeCompare(left.currentStudyDay)
    || subjectKey(left.subjectType, left.subjectId).localeCompare(subjectKey(right.subjectType, right.subjectId))
    || left.currentSourceId.localeCompare(right.currentSourceId)
    || left.previousSourceId.localeCompare(right.previousSourceId);
}

function buildSourceAttempts(
  attempts: readonly Attempt[],
  knowledgeAttempts: readonly KnowledgeAttempt[],
  today: string,
  nowTime: number,
): SourceAttempt[] {
  const sources: SourceAttempt[] = [];
  for (const attempt of attempts) {
    const day = isEligibleStudyValue(attempt.reviewedAt, today, nowTime);
    if (day === null || !attempt.id || !attempt.mistakeId || !isReviewResult(attempt.result)) continue;
    sources.push({
      sourceType: "review_attempt",
      sourceId: attempt.id,
      subjectType: "mistake",
      subjectId: attempt.mistakeId,
      reviewedAt: attempt.reviewedAt,
      studyDay: day,
      outcome: attempt.result,
      canonical: learningEventFromReviewAttempt(attempt),
    });
  }
  for (const attempt of knowledgeAttempts) {
    const day = isEligibleStudyValue(attempt.reviewedAt, today, nowTime);
    if (day === null || !attempt.id || !attempt.knowledgeId || !isReviewResult(attempt.result)) continue;
    sources.push({
      sourceType: "knowledge_attempt",
      sourceId: attempt.id,
      subjectType: "knowledge",
      subjectId: attempt.knowledgeId,
      reviewedAt: attempt.reviewedAt,
      studyDay: day,
      outcome: attempt.result,
      canonical: learningEventFromKnowledgeAttempt(attempt),
    });
  }
  return sources;
}

function eventGroups(events: readonly LearningEvent[]): Map<string, LearningEvent[]> {
  const grouped = new Map<string, LearningEvent[]>();
  for (const event of events) {
    if (!event.sourceType || typeof event.sourceId !== "string" || !event.sourceId) continue;
    const key = sourceKey(event.sourceType, event.sourceId);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return grouped;
}

type OptionalConfidence =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; value: SelfConfidence };

function optionalConfidence(event: LearningEvent): OptionalConfidence {
  const confidence = event.selfConfidence;
  const protocol = event.selfConfidenceProtocol;
  if (confidence === undefined && protocol === undefined) return { kind: "missing" };
  if (typeof confidence === "number" && Number.isInteger(confidence) && confidence >= 1 && confidence <= 5 && protocol === SELF_CONFIDENCE_PROTOCOL_V1) {
    return { kind: "valid", value: confidence as SelfConfidence };
  }
  return { kind: "invalid" };
}

function resolvedConfidence(events: readonly LearningEvent[]): SelfConfidence | undefined {
  const signatures = events.map((event): string => {
    const resolved = optionalConfidence(event);
    return resolved.kind === "valid" ? `valid:${resolved.value}` : resolved.kind;
  });
  if (!signatures.length || new Set(signatures).size !== 1) return undefined;
  const resolved = optionalConfidence(events[0]);
  return resolved.kind === "valid" ? resolved.value : undefined;
}

function resolvedPracticeKind(events: readonly LearningEvent[]): LearningCalibrationRecord["practiceKind"] {
  if (!events.length) return undefined;
  const values = events.map((event) => event.practiceKind ?? "missing");
  if (new Set(values).size !== 1) return undefined;
  const value = values[0];
  return value === "standard" || value === "retry" || value === "transfer" ? value : undefined;
}

function sourceOrdinals(sources: readonly SourceAttempt[]): Map<string, number> {
  const bySubject = new Map<string, SourceAttempt[]>();
  for (const source of sources) {
    const key = subjectKey(source.subjectType, source.subjectId);
    bySubject.set(key, [...(bySubject.get(key) ?? []), source]);
  }
  const ordinals = new Map<string, number>();
  for (const subjectSources of bySubject.values()) {
    for (const [index, source] of [...subjectSources].sort(compareSourceHistory).entries()) {
      ordinals.set(sourceKey(source.sourceType, source.sourceId), index + 1);
    }
  }
  return ordinals;
}

function deriveCalibration(
  sources: readonly SourceAttempt[],
  events: readonly LearningEvent[],
  range: LearningCalibrationRange,
  today: string,
): LearningCalibrationEvidence {
  const groups = eventGroups(events);
  const ordinals = sourceOrdinals(sources);
  const confidenceRecords: LearningCalibrationRecord[] = [];
  for (const source of sources) {
    if (!isInRange(source.studyDay, range, today)) continue;
    const matchingEvents = (groups.get(sourceKey(source.sourceType, source.sourceId)) ?? [])
      .filter((event) => learningEventCoreMatches(event, source.canonical));
    const confidence = resolvedConfidence(matchingEvents);
    if (confidence === undefined) continue;
    confidenceRecords.push({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      subjectType: source.subjectType,
      subjectId: source.subjectId,
      studyDay: source.studyDay,
      outcome: source.outcome,
      selfConfidence: confidence,
      selfConfidenceProtocol: SELF_CONFIDENCE_PROTOCOL_V1,
      practiceKind: resolvedPracticeKind(matchingEvents),
      attemptOrdinal: ordinals.get(sourceKey(source.sourceType, source.sourceId)) ?? 0,
    });
  }
  const highConfidence = confidenceRecords.filter((record) => record.selfConfidence >= 4);
  const lowConfidence = confidenceRecords.filter((record) => record.selfConfidence <= 2);
  const mismatches: LearningCalibrationMismatch[] = [
    ...highConfidence.filter((record) => record.outcome === "wrong").map((record) => ({ ...record, kind: "high_confidence_wrong" as const })),
    ...lowConfidence.filter((record) => record.outcome === "correct").map((record) => ({ ...record, kind: "low_confidence_correct" as const })),
  ].sort((left, right) => right.studyDay.localeCompare(left.studyDay) || left.sourceId.localeCompare(right.sourceId));
  return {
    eligibleAttemptCount: sources.filter((source) => isInRange(source.studyDay, range, today)).length,
    confidenceCount: confidenceRecords.length,
    highConfidenceCount: highConfidence.length,
    highConfidenceWrongCount: highConfidence.filter((record) => record.outcome === "wrong").length,
    lowConfidenceCount: lowConfidence.length,
    lowConfidenceCorrectCount: lowConfidence.filter((record) => record.outcome === "correct").length,
    confidenceRecords: confidenceRecords.sort((left, right) => right.studyDay.localeCompare(left.studyDay) || left.sourceId.localeCompare(right.sourceId)),
    mismatches,
  };
}

function dailyRepresentative(sources: readonly SourceAttempt[]): Map<string, SourceAttempt> {
  const days = new Map<string, SourceAttempt>();
  for (const source of sources) {
    const current = days.get(source.studyDay);
    if (!current || resultRank[source.outcome] > resultRank[current.outcome]
      || (resultRank[source.outcome] === resultRank[current.outcome]
        && sourceKey(source.sourceType, source.sourceId).localeCompare(sourceKey(current.sourceType, current.sourceId)) < 0)) {
      days.set(source.studyDay, source);
    }
  }
  return days;
}

function deriveDelayedRecall(
  sources: readonly SourceAttempt[],
  range: LearningCalibrationRange,
  today: string,
): DelayedRecallEvidence {
  const bySubject = new Map<string, SourceAttempt[]>();
  for (const source of sources) {
    const key = subjectKey(source.subjectType, source.subjectId);
    bySubject.set(key, [...(bySubject.get(key) ?? []), source]);
  }
  const pairs: DelayedRecallPair[] = [];
  for (const subjectSources of bySubject.values()) {
    const orderedDays = [...dailyRepresentative(subjectSources).entries()].sort(([left], [right]) => left.localeCompare(right));
    for (let index = 1; index < orderedDays.length; index += 1) {
      const [currentStudyDay, current] = orderedDays[index];
      const [previousStudyDay, previous] = orderedDays[index - 1];
      if (!isInRange(currentStudyDay, range, today)) continue;
      pairs.push({
        sourceType: current.sourceType,
        subjectType: current.subjectType,
        subjectId: current.subjectId,
        previousStudyDay,
        previousSourceId: previous.sourceId,
        previousOutcome: previous.outcome,
        currentStudyDay,
        currentSourceId: current.sourceId,
        currentOutcome: current.outcome,
      });
    }
  }
  pairs.sort(compareNewestDelayedPair);
  return {
    denominator: pairs.length,
    correctCount: pairs.filter((pair) => pair.currentOutcome === "correct").length,
    pairs,
  };
}

/** L6 只读取规范来源尝试和匹配的首方事件，输出描述性自评/跨日证据。 */
export function deriveLearningEvidence({
  attempts,
  knowledgeAttempts = [],
  learningEvents = [],
  now,
  range,
}: {
  attempts: Attempt[];
  knowledgeAttempts?: KnowledgeAttempt[];
  learningEvents?: LearningEvent[];
  now: Date;
  range: LearningCalibrationRange;
}): LearningEvidence {
  const today = requireStudyDay(now);
  const sources = buildSourceAttempts(attempts, knowledgeAttempts, today, now.getTime());
  return {
    calibration: deriveCalibration(sources, learningEvents, range, today),
    delayedRecall: deriveDelayedRecall(sources, range, today),
  };
}

/** 命名别名保留“校准”入口，方便 contract 直接约束 L6 纯派生边界。 */
export const deriveLearningCalibrationEvidence = deriveLearningEvidence;
