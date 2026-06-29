"use client";

import type { ReactNode } from "react";
import { toISODate } from "../../lib/review-utils";
import type { Board, ViewKey } from "../../types/review";
import type { BoardStat } from "../../lib/review-selectors";
import { Button } from "../shared/ui-primitives";
import { SidebarNav, ViewHeader, WorkspaceShell } from "../shared/workspace-shell";

type ReviewNavIconName =
  | "dashboard"
  | "library"
  | "review"
  | "knowledgeTraining"
  | "stats"
  | "knowledge"
  | "automation"
  | "interview"
  | "tutoring"
  | "import"
  | "entry"
  | "settings";

type ReviewWorkspaceShellProps = {
  automationUnreadCount: number;
  boardStats: BoardStat[];
  children: ReactNode;
  notice: string;
  selectedBoard: Board | null;
  sidebarCollapsed: boolean;
  today: Date;
  view: ViewKey;
  onOpenBoard: (board: Board) => void;
  onOpenEntry: () => void;
  onOpenImport: () => void;
  onOpenSettings: () => void;
  onSelectView: (view: ViewKey) => void;
  onToggleSidebar: () => void;
};

const navItems: Array<{ key: ViewKey; label: string; icon: ReviewNavIconName }> = [
  { key: "dashboard", label: "总览", icon: "dashboard" },
  { key: "library", label: "错题库", icon: "library" },
  { key: "review", label: "开始复盘", icon: "review" },
  { key: "knowledge", label: "知识库", icon: "knowledge" },
  { key: "knowledgeTraining", label: "知识训练", icon: "knowledgeTraining" },
  { key: "automation", label: "自动化", icon: "automation" },
  { key: "interview", label: "面试训练", icon: "interview" },
  { key: "tutoring", label: "AI 辅导", icon: "tutoring" },
  { key: "stats", label: "薄弱分析", icon: "stats" },
  { key: "import", label: "导入", icon: "import" },
  { key: "entry", label: "手动录入", icon: "entry" },
];

const viewTitles: Record<ViewKey, string> = {
  dashboard: "总览",
  library: "错题库",
  review: "开始复盘",
  knowledgeTraining: "知识训练",
  interview: "面试训练",
  tutoring: "AI 辅导",
  stats: "薄弱分析",
  knowledge: "知识库",
  automation: "自动化",
  import: "导入",
  entry: "手动录入",
  settings: "设置",
};

/** 渲染复盘应用的稳定壳层，业务模块只向这里传入导航状态和页面内容。 */
export function ReviewWorkspaceShell({
  automationUnreadCount,
  boardStats,
  children,
  notice,
  selectedBoard,
  sidebarCollapsed,
  today,
  view,
  onOpenBoard,
  onOpenEntry,
  onOpenImport,
  onOpenSettings,
  onSelectView,
  onToggleSidebar,
}: ReviewWorkspaceShellProps) {
  return (
    <WorkspaceShell
      contentClassName="px-7 py-7 max-sm:px-4"
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName="flex flex-col overflow-hidden px-3 py-4 text-app-sidebar-text max-lg:overflow-visible max-lg:px-3 max-lg:py-2"
      title="错题复盘"
      onToggleSidebar={onToggleSidebar}
      sidebar={
        <>
          <SidebarNav
            activeKey={view}
            items={navItems.map((item) => item.key === "automation" ? { ...item, badge: automationUnreadCount || undefined } : item)}
            renderIcon={(icon) => <ReviewNavIcon name={icon as ReviewNavIconName} />}
            onSelect={onSelectView}
          />
          <button
            className="hidden min-h-10 min-w-36 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-chrome-hover max-lg:grid"
            type="button"
            onClick={onOpenSettings}
          >
            <ReviewNavIcon name="settings" />
            <span>设置</span>
          </button>

          <section className="mt-8 min-h-0 flex-1 overflow-y-auto pr-1 max-lg:hidden" aria-label="板块快捷入口">
            <p className="mb-2 px-3 text-xs font-medium text-muted">板块</p>
            <div className="grid gap-1">
              {boardStats.map((stat) => (
                <button
                  key={stat.board}
                  className={`grid min-h-10 grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-3 text-left text-sm ${
                    selectedBoard === stat.board ? "bg-chrome-selected" : "hover:bg-chrome-hover"
                  }`}
                  type="button"
                  onClick={() => onOpenBoard(stat.board)}
                >
                  <span className="truncate">{stat.board}</span>
                  <span className="text-sm text-muted">{stat.total}</span>
                </button>
              ))}
            </div>
          </section>

          <button
            className="relative z-40 mt-3 grid min-h-10 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-chrome-hover max-lg:hidden"
            type="button"
            onClick={onOpenSettings}
          >
            <ReviewNavIcon name="settings" />
            <span>设置</span>
          </button>
        </>
      }
    >
      <ViewHeader
        actions={
          <>
            <Button variant="outline" onClick={onOpenImport}>
              导入
            </Button>
            <Button variant="primary" onClick={onOpenEntry}>
              手动录入
            </Button>
          </>
        }
        eyebrow={`${toISODate(today)} · ${notice}`}
        title={viewTitles[view]}
      />
      {children}
    </WorkspaceShell>
  );
}

/** 渲染侧边栏线性图标，避免为少量导航图标额外引入依赖。 */
function ReviewNavIcon({ name }: { name: ReviewNavIconName }) {
  const common = {
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    viewBox: "0 0 24 24",
  };

  if (name === "dashboard") {
    return (
      <svg aria-hidden="true" {...common}>
        <rect height="7" rx="1.8" width="7" x="3" y="3" />
        <rect height="7" rx="1.8" width="7" x="14" y="3" />
        <rect height="7" rx="1.8" width="7" x="3" y="14" />
        <rect height="7" rx="1.8" width="7" x="14" y="14" />
      </svg>
    );
  }

  if (name === "library") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 5.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3Z" />
        <path d="M8 4h9a2 2 0 0 1 2 2v12" />
        <path d="M8 9h8" />
        <path d="M8 13h6" />
      </svg>
    );
  }

  if (name === "knowledge") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10.5v16H7a2.5 2.5 0 0 0-2.5 2.5Z" />
        <path d="M8 7h6.5" />
        <path d="M8 10.5h7.5" />
        <path d="m16.5 5.5 1 1 1.8-2.5" />
      </svg>
    );
  }

  if (name === "knowledgeTraining") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 4.5h10.5a2.5 2.5 0 0 1 2.5 2.5v13H7a2 2 0 0 1-2-2Z" />
        <path d="M8 8h5.5" />
        <path d="M8 11.5h4" />
        <path d="m14.5 14.5 1.6 1.6 3-3.3" />
      </svg>
    );
  }

  if (name === "automation") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M6 5.5h12v13H6z" />
        <path d="M9 3v4M15 3v4M8.5 10h7" />
        <path d="M9 14h2l1.2-2 1.4 4 1-2H17" />
      </svg>
    );
  }

  if (name === "review") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 12a7 7 0 1 0 2-4.9" />
        <path d="M5 4.5V8h3.5" />
        <path d="M12 8v4l2.5 2" />
      </svg>
    );
  }

  if (name === "interview") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M7 10.5a5 5 0 0 1 10 0v1.8" />
        <path d="M6 12h2v4H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2Z" />
        <path d="M18 12h-2v4h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2Z" />
        <path d="M9 19h6" />
        <path d="M12 16v3" />
      </svg>
    );
  }

  if (name === "tutoring") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4.5 7.5h15v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z" />
        <path d="M8 7.5V5.8A2.8 2.8 0 0 1 10.8 3h2.4A2.8 2.8 0 0 1 16 5.8v1.7" />
        <path d="M8 12h3" />
        <path d="M8 15h5.5" />
        <path d="m15.5 12.2 1.1 1.1 2-2.3" />
      </svg>
    );
  }

  if (name === "stats") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4 19V5" />
        <path d="M4 19h17" />
        <path d="m7 15 3.5-4 3 2.5L19 7" />
      </svg>
    );
  }

  if (name === "import") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M12 3v11" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
      </svg>
    );
  }

  if (name === "entry") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M5 19h4l10-10a2.2 2.2 0 0 0-3.1-3.1L5.9 15.9Z" />
        <path d="m14.5 6.5 3 3" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" {...common}>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M12 3v3m0 12v3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M3 12h3m12 0h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}
