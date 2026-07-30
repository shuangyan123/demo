"use client";

import { CommandSearchPalette } from "../conversation/command-search-palette";
import { SettingsWorkspaceSidebar } from "../settings/settings-workspace-navigation";
import { CivilServiceDevelopmentExampleSwitcher } from "../shared/civil-service-development-example-switcher";
import { ReviewWorkspaceCoreViews } from "./review-workspace-core-views";
import { SettingsWorkspace } from "./review-workspace-lazy-views";
import { ReviewWorkspaceSecondaryViews } from "./review-workspace-secondary-views";
import { ReviewWorkspaceShell } from "./review-workspace-shell";
import type { ReviewWorkspaceController } from "./use-review-workspace-controller.ts";

/** 装配设置、工作台壳层和当前视图；不读取 repository 或持有业务状态。 */
export function ReviewWorkspaceViewRouter({ controller, developmentExample }: { controller: ReviewWorkspaceController; developmentExample?: string }) {
  const { automation, conversation, workspace } = controller;

  if (workspace.loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="ui-card px-5 py-4 shadow-sm">{workspace.notice}</div>
      </main>
    );
  }

  const settingsMode = workspace.view === "settings";
  const leaveSettings = () => {
    workspace.resetSettingsSection();
    workspace.switchView(workspace.lastAppView);
  };

  return (
    <ReviewWorkspaceShell
      automationUnreadCount={automation.snapshot.unreadCount}
      activeConversationId={conversation.activeConversationId}
      conversations={conversation.snapshot.conversations.filter((item) => item.status === "active")}
      folders={conversation.snapshot.folders}
      notice={workspace.notice}
      contentClassName={settingsMode ? "settings-content settings-main-scroll px-8 py-8 max-lg:px-4 max-lg:py-6" : undefined}
      sidebarOverride={settingsMode ? (
        <SettingsWorkspaceSidebar
          activeSection={workspace.settingsSection}
          onBack={leaveSettings}
          onSectionChange={workspace.setSettingsSection}
        />
      ) : undefined}
      sidebarCollapsed={workspace.sidebarCollapsed}
      today={workspace.today}
      titleOverride={settingsMode ? "设置" : undefined}
      view={workspace.view}
      onOpenConversation={conversation.openConversation}
      onOpenEntry={() => workspace.switchView("entry")}
      onOpenImport={() => workspace.switchView("import")}
      onOpenSearch={() => conversation.setSearchOpen(true)}
      onOpenSettings={() => workspace.switchView("settings")}
      onBack={settingsMode ? leaveSettings : undefined}
      onStartNewConversation={conversation.openBlank}
      onNotice={workspace.setNotice}
      onRefreshConversations={conversation.refresh}
      onSelectView={workspace.switchView}
      onToggleSidebar={workspace.toggleSidebar}
    >
      {settingsMode ? (
        <SettingsWorkspace
          activeSection={workspace.settingsSection}
          appearanceSettings={workspace.appearanceSettings}
          diagnosticsInput={workspace.health.diagnosticsInput}
          developmentExample={developmentExample}
          onAppearanceChange={workspace.updateAppearanceSettings}
          onDataChanged={workspace.refreshAfterDataManagement}
          onConfigurationChanged={() => {
            void controller.aiConnections.refresh();
            void controller.data.refreshData();
          }}
          onOpenDiagnosticsTarget={workspace.openDiagnosticsTarget}
          onPersonalizationChange={controller.personalization.setSettings}
          onSectionChange={workspace.setSettingsSection}
        />
      ) : (
        <>
          {!["library", "review", "knowledgeTraining", "interview", "entry"].includes(workspace.view) ? (
            <CivilServiceDevelopmentExampleSwitcher initialValue={developmentExample} view={workspace.view} />
          ) : null}
          <ReviewWorkspaceCoreViews controller={controller} developmentExample={developmentExample} />
          <ReviewWorkspaceSecondaryViews controller={controller} developmentExample={developmentExample} />
          <CommandSearchPalette
            open={conversation.searchOpen}
            results={conversation.results}
            onClose={() => conversation.setSearchOpen(false)}
            onQueryChange={conversation.setSearchQuery}
            onSelect={(result) => void conversation.selectResult(result)}
          />
        </>
      )}
    </ReviewWorkspaceShell>
  );
}
