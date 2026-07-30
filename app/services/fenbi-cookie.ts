const MAX_FENBI_COOKIE_LENGTH = 16_384;
const FORBIDDEN_COOKIE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function cookieFromCurl(input: string): string | undefined {
  const flattened = input.replace(/\\\r?\n/g, " ");
  const headerPattern = /(?:^|\s)(?:-H|--header)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
  for (const match of flattened.matchAll(headerPattern)) {
    const header = match[1] ?? match[2] ?? match[3] ?? "";
    if (/^cookie\s*:/i.test(header)) return header.replace(/^cookie\s*:\s*/i, "");
  }
  const cookiePattern = /(?:^|\s)(?:-b|--cookie)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/i;
  const cookieMatch = flattened.match(cookiePattern);
  return cookieMatch ? unquote(cookieMatch[1] ?? cookieMatch[2] ?? cookieMatch[3] ?? "") : undefined;
}

function cookieFromHeaderBlock(input: string): string | undefined {
  const lines = input.split(/\r?\n/);
  const index = lines.findIndex((line) => /^cookie\s*:/i.test(line.trim()));
  if (index < 0) return undefined;
  const parts = [lines[index].trim().replace(/^cookie\s*:\s*/i, "")];
  for (let cursor = index + 1; cursor < lines.length && /^[ \t]/.test(lines[cursor]); cursor += 1) {
    parts.push(lines[cursor].trim());
  }
  return parts.join("");
}

/**
 * 接受纯 Cookie、完整 Cookie 请求头或 Copy as cURL。
 * 只提取 Cookie 值，URL、命令和其他请求头会被丢弃。
 */
export function normalizeFenbiCookie(input: string): string {
  const trimmed = input.trim();
  const extracted = /\bcurl\b/i.test(trimmed)
    ? cookieFromCurl(trimmed)
    : cookieFromHeaderBlock(trimmed) ?? trimmed.replace(/^cookie\s*:\s*/i, "");
  const normalized = unquote(extracted ?? "").trim().replace(/\r?\n[ \t]*/g, "");
  if (!normalized || !normalized.includes("=")) {
    throw new Error(/\bcurl\b/i.test(trimmed)
      ? "未在 Copy as cURL 内容中找到 Cookie 请求头。"
      : "请输入有效的粉笔 Cookie。");
  }
  if (normalized.length > MAX_FENBI_COOKIE_LENGTH) throw new Error("粉笔 Cookie 超过长度上限。");
  if (FORBIDDEN_COOKIE_CONTROL.test(normalized)) throw new Error("粉笔 Cookie 包含不允许的控制字符。");
  return normalized;
}
