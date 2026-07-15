/**
 * 归一化 Gemini API 根地址，兼容用户误填 /models 或完整 generateContent endpoint。
 * 保留自定义代理在版本号之前的路径，只移除 Google 模型接口后缀。
 */
export function normalizeGoogleApiBaseUrl(value: string): string {
  const withoutQuery = value.trim().replace(/[?#].*$/, "");
  return withoutQuery
    .replace(/\/models(?:\/[^/]+)?(?::(?:streamGenerateContent|generateContent))?$/i, "")
    .replace(/\/models$/i, "")
    .replace(/\/+$/, "");
}

/**
 * 将 GenerateContent 根地址转换为 Interactions API 根地址。
 * 仅修正 Google 官方主机，避免擅自改写自定义代理的版本与路由前缀。
 */
export function normalizeGoogleInteractionsBaseUrl(value: string): string {
  const normalized = normalizeGoogleApiBaseUrl(value);
  try {
    const url = new URL(normalized);
    if (url.hostname === "generativelanguage.googleapis.com") {
      return `${url.origin}/v1beta`;
    }
  } catch {
    // 非绝对地址交由自定义代理原样处理，最终网络错误由统一诊断层归类。
  }
  return normalized;
}
