"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { AiConversation, AiProjectPartition } from "../../types/domains/conversation.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { AppIcon } from "../shared/app-icon";
import { RecallBrandWordmark } from "../shared/recall-brand-wordmark";
import { scheduledWorkspaceDefinition } from "../study/study-registry";
import { preloadReviewView } from "./review-workspace-preload.ts";

const StudyProjectNavigation = dynamic(
  () => import("../study/study-project-navigation").then((module) => module.StudyProjectNavigation),
);
const ConversationPartitionTree = dynamic(
  () => import("../conversation/conversation-folder-tree").then((module) => module.ConversationPartitionTree),
);

type ReviewNavIconName =
  | "newChat" | "search" | "scheduled" | "project" | "plugins" | "settings"
  | "dashboard" | "fenbi" | "library" | "review" | "knowledgeTraining" | "stats"
  | "knowledge" | "automation" | "interview" | "tutoring" | "import" | "entry";

type ReviewWorkspaceAppSidebarProps = {
  activeConversationId?: string | null;
  automationUnreadCount: number;
  conversations: AiConversation[];
  openProjectTree?: boolean;
  partitions: AiProjectPartition[];
  footer?: ReactNode;
  view: ViewKey;
  onNotice: (message: string) => void;
  onOpenConversation: (id: string) => void;
  onOpenEntry: () => void;
  onOpenImport: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onRefreshConversations: () => Promise<void>;
  onSelectView: (view: ViewKey) => void;
  onStartNewConversation: () => void;
};

type SidebarAction = {
  id: string;
  label: string;
  icon: ReviewNavIconName;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  preload?: ViewKey;
};

function SidebarActionButton({ action }: { action: SidebarAction }) {
  return (
    <button
      aria-current={action.active ? "page" : undefined}
      data-mobile-sidebar-close="true"
      data-workspace-destination={action.id}
      className={`workspace-sidebar-action grid min-h-8 grid-cols-[16px_1fr_auto] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2.5 text-left text-[0.8rem] font-medium max-lg:min-h-11 max-lg:px-3 ${action.active ? "is-selected bg-chrome-selected text-foreground" : "text-muted hover:bg-chrome-hover hover:text-foreground"}`}
      type="button"
      onClick={action.onClick}
      onFocus={() => preloadReviewView(action.preload)}
      onMouseEnter={() => preloadReviewView(action.preload)}
    >
      <AppIcon name={action.icon} size={16} />
      <span className="truncate">{action.label}</span>
      {action.badge ? <span className="inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[11px] text-[var(--surface)]">{action.badge}</span> : null}
    </button>
  );
}

/** 应用模式侧栏集中承载主导航、学习项目、对话树和低频工具。 */
export function ReviewWorkspaceAppSidebar({
  activeConversationId,
  automationUnreadCount,
  conversations,
  openProjectTree = false,
  partitions,
  footer,
  view,
  onNotice,
  onOpenConversation,
  onOpenEntry,
  onOpenImport,
  onOpenSearch,
  onOpenSettings,
  onRefreshConversations,
  onSelectView,
  onStartNewConversation,
}: ReviewWorkspaceAppSidebarProps) {
  const primaryActions: SidebarAction[] = [
    { id: "dashboard", label: "总览", icon: "dashboard", active: view === "dashboard", onClick: () => onSelectView("dashboard") },
  ];
  const workspaceActions: SidebarAction[] = [
    {
      id: "scheduled",
      label: scheduledWorkspaceDefinition.label,
      icon: "scheduled",
      active: view === scheduledWorkspaceDefinition.viewKey,
      badge: automationUnreadCount || undefined,
      onClick: () => onSelectView(scheduledWorkspaceDefinition.viewKey),
      preload: "automation",
    },
  ];
  const conversationActions: SidebarAction[] = [
    { id: "new-chat", label: "新对话", icon: "newChat", active: view === "conversation" && activeConversationId === null, onClick: () => onStartNewConversation(), preload: "conversation" },
  ];
  const utilityActions: SidebarAction[] = [
    { id: "search", label: "搜索", icon: "search", onClick: onOpenSearch },
    { id: "plugins", label: "插件", icon: "plugins", active: view === "plugins", onClick: () => onSelectView("plugins"), preload: "plugins" },
  ];

  return (
    <div className="workspace-sidebar-shell app-sidebar-shell" data-sidebar-kind="application">
      <header aria-label="Recall 本地学习工作台" className="workspace-sidebar-header">
        <div className="workspace-sidebar-brand">
          <span className="workspace-sidebar-wordmark" aria-hidden="true">
            <span className="workspace-sidebar-wordmark-light"><RecallBrandWordmark alt="" className="workspace-sidebar-wordmark-image" theme="light" variant="B" /></span>
            <span className="workspace-sidebar-wordmark-dark"><RecallBrandWordmark alt="" className="workspace-sidebar-wordmark-image" theme="dark" variant="B" /></span>
          </span>
          <span>本地学习工作台</span>
        </div>
      </header>

      <nav className="workspace-sidebar-primary-nav" aria-label="主要导航">
        {primaryActions.map((action) => <SidebarActionButton action={action} key={action.id} />)}
      </nav>

      <div className="workspace-sidebar-scroll" data-sidebar-scroll-region="true">
        <section className="workspace-sidebar-section" data-workspace-section="study" aria-label="学习">
          <div className="workspace-sidebar-section-heading">
            <span>学习</span>
            <span>公考</span>
          </div>
          <StudyProjectNavigation
            initiallyOpen={openProjectTree}
            dashboardOutside
            onNotice={onNotice}
            onPreloadView={preloadReviewView}
            onSelectView={onSelectView}
            view={view}
          />
        </section>

        <section className="workspace-sidebar-section" data-workspace-section="workspace" aria-label="工作台">
          <div className="workspace-sidebar-section-heading"><span>工作台</span></div>
          {workspaceActions.map((action) => <SidebarActionButton action={action} key={action.id} />)}
        </section>

        <section className="workspace-sidebar-section" data-workspace-section="conversation" aria-label="对话和项目">
          <div className="workspace-sidebar-section-heading"><span>对话 / 项目</span></div>
          {conversationActions.map((action) => <SidebarActionButton action={action} key={action.id} />)}
          <ConversationPartitionTree
            activeConversationId={activeConversationId}
            conversations={conversations}
            partitions={partitions}
            projectId="civil-service"
            onConversationSelected={onOpenConversation}
            onNotice={onNotice}
            onRefresh={onRefreshConversations}
          />
        </section>

        <section className="workspace-sidebar-section" data-workspace-section="tools" aria-label="工具">
          <div className="workspace-sidebar-section-heading"><span>工具</span></div>
          <details className="workspace-sidebar-material-menu">
            <summary className="workspace-sidebar-action workspace-sidebar-disclosure-row grid min-h-8 cursor-pointer list-none grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2.5 text-left text-[0.8rem] font-medium text-muted hover:bg-chrome-hover hover:text-foreground max-lg:min-h-11 max-lg:px-3" data-workspace-material-trigger="true">
              <AppIcon name="import" size={16} />
              <span className="truncate">添加学习材料</span>
              <AppIcon name="chevronRight" size={16} />
            </summary>
            <div className="workspace-sidebar-material-options">
              <button className="workspace-sidebar-action grid min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2.5 text-left text-[0.8rem] text-muted hover:bg-chrome-hover hover:text-foreground max-lg:min-h-11 max-lg:px-3" data-mobile-sidebar-close="true" type="button" onClick={onOpenImport} onFocus={() => preloadReviewView("import")} onMouseEnter={() => preloadReviewView("import")}>
                <AppIcon name="import" size={16} />
                <span className="truncate">粉笔导入</span>
              </button>
              <button className="workspace-sidebar-action grid min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2.5 text-left text-[0.8rem] text-muted hover:bg-chrome-hover hover:text-foreground max-lg:min-h-11 max-lg:px-3" data-mobile-sidebar-close="true" type="button" onClick={onOpenEntry}>
                <AppIcon name="entry" size={16} />
                <span className="truncate">手动录入</span>
              </button>
            </div>
          </details>
          {utilityActions.map((action) => <SidebarActionButton action={action} key={action.id} />)}
        </section>
      </div>

      <footer className="workspace-sidebar-footer" aria-label="工作台辅助操作">
        {footer}
        <button
          data-mobile-sidebar-close="true"
          className="grid min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-[var(--ui-radius-row)] px-2.5 text-left text-[0.8rem] font-medium hover:bg-chrome-hover max-lg:min-h-11 max-lg:px-3"
          type="button"
          onClick={onOpenSettings}
          onFocus={() => preloadReviewView("settings")}
          onMouseEnter={() => preloadReviewView("settings")}
        >
          <AppIcon name="settings" size={16} />
          <span>设置</span>
        </button>
      </footer>
    </div>
  );
}
