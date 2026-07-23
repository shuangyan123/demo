import type { Attempt, Mistake, ReviewResult } from "../../types/domains/review.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";

/** 薄弱分析支持的时间范围。 */
export type LearningInsightRange = 7 | 30 | 90 | "all";

/** 单个日期的正确率趋势点。 */
export type LearningInsightTrendPoint = {
  date: string;
  reviewed: number;
  correct: number;
  correctRate: number;
};

/** 单个板块的可核验复盘摘要。 */
export type LearningInsightBoardRow = {
  board: string;
  reviewed: number;
  correctRate: number | null;
  mastery: number | null;
  dueCount: number;
  sufficient: boolean;
  trend: "up" | "down" | "stable" | null;
};

/** 薄弱分析只保存可由现有记录推导的展示快照。 */
export type LearningInsightSnapshot = {
  range: LearningInsightRange;
  attemptsCount: number;
  correctRate: number | null;
  dueCount: number;
  insufficientBoards: number;
  trend: LearningInsightTrendPoint[];
  boards: LearningInsightBoardRow[];
  priorityMistakes: Mistake[];
  priorityKnowledge: KnowledgeEntry[];
};

const MIN_RELIABLE_ATTEMPTS = 5;

function isCorrect(result: ReviewResult) {
  return result === "correct";
}

function inRange(reviewedAt: string, range: LearningInsightRange, now: Date) {
  if (range === "all") return true;
  const timestamp = new Date(reviewedAt).getTime();
  const threshold = now.getTime() - range * 24 * 60 * 60 * 1000;
  return Number.isFinite(timestamp) && timestamp >= threshold && timestamp <= now.getTime();
}

function rate(attempts: Attempt[]) {
  if (!attempts.length) return null;
  return Math.round((attempts.filter((attempt) => isCorrect(attempt.result)).length / attempts.length) * 100);
}

function boardTrend(attempts: Attempt[]) {
  if (attempts.length < MIN_RELIABLE_ATTEMPTS) return null;
  const ordered = [...attempts].sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
  const split = Math.floor(ordered.length / 2);
  const earlier = rate(ordered.slice(0, split)) ?? 0;
  const later = rate(ordered.slice(split)) ?? 0;
  if (later - earlier >= 8) return "up" as const;
  if (earlier - later >= 8) return "down" as const;
  return "stable" as const;
}

/**
 * 由已保存的错题、复盘和知识资料生成确定性学习洞察。
 * 缺少错题关联的复盘会被忽略，避免把孤立记录归入错误板块。
 */
export function deriveLearningInsightSnapshot({
  attempts,
  knowledgeEntries,
  mistakes,
  now,
  range,
}: {
  attempts: Attempt[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  now: Date;
  range: LearningInsightRange;
}): LearningInsightSnapshot {
  const mistakeById = new Map(mistakes.map((mistake) => [mistake.id, mistake]));
  const validAttempts = attempts.filter((attempt) => mistakeById.has(attempt.mistakeId) && inRange(attempt.reviewedAt, range, now));
  const attemptsByBoard = new Map<string, Attempt[]>();
  for (const attempt of validAttempts) {
    const board = mistakeById.get(attempt.mistakeId)?.board;
    if (!board) continue;
    attemptsByBoard.set(board, [...(attemptsByBoard.get(board) ?? []), attempt]);
  }

  const mistakesByBoard = new Map<string, Mistake[]>();
  for (const mistake of mistakes) {
    mistakesByBoard.set(mistake.board, [...(mistakesByBoard.get(mistake.board) ?? []), mistake]);
  }
  const boards = [...new Set([...mistakesByBoard.keys(), ...attemptsByBoard.keys()])].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const today = now.toISOString().slice(0, 10);
  const rows = boards.map<LearningInsightBoardRow>((board) => {
    const boardAttempts = attemptsByBoard.get(board) ?? [];
    const boardMistakes = mistakesByBoard.get(board) ?? [];
    return {
      board,
      reviewed: boardAttempts.length,
      correctRate: rate(boardAttempts),
      mastery: boardMistakes.length
        ? Math.round((boardMistakes.reduce((sum, mistake) => sum + mistake.mastery, 0) / boardMistakes.length) * 10) / 10
        : null,
      dueCount: boardMistakes.filter((mistake) => mistake.nextReviewAt <= today).length,
      sufficient: boardAttempts.length >= MIN_RELIABLE_ATTEMPTS,
      trend: boardTrend(boardAttempts),
    };
  });

  const trendByDate = new Map<string, Attempt[]>();
  for (const attempt of validAttempts) {
    const date = attempt.reviewedAt.slice(0, 10);
    trendByDate.set(date, [...(trendByDate.get(date) ?? []), attempt]);
  }
  const trend = [...trendByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<LearningInsightTrendPoint>(([date, dateAttempts]) => ({
      date,
      reviewed: dateAttempts.length,
      correct: dateAttempts.filter((attempt) => isCorrect(attempt.result)).length,
      correctRate: rate(dateAttempts) ?? 0,
    }));

  return {
    range,
    attemptsCount: validAttempts.length,
    correctRate: rate(validAttempts),
    dueCount: mistakes.filter((mistake) => mistake.nextReviewAt <= today).length
      + knowledgeEntries.filter((entry) => entry.nextReviewAt <= today).length,
    insufficientBoards: rows.filter((row) => !row.sufficient).length,
    trend,
    boards: rows,
    priorityMistakes: [...mistakes]
      .sort((left, right) => left.mastery - right.mastery || left.nextReviewAt.localeCompare(right.nextReviewAt))
      .slice(0, 5),
    priorityKnowledge: [...knowledgeEntries]
      .sort((left, right) => left.mastery - right.mastery || left.nextReviewAt.localeCompare(right.nextReviewAt))
      .slice(0, 4),
  };
}
