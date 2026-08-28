/** 交互式浮层打开时通知短暂 hover/info 层收起。仅是 DOM 事件信号，不承载业务状态。 */
export const INTERACTIVE_OVERLAY_OPEN_EVENT = "workspace:interactive-overlay-open";

export function announceInteractiveOverlayOpen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INTERACTIVE_OVERLAY_OPEN_EVENT));
}
