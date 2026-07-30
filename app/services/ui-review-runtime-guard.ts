const UI_REVIEW_RUNTIME_KEY = "review-workspace:ui-review-active";

/** UI 审查数据启用时，统一阻止会产生外部副作用的运行路径。 */
export function setUiReviewRuntimeActive(active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (active) window.localStorage.setItem(UI_REVIEW_RUNTIME_KEY, "1");
    else window.localStorage.removeItem(UI_REVIEW_RUNTIME_KEY);
  } catch {
    // 隐私模式可能禁用 localStorage；页面内调用仍由 React 上下文拦截。
  }
}

export function isUiReviewRuntimeActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(UI_REVIEW_RUNTIME_KEY) === "1";
  } catch {
    return false;
  }
}
