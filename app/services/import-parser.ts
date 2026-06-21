import { BOARD_OPTIONS, type ImportDraft, type ImportDraftIssue } from "../types/review";
import { normalizeBoard } from "../lib/review-utils";

type DraftInput = {
  board?: unknown;
  source?: unknown;
  stem?: unknown;
  answer?: unknown;
  explanation?: unknown;
  reasons?: unknown;
  tags?: unknown;
  mastery?: unknown;
  confidence?: unknown;
};

// 将 AI 或本地解析得到的错因、标签字段统一整理为数组。
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[,，;；、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 将任意来源的解析结果规范化为可编辑导入草稿。
export function normalizeDraft(input: DraftInput): ImportDraft {
  const boardResult = normalizeBoard(input.board);
  const issues = new Set<ImportDraftIssue>();
  if (boardResult.needsReview) issues.add("unknown_board");
  if (!input.answer) issues.add("missing_answer");
  if (typeof input.confidence === "number" && input.confidence < 0.7) issues.add("low_confidence");
  return {
    id: crypto.randomUUID(),
    selected: true,
    needsReview: boardResult.needsReview || !input.answer || !input.explanation || issues.size > 0,
    issues: Array.from(issues),
    board: boardResult.board,
    source: String(input.source ?? "粉笔导入").trim() || "粉笔导入",
    stem: String(input.stem ?? "").trim(),
    options: [],
    answer: String(input.answer ?? "").trim(),
    myAnswer: "",
    explanation: String(input.explanation ?? "").trim(),
    reasons: asList(input.reasons).length ? asList(input.reasons) : ["待归因"],
    tags: asList(input.tags),
    mastery: Number(input.mastery || 2),
    confidence: typeof input.confidence === "number" ? input.confidence : undefined,
  };
}

// 解析粘贴文本，支持用空行分隔多题和中文字段标签。
export function parsePlainText(rawText: string): ImportDraft[] {
  const blocks = rawText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const data: Record<string, string> = {};
      for (const line of block.split(/\n/)) {
        const match = line.match(/^(板块|科目|模块|来源|题干|答案|解析|错因|标签|掌握度)[:：]\s*(.*)$/);
        if (match) data[match[1]] = match[2];
      }

      if (!data["题干"]) {
        data["题干"] = block;
      }

      return normalizeDraft({
        board: data["板块"] || data["科目"] || data["模块"],
        source: data["来源"],
        stem: data["题干"],
        answer: data["答案"],
        explanation: data["解析"],
        reasons: data["错因"],
        tags: data["标签"],
        mastery: Number(data["掌握度"] || 2),
      });
    })
    .filter((draft) => draft.stem);
}

// 按最小 CSV 规则拆分一行，支持双引号包裹的逗号。
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

// 解析 CSV 文件，兼容中英文字段名。
export function parseCsv(rawText: string): ImportDraft[] {
  const lines = rawText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return parsePlainText(rawText);
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  // 根据字段名查找列索引，保持多语言表头兼容。
  const mapKey = (key: string) => headers.indexOf(key.toLowerCase());
  // 按候选字段名读取单元格内容。
  const valueAt = (cells: string[], keys: string[]) => {
    for (const key of keys) {
      const index = mapKey(key);
      if (index >= 0) return cells[index];
    }
    return "";
  };

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return normalizeDraft({
      board: valueAt(cells, ["board", "板块", "科目", "模块"]),
      source: valueAt(cells, ["source", "来源"]),
      stem: valueAt(cells, ["stem", "题干", "题目"]),
      answer: valueAt(cells, ["answer", "答案"]),
      explanation: valueAt(cells, ["explanation", "解析"]),
      reasons: valueAt(cells, ["reasons", "错因"]),
      tags: valueAt(cells, ["tags", "标签"]),
      mastery: Number(valueAt(cells, ["mastery", "掌握度"]) || 2),
    });
  }).filter((draft) => draft.stem);
}

// 解析 JSON 文件，支持单条对象或数组。
export function parseJson(rawText: string): ImportDraft[] {
  const parsed = JSON.parse(rawText) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => normalizeDraft(item as DraftInput)).filter((draft) => draft.stem);
}

// 解析 AI 返回的 JSON 文本，兼容模型偶尔包裹的 markdown 代码块。
export function parseAiJson(content: string): ImportDraft[] {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { items?: DraftInput[] } | DraftInput[];
  const items = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  return items.map(normalizeDraft).filter((draft) => draft.stem);
}

export const boardInstruction: string = BOARD_OPTIONS.join("、");
