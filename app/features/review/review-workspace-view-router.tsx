"use client";

import { CommandSearchPalette } from "../conversation/command-search-palette";
import { ReviewWorkspaceCoreViews } from "./review-workspace-core-views";
import { SettingsWorkspace } from "./review-workspace-lazy-views";
import { ReviewWorkspaceSecondaryViews } from "./review-workspace-secondary-views";
import { ReviewWorkspaceShell } from "./review-workspace-shell";
import type { ReviewWorkspaceController } from "./use-review-workspace-controller.ts";

/** 装配设置、工作台壳层和当前视图；不读取 repository 或持有业务状态。 */
export function ReviewWorkspaceViewRouter({ controller }: { controller: ReviewWorkspaceController }) {
  const { automation, conversation, workspace } = controller;

  if (workspace.loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="ui-card px-5 py-4 shadow-sm">{workspace.notice}</div>
      </main>
    );
  }

  if (workspace.view === "settings") {
    return (
      <SettingsWorkspace
        activeSection={workspace.settingsSection}
        appearanceSettings={workspace.appearanceSettings}
        diagnosticsInput={workspace.health.diagnosticsInput}
        sidebarCollapsed={workspace.sidebarCollapsed}
        onAppearanceChange={workspace.updateAppearanceSettings}
        onBack={() => {
          workspace.resetSettingsSection();
          workspace.switchView(workspace.lastAppView);
        }}
        onDataChanged={workspace.refreshAfterDataManagement}
        onConfigurationChanged={() => {
          void controller.aiConnections.refresh();
          void controller.data.refreshData();
        }}
        onOpenDiagnosticsTarget={workspace.openDiagnosticsTarget}
        onPersonalizationChange={controller.personalization.setSettings}
        onSectionChange={workspace.setSettingsSection}
        onToggleSidebar={workspace.toggleSidebar}
      />
    );
  }

  return (
    <ReviewWorkspaceShell
      automationUnreadCount={automation.snapshot.unreadCount}
      activeConversationId={conversation.activeConversationId}
      conversations={conversation.snapshot.conversations.filter((item) => item.status === "active")}
      folders={conversation.snapshot.folders}
      notice={workspace.notice}
      sidebarCollapsed={workspace.sidebarCollapsed}
      today={workspace.today}
      view={workspace.view}
      onOpenConversation={conversation.openConversation}
      onOpenEntry={() => workspace.switchView("entry")}
      onOpenImport={() => workspace.switchView("import")}
      onOpenSearch={() => conversation.setSearchOpen(true)}
      onOpenSettings={() => workspace.switchView("settings")}
      onStartNewConversation={conversation.openBlank}
      onNotice={workspace.setNotice}
      onRefreshConversations={conversation.refresh}
      onSelectView={workspace.switchView}
      onToggleSidebar={workspace.toggleSidebar}
    >
      <ReviewWorkspaceCoreViews controller={controller} />
      <ReviewWorkspaceSecondaryViews controller={controller} />
      <CommandSearchPalette
        open={conversation.searchOpen}
        results={conversation.results}
        onClose={() => conversation.setSearchOpen(false)}
        onQueryChange={conversation.setSearchQuery}
        onSelect={(result) => void conversation.selectResult(result)}
      />
    </ReviewWorkspaceShell>
  );
}
