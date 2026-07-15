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
