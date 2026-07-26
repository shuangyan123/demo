import { normalizeFenbiDraft, type FenbiDraftInput } from "../../services/fenbi-parser.ts";
import type { FenbiSyncScope } from "../../types/domains/fenbi-import.ts";
import type { ImportDraft } from "../../types/domains/import.ts";

const FENBI_ORIGIN = "https://tiku.fenbi.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

export type FenbiImportErrorCode = "invalid_cookie" | "rate_limited" | "upstream_unavailable" | "malformed_response";

/** 粉笔实验接口错误；仅保留稳定分类和脱敏消息。 */
export class FenbiAccountImportError extends Error {
  readonly code: FenbiImportErrorCode;
  readonly status: number;

  constructor(code: FenbiImportErrorCode, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "FenbiAccountImportError";
  }
}

type AdapterOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayAt(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  const nested = value.data;
  return nested === value ? [] : arrayAt(nested, keys);
}

function numericAt(value: unknown, keys: string[]): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const numberValue = Number(value[key]);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return numericAt(value.data, keys);
}

function stringAt(value: unknown, keys: string[]): string {
  if (!isRecord(value)) return "";
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate).trim();
  }
  return "";
}

function stripHtml(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function optionTexts(value: unknown): string[] {
  const options = arrayAt(value, ["options", "choices", "items"]);
  return options.map((option, index) => {
    if (typeof option === "string") return stripHtml(option);
    const label = stringAt(option, ["key", "label", "name"]) || String.fromCharCode(65 + index);
    const text = stringAt(option, ["value", "text", "content", "title"]);
    return stripHtml(`${label}. ${text}`);
  }).filter(Boolean);
}

function sourceIdOf(value: unknown): string {
  if (!isRecord(value)) return "";
  return stringAt(value, ["questionId", "question_id", "id", "exerciseId"])
    || stringAt(value.question, ["id", "questionId"]);
}

function toDraftInput(question: unknown, solution: unknown): FenbiDraftInput {
  const questionRecord = isRecord(question) && isRecord(question.question) ? question.question : question;
  const solutionRecord = isRecord(solution) && isRecord(solution.solution) ? solution.solution : solution;
  const sourceId = sourceIdOf(question) || sourceIdOf(solution);
  return {
    sourceId,
    board: stringAt(question, ["keypointName", "categoryName", "subjectName", "board"])
      || stringAt(solution, ["keypointName", "categoryName", "subjectName", "board"]),
    source: "粉笔账户同步",
    stem: stripHtml(stringAt(questionRecord, ["stem", "content", "text", "question", "title"])),
    options: optionTexts(questionRecord),
    answer: stringAt(solutionRecord, ["answer", "correctAnswer", "correct_answer"]),
    myAnswer: stringAt(question, ["userAnswer", "myAnswer", "answer"]),
    explanation: stripHtml(stringAt(solutionRecord, ["analysis", "explanation", "solution", "content"])),
    reasons: [],
    tags: ["粉笔同步"],
    confidence: 0.9,
  };
}

function classifyResponse(status: number): FenbiAccountImportError {
  if (status === 401 || status === 403) return new FenbiAccountImportError("invalid_cookie", "粉笔会话已失效，请重新粘贴 Cookie。", 401);
  if (status === 429) return new FenbiAccountImportError("rate_limited", "粉笔请求过于频繁，请稍后重试。", 429);
  return new FenbiAccountImportError("upstream_unavailable", "粉笔服务暂时不可用，请稍后重试或使用导出文件。", 502);
}

/** 只允许访问固定粉笔题库域名和已登记路径，禁止把请求变成任意 URL 代理。 */
export class FenbiAccountImportAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: AdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private async getJson(path: string, cookie: string, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith("/api/xingce/")) throw new FenbiAccountImportError("malformed_response", "粉笔接口路径不在允许范围内。", 400);
    const response = await this.fetchImpl(new URL(path, FENBI_ORIGIN), {
      method: "GET",
      headers: { Accept: "application/json", Cookie: cookie },
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (!response.ok) throw classifyResponse(response.status);
    try {
      return await response.json();
    } catch {
      throw new FenbiAccountImportError("malformed_response", "粉笔返回格式已变化，请改用 PDF/Word 导出。", 502);
    }
  }

  async validate(cookie: string, signal?: AbortSignal): Promise<void> {
    if (!cookie.trim() || cookie.length > 16_384) throw new FenbiAccountImportError("invalid_cookie", "请输入有效的粉笔 Cookie。", 400);
    const payload = await this.getJson("/api/xingce/errors/keypoint-tree", cookie, signal);
    if (!Array.isArray(payload) && !isRecord(payload)) throw new FenbiAccountImportError("malformed_response", "粉笔目录格式已变化，请改用导出文件。", 502);
  }

  async sync(
    cookie: string,
    scope: FenbiSyncScope,
    onEvent: (event: { stage?: "validate" | "catalog" | "questions" | "normalize"; completed?: number; total?: number }) => void,
    signal?: AbortSignal,
  ): Promise<ImportDraft[]> {
    onEvent({ stage: "validate" });
    await this.validate(cookie, signal);
    onEvent({ stage: "catalog" });
    await this.getJson("/api/xingce/errors/keypoint-tree", cookie, signal);

    const questions: unknown[] = [];
    let total: number | undefined;
    onEvent({ stage: "questions" });
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
      if (scope.keypointIds?.length) query.set("keypointIds", scope.keypointIds.join(","));
      if (scope.sinceDays) query.set("sinceDays", String(scope.sinceDays));
      const payload = await this.getJson(`/api/xingce/errors?${query}`, cookie, signal);
      const pageItems = arrayAt(payload, ["items", "list", "errors", "results"]);
      if (!pageItems.length && page === 0 && numericAt(payload, ["total", "count"]) !== 0) {
        throw new FenbiAccountImportError("malformed_response", "粉笔错题列表格式已变化，请改用导出文件。", 502);
      }
      total = numericAt(payload, ["total", "count"]) ?? total;
      questions.push(...pageItems);
      onEvent({ completed: questions.length, total });
      if (pageItems.length < PAGE_SIZE || (total !== undefined && questions.length >= total)) break;
      await this.sleep(300);
    }

    onEvent({ stage: "normalize" });
    const chunks: string[][] = [];
    const ids = questions.map(sourceIdOf).filter(Boolean);
    for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
    const solutions = new Map<string, unknown>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        const payload = await this.getJson(`/api/xingce/solutions?ids=${encodeURIComponent(chunk.join(","))}`, cookie, signal);
        for (const item of arrayAt(payload, ["items", "list", "solutions", "results"])) {
          const id = sourceIdOf(item);
          if (id) solutions.set(id, item);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, () => worker()));

    return questions.map((question) => normalizeFenbiDraft(toDraftInput(question, solutions.get(sourceIdOf(question))))).filter((draft) => draft.stem.trim());
  }
}
