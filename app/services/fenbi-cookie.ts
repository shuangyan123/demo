const MAX_FENBI_COOKIE_LENGTH = 16_384;
const FORBIDDEN_COOKIE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** 同时接受纯 Cookie 与 `Cookie:` 请求头；只做确定性规范化，不记录原值。 */
export function normalizeFenbiCookie(input: string): string {
  const unfolded = input.trim().replace(/\r?\n[ \t]*/g, "");
  const withoutPrefix = unfolded.replace(/^cookie\s*:\s*/i, "").trim();
  if (!withoutPrefix) throw new Error("请输入有效的粉笔 Cookie。");
  if (withoutPrefix.length > MAX_FENBI_COOKIE_LENGTH) throw new Error("粉笔 Cookie 超过长度上限。");
  if (FORBIDDEN_COOKIE_CONTROL.test(withoutPrefix)) throw new Error("粉笔 Cookie 包含不允许的控制字符。");
  return withoutPrefix;
}
