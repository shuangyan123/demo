import { studyDay, requireStudyDay, addStudyDays, isStudyDayDue } from "../../lib/study-day.ts";
import { masteryLevelToScore } from "../../lib/weakness-intelligence.ts";
import { deriveLearningEvidence, type LearningEvidence } from "../../lib/learning-calibration.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { LearnerStateSignal, LearnerStateSnapshot } from "../../types/domains/learner-state.ts";
import type { LearningEvent } from "../../types/domains/learning-event.ts";
import type { Attempt, Mistake, ReviewResult } from "../../types/domains/review.ts";

/** 薄弱分析支持的时间范围。 */
export type LearningInsightRange = 7 | 30 | 90 | "all";
export type LearningInsightScope = "all" | "due" | "unmastered";

/** 单个日期的正确率趋势点。 */
export type LearningInsightTrendPoint = {
  date: string;
  reviewed: number;
  correct: number;
  correctRate: number;
  movingAverage: number;
};

/** 单个板块的可核验复盘摘要。 */
export type LearningInsightBoardRow = {
  board: string;
  reviewed: number;
  correctRate: number | null;
  mastery: number | null;
  masteryScore: number | null;
  dueCount: number;
  sufficient: boolean;
  trend: "up" | "down" | "stable" | null;
};

/** 单个错题或知识点在当前范围内的真实训练证据。 */
export type LearningInsightOutcomeMetrics = {
  attemptCount: number;
  correctCount: number;
  uncertainCount: number;
  wrongCount: number;
  correctRate: number | null;
  latestResult: ReviewResult | null;
  latestReviewedAt: string | null;
};

export type LearningInsightPriorityItem = {
  id: string;
  mastery: number;
  nextReviewAt?: string;
};

/** 薄弱分析只保存可由现有记录推导的展示快照。 */
export type LearningInsightSnapshot = {
  range: LearningInsightRange;
  board: string;
  scope: LearningInsightScope;
  attemptsCount: number;
  correctCount: number;
  uncertainCount: number;
  wrongCount: number;
  correctRate: number | null;
  distinctStudyDays: number;
  spacedAttemptCount: number;
  spacedCorrectCount: number;
  spacedCorrectRate: number | null;
  recoveredSubjectCount: number;
  dueCount: number;
  insufficientBoards: number;
  trend: LearningInsightTrendPoint[];
  boards: LearningInsightBoardRow[];
  priorityMistakes: Mistake[];
  priorityKnowledge: KnowledgeEntry[];
  mistakeMetrics: Map<string, LearningInsightOutcomeMetrics>;
  knowledgeMetrics: Map<string, LearningInsightOutcomeMetrics>;
  learningEvidence: LearningEvidence;
  calibrationEvidence: LearningEvidence["calibration"];
  delayedRecallEvidence: LearningEvidence["delayedRecall"];
};

const MIN_RELIABLE_ATTEMPTS = 5;

function isReviewResult(value: unknown): value is ReviewResult {
  return value === "correct" || value === "uncertain" || value === "wrong";
}

function timestamp(value: string): number | null {
  if (studyDay(value) === null) return null;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

const studyDate = studyDay;
const dateOffset = addStudyDays;

function inRange(reviewedAt: string, range: LearningInsightRange, now: Date) {
  const reviewedDate = studyDate(reviewedAt);
  const today = requireStudyDay(now);
  if (reviewedDate === null || reviewedDate > today) return false;
  if (range === "all") return true;
  const firstIncludedDay = dateOffset(today, -(range - 1));
  return reviewedDate >= firstIncludedDay;
}

function compareCanonicalDueDays(left: string | undefined, right: string | undefined): number {
  const leftDay = studyDate(left);
  const rightDay = studyDate(right);
  if (leftDay === null) return rightDay === null ? 0 : 1;
  if (rightDay === null) return -1;
  return leftDay.localeCompare(rightDay);
}

/** 优先级只按掌握度、canonical 学习日和 ID 排序；无效日期稳定地排在有效日期之后。 */
export function compareLearningInsightPriorityItems(
  left: LearningInsightPriorityItem,
  right: LearningInsightPriorityItem,
): number {
  return left.mastery - right.mastery
    || compareCanonicalDueDays(left.nextReviewAt, right.nextReviewAt)
    || left.id.localeCompare(right.id);
}

function rate<T extends { result: ReviewResult }>(attempts: readonly T[]) {
  if (!attempts.length) return null;
  return Math.round((attempts.filter((attempt) => attempt.result === "correct").length / attempts.length) * 100);
}

function compareNewest(left: { id: string; reviewedAt: string }, right: { id: string; reviewedAt: string }) {
  return (timestamp(right.reviewedAt) ?? 0) - (timestamp(left.reviewedAt) ?? 0)
    || left.id.localeCompare(right.id);
}

function summarizeAttempts<T extends { id: string; result: ReviewResult; reviewedAt: string }>(
  rangeAttempts: readonly T[],
  historyAttempts: readonly T[],
): LearningInsightOutcomeMetrics {
  const latest = [...historyAttempts].sort(compareNewest)[0];
  return {
    attemptCount: rangeAttempts.length,
    correctCount: rangeAttempts.filter((attempt) => attempt.result === "correct").length,
    uncertainCount: rangeAttempts.filter((attempt) => attempt.result === "uncertain").length,
    wrongCount: rangeAttempts.filter((attempt) => attempt.result === "wrong").length,
    correctRate: rate(rangeAttempts),
    latestResult: latest?.result ?? null,
    latestReviewedAt: latest?.reviewedAt ?? null,
  };
}

function boardTrend(attempts: Attempt[]) {
  if (attempts.length < MIN_RELIABLE_ATTEMPTS) return null;
  const ordered = [...attempts].sort((left, right) => compareNewest(right, left));
  const split = Math.floor(ordered.length / 2);
  const earlier = rate(ordered.slice(0, split)) ?? 0;
  const later = rate(ordered.slice(split)) ?? 0;
  if (later - earlier >= 8) return "up" as const;
  if (earlier - later >= 8) return "down" as const;
  return "stable" as const;
}

function validReviewAttempt(attempt: Attempt, mistakeIds: Set<string>, now: Date) {
  return mistakeIds.has(attempt.mistakeId)
    && isReviewResult(attempt.result)
    && studyDate(attempt.reviewedAt) !== null
    && inRange(attempt.reviewedAt, "all", now);
}

function validKnowledgeAttempt(attempt: KnowledgeAttempt, knowledgeIds: Set<string>, now: Date) {
  return knowledgeIds.has(attempt.knowledgeId)
    && isReviewResult(attempt.result)
    && studyDate(attempt.reviewedAt) !== null
    && inRange(attempt.reviewedAt, "all", now);
}

function groupedAttemptsBySubject<T extends { reviewedAt: string }>(attempts: readonly T[], subjectId: (attempt: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const attempt of attempts) {
    const key = subjectId(attempt);
    grouped.set(key, [...(grouped.get(key) ?? []), attempt]);
  }
  return grouped;
}

function dailyOutcome(attempts: readonly Attempt[]) {
  const byDate = new Map<string, ReviewResult[]>();
  for (const attempt of attempts) {
    const date = studyDate(attempt.reviewedAt);
    if (!date) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), attempt.result]);
  }
  return [...byDate.entries()]
    .map(([date, results]) => ({
      date,
      // 同一天出现多个结果时保留更保守的结果，避免同日重试伪造恢复证据。
      result: results.includes("wrong") ? "wrong" : results.includes("uncertain") ? "uncertain" : "correct" as ReviewResult,
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

function hasRecoveryEvidence(mistake: Mistake, attempts: readonly Attempt[], today: string) {
  if (mistake.mastery < 3 || isStudyDayDue(mistake.nextReviewAt, today)) return false;
  const days = dailyOutcome(attempts);
  const latest = days[0];
  return latest?.result === "correct"
    && days.slice(1).some((day) => day.result === "wrong" || day.result === "uncertain");
}

/**
 * 由已保存的错题、复盘和知识资料生成确定性学习洞察。
 * 缺少错题关联的复盘会被忽略，避免把孤立记录归入错误板块。
 */
export function deriveLearningInsightSnapshot({
  attempts,
  knowledgeAttempts = [],
  learningEvents = [],
  knowledgeEntries,
  mistakes,
  now,
  range,
  board = "全部板块",
  scope = "all",
}: {
  attempts: Attempt[];
  knowledgeAttempts?: KnowledgeAttempt[];
  learningEvents?: LearningEvent[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  now: Date;
  range: LearningInsightRange;
  board?: string;
  scope?: LearningInsightScope;
}): LearningInsightSnapshot {
  const today = requireStudyDay(now);
  const scopedMistakes = mistakes.filter((mistake) => (
    (board === "全部板块" || mistake.board === board)
    && (scope === "all" || (scope === "due" ? isStudyDayDue(mistake.nextReviewAt, today) : mistake.mastery <= 2))
  ));
  const scopedKnowledgeEntries = knowledgeEntries.filter((entry) => (
    (board === "全部板块" || entry.category === board || entry.tags.includes(board))
    && (scope === "all" || (scope === "due" ? isStudyDayDue(entry.nextReviewAt, today) : entry.mastery <= 2))
  ));
  const mistakeById = new Map(scopedMistakes.map((mistake) => [mistake.id, mistake]));
  const knowledgeById = new Map(scopedKnowledgeEntries.map((entry) => [entry.id, entry]));
  const mistakeIds = new Set(mistakeById.keys());
  const knowledgeIds = new Set(knowledgeById.keys());
  const historyAttempts = attempts.filter((attempt) => mistakeById.has(attempt.mistakeId) && validReviewAttempt(attempt, mistakeIds, now));
  const validAttempts = historyAttempts.filter((attempt) => inRange(attempt.reviewedAt, range, now));
  const historyKnowledgeAttempts = knowledgeAttempts.filter((attempt) => validKnowledgeAttempt(attempt, knowledgeIds, now));
  const validKnowledgeAttempts = historyKnowledgeAttempts.filter((attempt) => inRange(attempt.reviewedAt, range, now));
  const learningEvidence = deriveLearningEvidence({
    attempts: historyAttempts,
    knowledgeAttempts: historyKnowledgeAttempts,
    learningEvents,
    now,
    range,
  });
  const attemptsByMistake = groupedAttemptsBySubject(historyAttempts, (attempt) => attempt.mistakeId);
  const rangeAttemptsByMistake = groupedAttemptsBySubject(validAttempts, (attempt) => attempt.mistakeId);
  const attemptsByKnowledge = groupedAttemptsBySubject(historyKnowledgeAttempts, (attempt) => attempt.knowledgeId);
  const rangeAttemptsByKnowledge = groupedAttemptsBySubject(validKnowledgeAttempts, (attempt) => attempt.knowledgeId);
  const attemptsByBoard = new Map<string, Attempt[]>();
  for (const attempt of validAttempts) {
    const attemptBoard = mistakeById.get(attempt.mistakeId)?.board;
    if (!attemptBoard) continue;
    attemptsByBoard.set(attemptBoard, [...(attemptsByBoard.get(attemptBoard) ?? []), attempt]);
  }

  const mistakesByBoard = new Map<string, Mistake[]>();
  for (const mistake of scopedMistakes) {
    mistakesByBoard.set(mistake.board, [...(mistakesByBoard.get(mistake.board) ?? []), mistake]);
  }
  const boards = [...new Set([...mistakesByBoard.keys(), ...attemptsByBoard.keys()])].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const rows = boards.map<LearningInsightBoardRow>((boardName) => {
    const boardAttempts = attemptsByBoard.get(boardName) ?? [];
    const boardMistakes = mistakesByBoard.get(boardName) ?? [];
    return {
      board: boardName,
      reviewed: boardAttempts.length,
      correctRate: rate(boardAttempts),
      mastery: boardMistakes.length
        ? Math.round((boardMistakes.reduce((sum, mistake) => sum + mistake.mastery, 0) / boardMistakes.length) * 10) / 10
        : null,
      masteryScore: boardMistakes.length
        ? Math.round(boardMistakes.reduce((sum, mistake) => sum + masteryLevelToScore(mistake.mastery), 0) / boardMistakes.length)
        : null,
      dueCount: boardMistakes.filter((mistake) => isStudyDayDue(mistake.nextReviewAt, today)).length,
      sufficient: boardAttempts.length >= MIN_RELIABLE_ATTEMPTS,
      trend: boardTrend(boardAttempts),
    };
  });

  const trendByDate = new Map<string, Attempt[]>();
  for (const attempt of validAttempts) {
    const date = studyDate(attempt.reviewedAt);
    if (!date) continue;
    trendByDate.set(date, [...(trendByDate.get(date) ?? []), attempt]);
  }
  const rawTrend = [...trendByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateAttempts]) => ({
      date,
      reviewed: dateAttempts.length,
      correct: dateAttempts.filter((attempt) => attempt.result === "correct").length,
      correctRate: rate(dateAttempts) ?? 0,
    }));
  const trend = rawTrend.map<LearningInsightTrendPoint>((point) => {
    const windowStart = dateOffset(point.date, -6);
    const windowAttempts = historyAttempts.filter((attempt) => {
      const date = studyDate(attempt.reviewedAt);
      return date !== null && date >= windowStart && date <= point.date;
    });
    return { ...point, movingAverage: rate(windowAttempts) ?? 0 };
  });

  const firstStudyDateByMistake = new Map<string, string>();
  for (const attempt of historyAttempts) {
    const date = studyDate(attempt.reviewedAt);
    if (!date) continue;
    const previous = firstStudyDateByMistake.get(attempt.mistakeId);
    if (!previous || date < previous) firstStudyDateByMistake.set(attempt.mistakeId, date);
  }
  const spacedAttempts = validAttempts.filter((attempt) => {
    const date = studyDate(attempt.reviewedAt);
    const firstDate = firstStudyDateByMistake.get(attempt.mistakeId);
    return date !== null && firstDate !== undefined && date > firstDate;
  });
  const orderedMistakes = [...scopedMistakes].sort((left, right) => left.id.localeCompare(right.id));
  const orderedKnowledgeEntries = [...scopedKnowledgeEntries].sort((left, right) => left.id.localeCompare(right.id));
  const mistakeMetrics = new Map(orderedMistakes.map((mistake) => [
    mistake.id,
    summarizeAttempts(rangeAttemptsByMistake.get(mistake.id) ?? [], attemptsByMistake.get(mistake.id) ?? []),
  ]));
  const knowledgeMetrics = new Map(orderedKnowledgeEntries.map((entry) => [
    entry.id,
    summarizeAttempts(rangeAttemptsByKnowledge.get(entry.id) ?? [], attemptsByKnowledge.get(entry.id) ?? []),
  ]));

  return {
    range,
    board,
    scope,
    attemptsCount: validAttempts.length,
    correctCount: validAttempts.filter((attempt) => attempt.result === "correct").length,
    uncertainCount: validAttempts.filter((attempt) => attempt.result === "uncertain").length,
    wrongCount: validAttempts.filter((attempt) => attempt.result === "wrong").length,
    correctRate: rate(validAttempts),
    distinctStudyDays: new Set(validAttempts.map((attempt) => studyDate(attempt.reviewedAt)).filter((date): date is string => date !== null)).size,
    spacedAttemptCount: spacedAttempts.length,
    spacedCorrectCount: spacedAttempts.filter((attempt) => attempt.result === "correct").length,
    spacedCorrectRate: rate(spacedAttempts),
    recoveredSubjectCount: orderedMistakes.filter((mistake) => hasRecoveryEvidence(mistake, attemptsByMistake.get(mistake.id) ?? [], today)).length,
    dueCount: scopedMistakes.filter((mistake) => isStudyDayDue(mistake.nextReviewAt, today)).length
      + scopedKnowledgeEntries.filter((entry) => isStudyDayDue(entry.nextReviewAt, today)).length,
    insufficientBoards: rows.filter((row) => !row.sufficient).length,
    trend,
    boards: rows,
    priorityMistakes: [...scopedMistakes]
      .sort(compareLearningInsightPriorityItems)
      .slice(0, 5),
    priorityKnowledge: [...scopedKnowledgeEntries]
      .sort(compareLearningInsightPriorityItems)
      .slice(0, 4),
    mistakeMetrics,
    knowledgeMetrics,
    learningEvidence,
    calibrationEvidence: learningEvidence.calibration,
    delayedRecallEvidence: learningEvidence.delayedRecall,
  };
}

/** 只选择 L4 已派生的当前薄弱/错因信号，不重新计算风险或分数。 */
export function selectLearningInsightSignals(learnerState: LearnerStateSnapshot, limit = 4): LearnerStateSignal[] {
  return learnerState.signals
    .filter((signal) => signal.kind === "weakness" || signal.kind === "misconception")
    .slice(0, limit);
}
