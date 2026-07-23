"use client";

import type { ReactNode } from "react";
import { toISODate } from "../../lib/review-utils";
import type { AiConversation, AiConversationFolder, ViewKey } from "../../types/review";
import { Button } from "../shared/ui-primitives";
import { ViewHeader, WorkspaceShell } from "../shared/workspace-shell";
import { isStudyModuleView, scheduledWorkspaceDefinition, studyDomainDefinitions } from "../study/study-registry";
import { ConversationFolderTree } from "../conversation/conversation-folder-tree";
import { AppIcon } from "../shared/app-icon";

type ReviewNavIconName =
  | "newChat"
  | "search"
  | "scheduled"
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
  | "project"
  | "plugins"
  | "settings";

type ReviewWorkspaceShellProps = {
  automationUnreadCount: number;
  children: ReactNode;
  conversations: AiConversation[];
  folders: AiConversationFolder[];
  activeConversationId?: string | null;
  notice: string;
  sidebarCollapsed: boolean;
  today: Date;
  view: ViewKey;
  onOpenConversation: (id: string) => void;
  onOpenEntry: () => void;
  onOpenImport: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onStartNewConversation: () => void;
  onNotice: (message: string) => void;
  onRefreshConversations: () => Promise<void>;
  onSelectView: (view: ViewKey) => void;
  onToggleSidebar: () => void;
};

const viewTitles: Record<ViewKey, string> = {
  conversation: "对话",
  dashboard: "总览",
  library: "错题库",
  review: "错题复盘",
  knowledgeTraining: "知识训练",
  interview: "面试训练",
  tutoring: "AI 辅导",
  stats: "薄弱分析",
  knowledge: "知识库",
  automation: "已安排",
  import: "粉笔导入",
  entry: "手动录入",
  plugins: "插件",
  settings: "设置",
};

/** 渲染复盘应用的稳定壳层，业务模块只向这里传入导航状态和页面内容。 */
export function ReviewWorkspaceShell({
  automationUnreadCount,
  children,
  conversations,
  folders,
  activeConversationId,
  notice,
  sidebarCollapsed,
  today,
  view,
  onOpenConversation,
  onOpenEntry,
  onOpenImport,
  onOpenSearch,
  onOpenSettings,
  onStartNewConversation,
  onNotice,
  onRefreshConversations,
  onSelectView,
  onToggleSidebar,
}: ReviewWorkspaceShellProps) {
  const civilServiceDomain = studyDomainDefinitions[0];
  const projectActive = view === "conversation" || isStudyModuleView(view);
  const topActions: Array<{
    id: string;
    label: string;
    icon: ReviewNavIconName;
    active?: boolean;
    badge?: number;
    onClick: () => void;
  }> = [
    { id: "new-chat", label: "新对话", icon: "newChat", active: view === "conversation" && activeConversationId === null, onClick: () => onStartNewConversation() },
    { id: "search", label: "搜索", icon: "search", onClick: onOpenSearch },
    {
      id: "scheduled",
      label: scheduledWorkspaceDefinition.label,
      icon: "scheduled",
      active: view === scheduledWorkspaceDefinition.viewKey,
      badge: automationUnreadCount || undefined,
      onClick: () => onSelectView(scheduledWorkspaceDefinition.viewKey),
    },
    { id: "plugins", label: "插件", icon: "plugins", active: view === "plugins", onClick: () => onSelectView("plugins") },
  ];

  return (
    <WorkspaceShell
      key={`${view}:${activeConversationId ?? "none"}`}
      contentClassName={view === "conversation" ? "conversation-shell-content" : `review-view-${view} px-7 py-7 max-sm:px-4`}
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName="review-workspace-sidebar flex flex-col overflow-hidden px-3 py-4 text-app-sidebar-text max-lg:px-3 max-lg:py-2"
      title={view === "dashboard" || view === "conversation" ? "错题复盘" : viewTitles[view]}
      onToggleSidebar={onToggleSidebar}
      sidebar={
        <>
          <nav className="grid gap-1" aria-label="工作台快捷入口">
            {topActions.map((item) => (
              <button
                key={item.id}
                data-mobile-sidebar-close="true"
                className={`grid min-h-10 grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium ${
                  item.active ? "bg-chrome-selected" : "hover:bg-chrome-hover"
                }`}
                type="button"
                onClick={item.onClick}
              >
                <ReviewNavIcon name={item.icon} />
                <span className="truncate">{item.label}</span>
                {item.badge ? <span className="inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-blue px-1 text-[11px] text-white">{item.badge}</span> : null}
              </button>
            ))}
          </nav>
          <button
            data-mobile-sidebar-close="true"
            className="hidden min-h-10 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium hover:bg-chrome-hover max-lg:grid"
            type="button"
            onClick={onOpenSettings}
          >
            <ReviewNavIcon name="settings" />
            <span>设置</span>
          </button>

          <section className="mt-7 min-h-0 flex-1 overflow-y-auto pr-1" aria-label="项目和对话">
            <div className="mb-2 flex items-center justify-between gap-2 px-3">
              <p className="text-xs font-medium text-muted">项目</p>
              <span className="text-[11px] text-muted">专项学习</span>
            </div>
            <details className="group rounded-lg bg-chrome-selected/60 p-1">
              <summary className={`grid min-h-10 cursor-pointer list-none grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-md px-2 text-left text-sm font-semibold [&::-webkit-details-marker]:hidden ${projectActive ? "bg-surface text-foreground shadow-sm" : "hover:bg-chrome-hover"}`}>
                <ReviewNavIcon name="project" />
                <span className="truncate">{civilServiceDomain.label}</span>
                <span className="transition group-open:rotate-90"><AppIcon name="chevronRight" size={16} /></span>
              </summary>
              <div className="mt-1 grid gap-1 pl-2">
                <details className="group/modules">
                  <summary className="grid min-h-8 cursor-pointer list-none grid-cols-[1fr_auto] items-center rounded-md px-2 text-[11px] font-medium text-muted hover:bg-chrome-hover [&::-webkit-details-marker]:hidden">
                    <span>模块</span><span className="transition group-open/modules:rotate-90"><AppIcon name="chevronRight" size={16} /></span>
                  </summary>
                  <div className="grid gap-1 pl-1">
                  {civilServiceDomain.modules.map((module) => (
                    <button
                      key={module.id}
                      data-mobile-sidebar-close="true"
                      className={`grid min-h-9 grid-cols-[20px_1fr] items-center gap-2.5 rounded-md px-2 text-left text-sm ${
                        view === module.id ? "bg-surface text-foreground shadow-sm" : "text-muted hover:bg-chrome-hover hover:text-foreground"
                      }`}
                      type="button"
                      title={module.description}
                      onClick={() => onSelectView(module.id)}
                    >
                      <ReviewNavIcon name={module.icon as ReviewNavIconName} />
                      <span className="truncate">{module.label}</span>
                    </button>
                  ))}
                  </div>
                </details>
              </div>
            </details>

            <ConversationFolderTree
              activeConversationId={activeConversationId}
              conversations={conversations}
              folders={folders}
              projectId={civilServiceDomain.id}
              onConversationSelected={onOpenConversation}
              onNotice={onNotice}
              onRefresh={onRefreshConversations}
            />
          </section>

          <button
            data-mobile-sidebar-close="true"
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
      {["library", "import", "entry", "plugins"].includes(view) && notice !== "本地题库已同步" ? (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted" role="status">{notice}</div>
      ) : null}
      {!["conversation", "dashboard", "automation", "library", "import", "entry", "plugins"].includes(view) ? (
        <ViewHeader
          actions={
            <>
              <Button variant="outline" onClick={onOpenImport}>
                导入资料
              </Button>
              <Button variant="primary" onClick={onOpenEntry}>
                手动录入
              </Button>
            </>
          }
          eyebrow={`${toISODate(today)} · ${notice}`}
          title={viewTitles[view]}
        />
      ) : null}
      {children}
    </WorkspaceShell>
  );
}

/** 渲染侧边栏线性图标，避免为少量导航图标额外引入依赖。 */
function ReviewNavIcon({ name }: { name: ReviewNavIconName }) {
  if (name) return <AppIcon name={name} size={20} />;
  const common = {
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    viewBox: "0 0 24 24",
  };

  if (name === "newChat") {
    return <svg aria-hidden="true" {...common}><path d="M12 5v14M5 12h14" /></svg>;
  }

  if (name === "search") {
    return (
      <svg aria-hidden="true" {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }

  if (name === "scheduled") {
    return (
      <svg aria-hidden="true" {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  }

  if (name === "project") {
    return (
      <svg aria-hidden="true" {...common}>
        <path d="M4.5 6.5h6l1.5 2h7.5v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z" />
        <path d="M8 12.5h8" />
      </svg>
    );
  }

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
