import { splitInput } from "../lib/form-utils.ts";
import { normalizeBoard } from "../lib/review-utils.ts";
import { BOARD_OPTIONS, type Board } from "../types/domains/review.ts";
import type { ImportDraft, ImportDraftIssue } from "../types/domains/import.ts";
import { parseAiJsonValue } from "./ai-json.ts";
import { normalizeDraft, parseAiJson, parseCsv, parseJson, parsePlainText } from "./import-parser.ts";

export type FenbiDraftInput = {
  id?: unknown;
  sourceId?: unknown;
  board?: unknown;
  source?: unknown;
  stem?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  correctAnswer?: unknown;
  myAnswer?: unknown;
  explanation?: unknown;
  reasons?: unknown;
  tags?: unknown;
  mastery?: unknown;
  confidence?: unknown;
};

export const fenbiBoardInstruction = BOARD_OPTIONS.join("、");

// 构造粉笔错题结构化提示词，要求模型只返回 JSON，避免夹杂说明导致解析失败。
export function buildFenbiSystemPrompt(): string {
  return `你是粉笔错题 OCR 与结构化助手。请把用户提供的粉笔错题、截图 OCR 文本或导出内容解析为 JSON。板块只能从以下六个中选择：${fenbiBoardInstruction}。如果无法判断板块，用“常识判断”并让 confidence 低于 0.7。只返回 JSON，不要解释。格式：{"items":[{"board":"","stem":"","options":["A ...","B ..."],"answer":"","myAnswer":"","explanation":"","reasons":[],"tags":[],"source":"粉笔导入","confidence":0.8}]}`;
}

// 将 AI 或本地解析出的粉笔字段整理成当前应用的导入草稿。
export function normalizeFenbiDraft(input: FenbiDraftInput): ImportDraft {
  const boardResult = normalizeBoard(input.board);
  const options = Array.isArray(input.options) ? input.options.map(String).map((item) => item.trim()).filter(Boolean) : splitInput(String(input.options ?? ""));
  const confidence = typeof input.confidence === "number" ? input.confidence : undefined;
  const draft = normalizeDraft({
    board: boardResult.board,
    source: input.source ?? "粉笔导入",
    stem: input.stem ?? input.question,
    answer: input.answer ?? input.correctAnswer,
    explanation: input.explanation,
    reasons: input.reasons,
    tags: input.tags,
    mastery: input.mastery,
    confidence,
  });
  const issues = new Set<ImportDraftIssue>(draft.issues ?? []);
  if (boardResult.needsReview) issues.add("unknown_board");
  if (!draft.answer.trim()) issues.add("missing_answer");
  if (typeof confidence === "number" && confidence < 0.7) issues.add("low_confidence");

  return {
    ...draft,
    sourceId: String(input.sourceId ?? input.id ?? "").trim() || undefined,
    board: boardResult.board as Board,
    options,
    myAnswer: String(input.myAnswer ?? "").trim(),
    issues: Array.from(issues),
    needsReview: draft.needsReview || issues.size > 0,
  };
}

// 解析 AI 返回的粉笔 JSON，兼容 items 包裹和直接数组两种输出。
export function parseFenbiAiJson(content: string): ImportDraft[] {
  try {
    const parsed = parseAiJsonValue<{ items?: FenbiDraftInput[] } | FenbiDraftInput[]>(content);
    const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    return items.map(normalizeFenbiDraft).filter((draft) => draft.stem);
  } catch {
    return parseAiJson(content);
  }
}

// 根据文件扩展名选择本地解析器，粉笔字段最终统一进入 normalizeFenbiDraft。
export function parseFenbiTextByName(rawText: string, fileName: string): ImportDraft[] {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".json")) return parseJson(rawText).map((draft) => normalizeFenbiDraft(draft));
  if (lowerName.endsWith(".csv")) return parseCsv(rawText).map((draft) => normalizeFenbiDraft(draft));
  return parsePlainText(rawText).map((draft) => normalizeFenbiDraft(draft));
}
