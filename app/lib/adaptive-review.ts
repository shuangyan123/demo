import type { LearningEvent, LearningEventOutcome } from "../types/domains/learning-event.ts";
import type { ReviewResult } from "../types/domains/review.ts";

const MIN_MASTERY = 1;
const MAX_MASTERY = 5;
const MAX_HISTORY_DAYS = 8;
const MAX_STREAK = 5;
const MAX_LAPSE_DAYS = 3;
const MIN_INTERVAL_DAYS = 2;
const MAX_INTERVAL_DAYS = 30;

export type AdaptiveReviewInput = {
  currentMastery: number;
  result: ReviewResult;
  today: Date;
  priorEvents: readonly LearningEvent[];
};

export type AdaptiveReviewDecision = {
  masteryAfter: number;
  intervalDays: number;
  nextReviewAt: string;
  recentCorrectStreak: number;
  recentLapseDays: number;
  sameDayRetry: boolean;
};

type CollapsedStudyDay = {
  date: string;
  outcome: LearningEventOutcome;
};

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function relativeDate(today: Date, days: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return toDateStamp(date);
}

function clampMastery(value: number): number {
  return Math.max(MIN_MASTERY, Math.min(MAX_MASTERY, value));
}

function studyDate(observedAt: string): string | undefined {
  const date = observedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function outcomeStrength(outcome: LearningEventOutcome): number {
  if (outcome === "wrong") return 3;
  if (outcome === "uncertain") return 2;
  return 1;
}

function collapseStudyDays(events: readonly LearningEvent[]): CollapsedStudyDay[] {
  const outcomesByDate = new Map<string, LearningEventOutcome>();
  for (const event of events) {
    const date = studyDate(event.observedAt);
    if (!date) continue;
    const existing = outcomesByDate.get(date);
    if (!existing || outcomeStrength(event.outcome) > outcomeStrength(existing)) {
      outcomesByDate.set(date, event.outcome);
    }
  }

  return Array.from(outcomesByDate, ([date, outcome]) => ({ date, outcome }))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, MAX_HISTORY_DAYS);
}

function countPriorCorrectDays(days: readonly CollapsedStudyDay[]): number {
  let count = 0;
  for (const day of days) {
    if (day.outcome !== "correct") break;
    count += 1;
  }
  return count;
}

/**
 * Deterministic L2 v1 scheduler. LearningEvent history is supplied by the
 * repository so this pure policy never reaches into IndexedDB or invents evidence.
 */
export function resolveAdaptiveReviewDecision({
  currentMastery,
  result,
  today,
  priorEvents,
}: AdaptiveReviewInput): AdaptiveReviewDecision {
  const todayStamp = toDateStamp(today);
  const masteryAfter = clampMastery(currentMastery + (result === "correct" ? 1 : result === "wrong" ? -1 : 0));
  const history = collapseStudyDays(priorEvents);
  const recentLapseDays = Math.min(MAX_LAPSE_DAYS, history.filter((day) => day.outcome === "wrong").length);
  const sameDayRetry = result === "correct" && priorEvents.some((event) => studyDate(event.observedAt) === todayStamp);

  if (result === "wrong") {
    return {
      masteryAfter,
      intervalDays: 0,
      nextReviewAt: relativeDate(today, 0),
      recentCorrectStreak: 0,
      recentLapseDays,
      sameDayRetry: false,
    };
  }

  if (result === "uncertain") {
    return {
      masteryAfter,
      intervalDays: 1,
      nextReviewAt: relativeDate(today, 1),
      recentCorrectStreak: 0,
      recentLapseDays,
      sameDayRetry: false,
    };
  }

  if (sameDayRetry) {
    return {
      masteryAfter,
      intervalDays: 1,
      nextReviewAt: relativeDate(today, 1),
      recentCorrectStreak: 1,
      recentLapseDays,
      sameDayRetry: true,
    };
  }

  const recentCorrectStreak = Math.min(MAX_STREAK, 1 + countPriorCorrectDays(history));
  const baseInterval = Math.max(MIN_INTERVAL_DAYS, masteryAfter * 2);
  const streakMultiplier = 1 + 0.25 * (recentCorrectStreak - 1);
  const lapseMultiplier = 1 - 0.1 * recentLapseDays;
  const intervalDays = Math.min(
    MAX_INTERVAL_DAYS,
    Math.max(MIN_INTERVAL_DAYS, Math.round(baseInterval * streakMultiplier * lapseMultiplier)),
  );

  return {
    masteryAfter,
    intervalDays,
    nextReviewAt: relativeDate(today, intervalDays),
    recentCorrectStreak,
    recentLapseDays,
    sameDayRetry: false,
  };
}
