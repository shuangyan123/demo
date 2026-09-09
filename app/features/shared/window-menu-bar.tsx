import type { Ref, RefObject } from "react";
import { AppIcon } from "./app-icon";
import { ContextPanelToggleButton } from "./context-panel";
import { RecallBrandMark } from "./recall-brand-mark";
import { SidebarToggleButton } from "./sidebar-toggle-button";
import { SummaryPopover } from "./summary-popover";
import type { WorkspaceSummary } from "./workspace-context-types";
import { UiHint } from "./ui-tooltip";

export function WindowMenuBar({
  contextPanelId,
  contextPanelOpen,
  contextPanelTriggerRef,
  onBack,
  onToggleContextPanel,
  onToggleSidebar,
  sidebarButtonRef,
  sidebarCollapsed,
  summary,
  title = "Recall",
}: {
  contextPanelId: string;
  contextPanelOpen: boolean;
  contextPanelTriggerRef: RefObject<HTMLButtonElement | null>;
  onBack?: () => void;
  onToggleContextPanel: () => void;
  onToggleSidebar: () => void;
  sidebarButtonRef?: Ref<HTMLButtonElement>;
  sidebarCollapsed: boolean;
  summary: WorkspaceSummary;
  title?: string;
}) {
  return (
    <header className="chrome-topbar z-40 shrink-0 text-sm text-muted">
      <div className="chrome-topbar-safe-area flex h-full min-w-0 items-center gap-3 px-3">
        <SidebarToggleButton buttonRef={sidebarButtonRef} collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
        {onBack ? <UiHint label="返回" placement="bottom">{({ describedBy }) => <button
          aria-describedby={describedBy}
          aria-label="返回"
          className="chrome-titlebar-control hidden h-8 w-8 place-items-center rounded-lg transition hover:bg-settings-selected hover:text-foreground max-lg:inline-grid"
          type="button"
          onClick={onBack}
        ><AppIcon name="back" size={18} /></button>}</UiHint> : null}
        <RecallBrandMark />
        <span aria-label={`当前工作区：${title}`} className="chrome-section-title" data-section-title={title}>{title}</span>
        <span className="chrome-product-title" data-product-title={title} aria-hidden="true" />
        <div className="ml-auto flex min-w-0 flex-none items-center justify-end gap-1">
          <SummaryPopover summary={summary} />
          <ContextPanelToggleButton buttonRef={contextPanelTriggerRef} onToggle={onToggleContextPanel} open={contextPanelOpen} panelId={contextPanelId} />
        </div>
      </div>
    </header>
  );
}
