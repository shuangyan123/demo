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

/** 将 GenerateContent 版本根地址转换为 Interactions API 的 v1beta2 根地址。 */
export function normalizeGoogleInteractionsBaseUrl(value: string): string {
  const normalized = normalizeGoogleApiBaseUrl(value);
  return normalized.replace(/\/(?:v1beta2|v1beta|v1)$/i, "/v1beta2");
}
