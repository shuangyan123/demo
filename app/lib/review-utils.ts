import { BOARD_OPTIONS, type Attempt, type Board, type ImportDraft, type Mistake, type ReviewResult } from "../types/review.ts";

// 生成应用内统一使用的“今天”，固定到上午 8 点避免时区边界抖动。
export function makeToday(): Date {
  const date = new Date();
  date.setHours(8, 0, 0, 0);
  return date;
}

// 将 Date 转为数据库里存储和比较使用的 YYYY-MM-DD。
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// 基于今天计算相对天数后的日期字符串。
export function relativeDate(today: Date, days: number): string {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

// 把 YYYY-MM-DD 简化成列表里使用的 M/D 格式。
export function formatShortDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// 判断错题是否已经到达本轮复盘日期。
export function isDue(item: Mistake, today: Date): boolean {
  return item.nextReviewAt <= toISODate(today);
}

// 将掌握度数字转换为用户可读状态。
export function masteryLabel(value: number): string {
  if (value <= 2) return "薄弱";
  if (value <= 3) return "巩固中";
  return "较稳";
}

// 根据复盘结果计算新的掌握度和下次复盘日期。
export function nextStateAfterReview(
  mistake: Mistake,
  result: ReviewResult,
  today: Date,
): Pick<Mistake, "mastery" | "nextReviewAt" | "updatedAt"> {
  const delta = result === "correct" ? 1 : result === "wrong" ? -1 : 0;
  const mastery = Math.max(1, Math.min(5, mistake.mastery + delta));
  const interval = result === "correct" ? Math.max(2, mastery * 2) : result === "uncertain" ? 1 : 0;

  return {
    mastery,
    nextReviewAt: relativeDate(today, interval),
    updatedAt: toISODate(today),
  };
}

// 构造一条复盘尝试记录；durationSec 只记录用户确认提交时的真实用时。
export function buildAttempt(mistakeId: string, result: ReviewResult, confidence: number, today: Date, durationSec?: number): Attempt {
  return {
    id: crypto.randomUUID(),
    mistakeId,
    result,
    confidence,
    durationSec,
    reviewedAt: toISODate(today),
  };
}

// 将外部输入的板块名称归一到六大固定板块，无法判断时归入常识判断并标记需确认。
export function normalizeBoard(value: unknown): { board: Board; needsReview: boolean } {
  const text = String(value ?? "").trim();
  const exact = BOARD_OPTIONS.find((board) => board === text);
  if (exact) return { board: exact, needsReview: false };

  const fuzzy = BOARD_OPTIONS.find((board) => text.includes(board) || board.includes(text));
  if (fuzzy) return { board: fuzzy, needsReview: false };

  return { board: "常识判断", needsReview: true };
}

// 将导入草稿转换为 repository 可写入的错题输入结构。
export function draftToMistakeInput(draft: ImportDraft): Omit<Mistake, "id" | "createdAt" | "updatedAt"> {
  return {
    board: draft.board,
    source: draft.source || "导入",
    stem: draft.stem,
    answer: draft.answer || "待补充",
    explanation: draft.explanation || "待补充解析",
    reasons: draft.reasons.length ? draft.reasons : ["待归因"],
    tags: draft.tags,
    mastery: draft.mastery || 2,
    nextReviewAt: toISODate(makeToday()),
  };
}

// 按任意 key 统计数量，并按数量倒序返回。
export function countBy<T>(items: T[], getKey: (item: T) => string): Array<[string, number]> {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
