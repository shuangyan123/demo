"use client";

import { UiPopover } from "./ui-popover";
import { AppIcon } from "./app-icon";
import { UiHint } from "./ui-tooltip";
import type { WorkspaceSummary } from "./workspace-context-types";

type SummaryPopoverProps = {
  summary: WorkspaceSummary;
};

type SummaryRow = {
  label: string;
  value: string;
};

function summaryRows(summary: WorkspaceSummary): SummaryRow[] {
  const rows: Array<SummaryRow | undefined> = [
    summary.sectionLabel ? { label: "当前分区", value: summary.sectionLabel } : undefined,
    summary.conversationTitle ? { label: "当前对话", value: summary.conversationTitle } : undefined,
    summary.modelLabel ? { label: "当前模型", value: summary.modelLabel } : undefined,
    summary.projectLabel ? { label: "项目", value: summary.projectLabel } : undefined,
    typeof summary.attachedContextCount === "number"
      ? { label: "附加资料", value: `${summary.attachedContextCount} 项` }
      : undefined,
    summary.statusLabel ? { label: "本地状态", value: summary.statusLabel } : undefined,
  ];
  return rows.filter((row): row is SummaryRow => Boolean(row));
}

/** 顶栏紧凑只读摘要；操作、长列表和未来集成统一留给 ContextPanel。 */
export function SummaryPopover({ summary }: SummaryPopoverProps) {
  const rows = summaryRows(summary);
  const content = (
    <div className="grid gap-3" data-summary-popover-surface="true">
      <div className="grid gap-1 border-b pb-2" style={{ borderColor: "var(--chrome-context-popover-outline)" }}>
        <span className="text-xs" style={{ color: "var(--chrome-context-popover-muted)" }}>当前上下文</span>
        <strong className="text-sm font-bold">{summary.workspaceLabel}</strong>
      </div>
      <dl className="m-0 grid gap-1">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-3 py-1">
            <dt className="text-xs" style={{ color: "var(--chrome-context-popover-muted)" }}>{row.label}</dt>
            <dd className="truncate text-xs font-semibold" title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <UiPopover
      content={content}
      contentClassName="workspace-context-popover"
      contentLabel="当前工作区摘要"
      placement="bottom-end"
    >
      {({ contentId, expanded, toggle, triggerRef }) => (
        <UiHint label="当前工作区摘要" placement="bottom">
          {({ describedBy }) => (
            <button
              ref={triggerRef}
              aria-controls={expanded ? contentId : undefined}
              aria-describedby={describedBy}
              aria-expanded={expanded}
              aria-haspopup="dialog"
              aria-label="查看当前工作区摘要"
              className={`workspace-summary-trigger sidebar-toggle-button grid h-7 w-7 place-items-center rounded-lg border border-line text-muted hover:bg-chrome-hover hover:text-foreground max-lg:h-11 max-lg:w-11 ${expanded ? "bg-chrome-selected text-foreground" : ""}`}
              data-summary-popover-trigger={expanded ? "true" : undefined}
              type="button"
              onClick={toggle}
            >
              <AppIcon name="info" size={18} />
            </button>
          )}
        </UiHint>
      )}
    </UiPopover>
  );
}
