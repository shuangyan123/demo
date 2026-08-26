"use client";

import type { ReactNode } from "react";
import type { AiConversation, AiConversationFolder } from "../../types/domains/conversation.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { ConversationFolderTree } from "../conversation/conversation-folder-tree";
import { AppIcon } from "../shared/app-icon";
import { isStudyModuleView, scheduledWorkspaceDefinition, studyDomainDefinitions } from "../study/study-registry";
import { preloadReviewView } from "./review-workspace-preload.ts";

type ReviewNavIconName =
  | "newChat" | "search" | "scheduled" | "project" | "plugins" | "settings"
  | "dashboard" | "library" | "review" | "knowledgeTraining" | "stats"
  | "knowledge" | "automation" | "interview" | "tutoring" | "import" | "entry";

type ReviewWorkspaceAppSidebarProps = {
  activeConversationId?: string | null;
  automationUnreadCount: number;
  conversations: AiConversation[];
  folders: AiConversationFolder[];
  footer?: ReactNode;
  view: ViewKey;
  onNotice: (message: string) => void;
  onOpenConversation: (id: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onRefreshConversations: () => Promise<void>;
  onSelectView: (view: ViewKey) => void;
  onStartNewConversation: () => void;
};

/** 应用模式侧栏集中承载快捷入口、专项项目和对话树。 */
export function ReviewWorkspaceAppSidebar({
  activeConversationId,
  automationUnreadCount,
  conversations,
  folders,
  footer,
  view,
  onNotice,
  onOpenConversation,
  onOpenSearch,
  onOpenSettings,
  onRefreshConversations,
  onSelectView,
  onStartNewConversation,
}: ReviewWorkspaceAppSidebarProps) {
  const civilServiceDomain = studyDomainDefinitions[0];
  const projectActive = view === "conversation" || isStudyModuleView(view);
  const topActions: Array<{
    id: string;
    label: string;
    icon: ReviewNavIconName;
    active?: boolean;
    badge?: number;
    onClick: () => void;
    preload?: ViewKey;
  }> = [
    { id: "new-chat", label: "新对话", icon: "newChat", active: view === "conversation" && activeConversationId === null, onClick: () => onStartNewConversation(), preload: "conversation" },
    { id: "search", label: "搜索", icon: "search", onClick: onOpenSearch },
    {
      id: "scheduled",
      label: scheduledWorkspaceDefinition.label,
      icon: "scheduled",
      active: view === scheduledWorkspaceDefinition.viewKey,
      badge: automationUnreadCount || undefined,
      onClick: () => onSelectView(scheduledWorkspaceDefinition.viewKey),
      preload: "automation",
    },
    { id: "plugins", label: "插件与技能", icon: "plugins", active: view === "plugins", onClick: () => onSelectView("plugins"), preload: "plugins" },
  ];

  return (
    <>
      <nav className="grid gap-px" aria-label="工作台快捷入口">
        {topActions.map((item) => (
          <button
            key={item.id}
            data-mobile-sidebar-close="true"
            className={`grid min-h-8 grid-cols-[16px_1fr_auto] items-center gap-[0.45rem] rounded-md px-2.5 text-left text-[0.8rem] font-medium max-lg:min-h-11 max-lg:px-3 ${item.active ? "bg-chrome-selected" : "hover:bg-chrome-hover"}`}
            type="button"
            onClick={item.onClick}
            onFocus={() => preloadReviewView(item.preload)}
            onMouseEnter={() => preloadReviewView(item.preload)}
          >
            <AppIcon name={item.icon} size={16} />
            <span className="truncate">{item.label}</span>
            {item.badge ? <span className="inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[11px] text-[var(--surface)]">{item.badge}</span> : null}
          </button>
        ))}
      </nav>

      <button
        data-mobile-sidebar-close="true"
        className="hidden min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-md px-2.5 text-left text-[0.8rem] font-medium hover:bg-chrome-hover max-lg:min-h-11 max-lg:grid max-lg:px-3"
        type="button"
        onClick={onOpenSettings}
        onFocus={() => preloadReviewView("settings")}
        onMouseEnter={() => preloadReviewView("settings")}
      >
        <AppIcon name="settings" size={16} />
        <span>设置</span>
      </button>

      <section className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1" aria-label="项目和对话">
        <div className="mb-1 flex items-center justify-between gap-2 px-2.5">
          <p className="text-xs font-medium text-muted">项目</p>
          <span className="text-[11px] text-muted">专项学习</span>
        </div>
        <details className="group rounded-md bg-chrome-selected/60 p-0.5">
          <summary className={`grid min-h-8 cursor-pointer list-none grid-cols-[16px_1fr_auto] items-center gap-[0.45rem] rounded-md px-2 text-left text-[0.8rem] font-semibold max-lg:min-h-11 [&::-webkit-details-marker]:hidden ${projectActive ? "bg-surface text-foreground shadow-sm" : "hover:bg-chrome-hover"}`}>
            <AppIcon name="project" size={16} />
            <span className="truncate">{civilServiceDomain.label}</span>
            <span className="transition group-open:rotate-90"><AppIcon name="chevronRight" size={16} /></span>
          </summary>
          <div className="grid gap-px pl-2">
            <details className="group/modules">
              <summary className="grid min-h-8 cursor-pointer list-none grid-cols-[1fr_auto] items-center rounded-md px-2 text-[11px] font-medium text-muted hover:bg-chrome-hover max-lg:min-h-11 [&::-webkit-details-marker]:hidden">
                <span>模块</span><span className="transition group-open/modules:rotate-90"><AppIcon name="chevronRight" size={16} /></span>
              </summary>
              <div className="grid gap-px pl-1">
                {civilServiceDomain.modules.map((module) => (
                  <button
                    key={module.id}
                    data-mobile-sidebar-close="true"
                    className={`grid min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-md px-2 text-left text-[0.8rem] max-lg:min-h-11 ${view === module.id ? "bg-surface text-foreground shadow-sm" : "text-muted hover:bg-chrome-hover hover:text-foreground"}`}
                    type="button"
                    title={module.description}
                    onClick={() => onSelectView(module.id)}
                    onFocus={() => preloadReviewView(module.id)}
                    onMouseEnter={() => preloadReviewView(module.id)}
                  >
                    <AppIcon name={module.icon as ReviewNavIconName} size={16} />
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

      {footer}
      <button
        data-mobile-sidebar-close="true"
        className="relative z-40 mt-1 grid min-h-8 grid-cols-[16px_1fr] items-center gap-[0.45rem] rounded-md px-2.5 text-left text-[0.8rem] font-medium hover:bg-chrome-hover max-lg:hidden"
        type="button"
        onClick={onOpenSettings}
        onFocus={() => preloadReviewView("settings")}
        onMouseEnter={() => preloadReviewView("settings")}
      >
        <AppIcon name="settings" size={16} />
        <span>设置</span>
      </button>
    </>
  );
}
