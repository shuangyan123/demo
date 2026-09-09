"use client";

import type { ReactNode } from "react";
import { toISODate } from "../../lib/review-utils";
import type { AiConversation, AiProjectPartition } from "../../types/domains/conversation.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { Button } from "../shared/ui-primitives";
import { MainContentShell, type MainContentWidth } from "../shared/main-content-shell";
import { ViewHeader, WorkspaceShell } from "../shared/workspace-shell";
import type { WorkspaceContextDescriptor, WorkspaceContextPanelRegistration } from "../shared/workspace-context-registry";
import type { WorkspaceSummary } from "../shared/workspace-context-types";
import { ReviewWorkspaceAppSidebar } from "./review-workspace-app-sidebar";
import { preloadReviewView } from "./review-workspace-preload.ts";

type ReviewWorkspaceShellProps = {
  automationUnreadCount: number;
  children: ReactNode;
  contentClassName?: string;
  conversations: AiConversation[];
  context: WorkspaceContextDescriptor;
  contextPanelRegistrations?: readonly WorkspaceContextPanelRegistration[];
  partitions: AiProjectPartition[];
  openProjectTree?: boolean;
  activeConversationId?: string | null;
  notice: string;
  sidebarFooter?: ReactNode;
  sidebarOverride?: ReactNode;
  sidebarCollapsed: boolean;
  summary: WorkspaceSummary;
  today: Date;
  titleOverride?: string;
  view: ViewKey;
  onOpenConversation: (id: string) => void;
  onOpenEntry: () => void;
  onOpenImport: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onBack?: () => void;
  onStartNewConversation: () => void;
  onNotice: (message: string) => void;
  onRefreshConversations: () => Promise<void>;
  onSelectView: (view: ViewKey) => void;
  onToggleSidebar: () => void;
};

export const reviewWorkspaceViewTitles: Record<ViewKey, string> = {
  conversation: "对话",
  dashboard: "总览",
  fenbi: "粉笔练习",
  library: "错题库",
  review: "错题复盘",
  knowledgeTraining: "知识训练",
  interview: "面试训练",
  tutoring: "AI 辅导",
  stats: "薄弱分析",
  knowledge: "知识库",
  automation: "已安排",
  import: "导入",
  entry: "手动录入",
  plugins: "插件",
  settings: "设置",
};

function contentWidth(view: ViewKey): MainContentWidth {
  if (view === "settings") return "medium";
  if (["conversation", "dashboard", "fenbi", "library", "plugins", "import", "automation"].includes(view)) return "wide";
  return "medium";
}

/** 渲染全站唯一工作台外壳，页面只替换侧栏内容与主内容插槽。 */
export function ReviewWorkspaceShell({
  automationUnreadCount,
  children,
  contentClassName,
  conversations,
  context,
  contextPanelRegistrations,
  partitions,
  openProjectTree = false,
  activeConversationId,
  notice,
  sidebarFooter,
  sidebarOverride,
  sidebarCollapsed,
  summary,
  today,
  titleOverride,
  view,
  onOpenConversation,
  onOpenEntry,
  onOpenImport,
  onOpenSearch,
  onOpenSettings,
  onBack,
  onStartNewConversation,
  onNotice,
  onRefreshConversations,
  onSelectView,
  onToggleSidebar,
}: ReviewWorkspaceShellProps) {
  const applicationSidebar = (
    <ReviewWorkspaceAppSidebar
      activeConversationId={activeConversationId}
      automationUnreadCount={automationUnreadCount}
      conversations={conversations}
      openProjectTree={openProjectTree}
      partitions={partitions}
      footer={sidebarFooter}
      view={view}
      onNotice={onNotice}
      onOpenConversation={onOpenConversation}
      onOpenEntry={onOpenEntry}
      onOpenImport={onOpenImport}
      onOpenSearch={onOpenSearch}
      onOpenSettings={onOpenSettings}
      onRefreshConversations={onRefreshConversations}
      onSelectView={onSelectView}
      onStartNewConversation={onStartNewConversation}
    />
  );

  return (
    <WorkspaceShell
      contentSurface="raised-surface"
      contentClassName={contentClassName ?? (view === "conversation"
        ? "conversation-shell-content"
        : view === "automation"
          ? "review-view-automation pt-4 pb-7"
          : `review-view-${view} py-6 max-sm:py-5`)}
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName={sidebarOverride ? "workspace-sidebar-host text-settings-sidebar-text" : "workspace-sidebar-host text-app-sidebar-text"}
      context={context}
      contextPanelRegistrations={contextPanelRegistrations}
      summary={summary}
      title={titleOverride ?? reviewWorkspaceViewTitles[view]}
      onBack={onBack}
      onToggleSidebar={onToggleSidebar}
      sidebar={sidebarOverride ?? applicationSidebar}
    >
      <MainContentShell
        className={view === "conversation"
          ? "conversation-main-content flex !h-full !min-h-0 !max-w-none flex-1 flex-col !px-0"
          : view === "fenbi"
            ? "flex !h-full !min-h-0 !max-w-none flex-1 flex-col !px-0"
            : undefined}
        width={contentWidth(view)}
      >
      {["library", "import", "entry", "plugins"].includes(view) && notice !== "本地题库已同步" ? (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted" role="status">{notice}</div>
      ) : null}
      {!["conversation", "dashboard", "fenbi", "automation", "library", "import", "entry", "plugins", "settings"].includes(view) ? (
        <ViewHeader
          actions={(
            <>
              <Button variant="outline" onClick={onOpenImport} onFocus={() => preloadReviewView("import")} onMouseEnter={() => preloadReviewView("import")}>
                粉笔导入
              </Button>
              <Button variant="primary" onClick={onOpenEntry}>手动录入</Button>
            </>
          )}
          eyebrow={`${toISODate(today)} · ${notice}`}
          title={reviewWorkspaceViewTitles[view]}
        />
      ) : null}
      {children}
      </MainContentShell>
    </WorkspaceShell>
  );
}
