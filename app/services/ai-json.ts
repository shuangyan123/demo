export type AiJsonShape = "value" | "object" | "array";

function fencedJson(content: string): string | null {
  return content.trim().match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? null;
}

function sliceJson(content: string, open: string, close: string): string {
  const start = content.indexOf(open);
  const end = content.lastIndexOf(close);
  return start >= 0 && end >= start ? content.slice(start, end + 1).trim() : content.trim();
}

/** 提取 AI 返回中的 JSON 主体，兼容 markdown fence、对象前后解释文本和数组前后解释文本。 */
export function extractAiJsonText(content: string, shape: AiJsonShape = "value"): string {
  const candidate = fencedJson(content) ?? content.trim();
  if (shape === "object") return sliceJson(candidate, "{", "}");
  if (shape === "array") return sliceJson(candidate, "[", "]");
  return candidate;
}

/** 解析 AI JSON，并把底层 JSON.parse 错误转换成稳定、可展示的业务错误。 */
export function parseAiJsonValue<T>(content: string, shape: AiJsonShape = "value", message = "AI 返回不是有效 JSON"): T {
  const jsonText = extractAiJsonText(content, shape);
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    throw new Error(message);
  }
}

export function parseAiJsonObject(content: string, message = "AI 返回不是有效 JSON 对象"): Record<string, unknown> {
  const parsed = parseAiJsonValue<unknown>(content, "object", message);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(message);
  return parsed as Record<string, unknown>;
}

export function parseAiJsonArray<T = unknown>(content: string, message = "AI 返回不是有效 JSON 数组"): T[] {
  const parsed = parseAiJsonValue<unknown>(content, "array", message);
  if (!Array.isArray(parsed)) throw new Error(message);
  return parsed as T[];
}
