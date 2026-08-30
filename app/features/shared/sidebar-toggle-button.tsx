import type { Ref } from "react";
import { AppIcon } from "./app-icon";
import { UiHint } from "./ui-tooltip";
import type { UiOverlayPlacement } from "./ui-overlay-position";

// 渲染左上角侧栏切换按钮，使用按钮语义让键盘和屏幕阅读器都能识别当前折叠状态。
export function SidebarToggleButton({
  buttonRef,
  collapsed,
  onToggle,
  placement = "right",
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  collapsed: boolean;
  onToggle: () => void;
  placement?: UiOverlayPlacement | readonly UiOverlayPlacement[];
}) {
  const label = collapsed ? "展开侧边栏" : "收起侧边栏";
  return <UiHint label={label} placement={placement}>{({ describedBy }) => (
    <button
      ref={buttonRef}
      className="sidebar-toggle-button grid h-7 w-7 place-items-center rounded-lg border border-line text-muted hover:bg-chrome-hover hover:text-foreground max-lg:h-11 max-lg:w-11"
      type="button"
      aria-describedby={describedBy}
      aria-label={label}
      aria-pressed={collapsed}
      onClick={onToggle}
    >
      <AppIcon name="sidebar" size={18} />
    </button>
  )}</UiHint>;
}
