"use client";

import type { ReactNode } from "react";
import { toISODate } from "../../lib/review-utils";
import type { AiConversation, AiConversationFolder } from "../../types/domains/conversation.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { Button } from "../shared/ui-primitives";
import { ViewHeader, WorkspaceShell } from "../shared/workspace-shell";
import { ReviewWorkspaceAppSidebar } from "./review-workspace-app-sidebar";
import { preloadReviewView } from "./review-workspace-preload.ts";

type ReviewWorkspaceShellProps = {
  automationUnreadCount: number;
  children: ReactNode;
  contentClassName?: string;
  conversations: AiConversation[];
  folders: AiConversationFolder[];
  activeConversationId?: string | null;
  notice: string;
  sidebarFooter?: ReactNode;
  sidebarOverride?: ReactNode;
  sidebarCollapsed: boolean;
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

/** 渲染全站唯一工作台外壳，页面只替换侧栏内容与主内容插槽。 */
export function ReviewWorkspaceShell({
  automationUnreadCount,
  children,
  contentClassName,
  conversations,
  folders,
  activeConversationId,
  notice,
  sidebarFooter,
  sidebarOverride,
  sidebarCollapsed,
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
      folders={folders}
      footer={sidebarFooter}
      view={view}
      onNotice={onNotice}
      onOpenConversation={onOpenConversation}
      onOpenSearch={onOpenSearch}
      onOpenSettings={onOpenSettings}
      onRefreshConversations={onRefreshConversations}
      onSelectView={onSelectView}
      onStartNewConversation={onStartNewConversation}
    />
  );

  return (
    <WorkspaceShell
      contentClassName={contentClassName ?? (view === "conversation"
        ? "conversation-shell-content"
        : view === "automation"
          ? "review-view-automation px-7 pt-4 pb-7 max-sm:px-4"
          : `review-view-${view} px-7 py-7 max-sm:px-4`)}
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName={sidebarOverride
        ? "flex flex-col overflow-y-auto px-3 py-4 text-settings-sidebar-text max-lg:px-3 max-lg:py-2"
        : "review-workspace-sidebar flex flex-col overflow-hidden px-3 py-4 text-app-sidebar-text max-lg:px-3 max-lg:py-2"}
      title={titleOverride ?? (view === "dashboard" || view === "conversation" ? "错题复盘" : viewTitles[view])}
      onBack={onBack}
      onToggleSidebar={onToggleSidebar}
      sidebar={sidebarOverride ?? applicationSidebar}
    >
      {["library", "import", "entry", "plugins"].includes(view) && notice !== "本地题库已同步" ? (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted" role="status">{notice}</div>
      ) : null}
      {!["conversation", "dashboard", "automation", "library", "import", "entry", "plugins", "settings"].includes(view) ? (
        <ViewHeader
          actions={(
            <>
              <Button variant="outline" onClick={onOpenImport} onFocus={() => preloadReviewView("import")} onMouseEnter={() => preloadReviewView("import")}>
                导入资料
              </Button>
              <Button variant="primary" onClick={onOpenEntry}>手动录入</Button>
            </>
          )}
          eyebrow={`${toISODate(today)} · ${notice}`}
          title={viewTitles[view]}
        />
      ) : null}
      {children}
    </WorkspaceShell>
  );
}
