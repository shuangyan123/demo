"use client";

import dynamic from "next/dynamic";
import { ConversationContextPanel } from "../conversation/conversation-context-panel";
import { useSettingsPluginPreferences } from "../settings/plugins/use-settings-plugin-preferences.ts";
import { Button } from "../shared/ui-primitives";
import type { WorkspaceContextPanelRegistration } from "../shared/workspace-context-registry";
import type { WorkspaceSummary } from "../shared/workspace-context-types";
import type { SampleScenarioId } from "../shared/sample-scenario-registry";
import { ReviewWorkspaceCoreViews } from "./review-workspace-core-views";
import { ImportWorkspace, SettingsPluginsView, SettingsWorkspace } from "./review-workspace-lazy-views";
import { ReviewWorkspaceSecondaryViews } from "./review-workspace-secondary-views";
import { reviewWorkspaceViewTitles, ReviewWorkspaceShell } from "./review-workspace-shell";
import type { ReviewWorkspaceController } from "./use-review-workspace-controller.ts";

const SampleScenarioControls = dynamic(() => import("../shared/sample-scenario-controls").then((module) => module.SampleScenarioControls));
const SettingsWorkspaceSidebar = dynamic(() => import("../settings/settings-workspace-navigation").then((module) => module.SettingsWorkspaceSidebar));
const ProfileUsageSettingsView = dynamic(() => import("../settings/profile-usage-settings-view").then((module) => module.ProfileUsageSettingsView));
const FenbiContextPanel = dynamic(() => import("../fenbi/fenbi-context-panel").then((module) => module.FenbiContextPanel));
const CommandSearchPalette = dynamic(() => import("../conversation/command-search-palette"));

/** 装配设置、工作台壳层和当前视图；不读取 repository 或持有业务状态。 */
export function ReviewWorkspaceViewRouter({
  busy,
  controller,
  installedCount,
  scope,
  onClearSamples,
  onExitSample,
  onInstallAllSamples,
  onLoadSample,
}: {
  busy: boolean;
  controller: ReviewWorkspaceController;
  installedCount: number;
  scope: ReviewWorkspaceController["workspace"]["scope"];
  onClearSamples: () => Promise<void>;
  onExitSample: () => void;
  onInstallAllSamples: () => Promise<void>;
  onLoadSample: (scenarioId: SampleScenarioId) => Promise<void>;
}) {
  const { aiConnections, automation, conversation, workspace } = controller;
  const pluginPreferences = useSettingsPluginPreferences();

  if (workspace.loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="ui-card px-5 py-4 shadow-sm">{workspace.notice}</div>
      </main>
    );
  }

  const settingsMode = workspace.view === "settings";
  const activeConversations = conversation.snapshot.conversations.filter((item) => item.status === "active");
  const activeConversation = conversation.activeConversationId === null
    ? null
    : activeConversations.find((item) => item.id === conversation.activeConversationId) ?? activeConversations[0] ?? null;
  const activeProject = activeConversation ? conversation.snapshot.projects.find((item) => item.id === activeConversation.projectId) : undefined;
  const activePartitionId = activeConversation?.partitionId ?? activeConversation?.folderId;
  const activePartition = activePartitionId
    ? conversation.snapshot.partitions.find((item) => item.id === activePartitionId)
    : undefined;
  const summaryConnection = aiConnections.snapshot.profiles.find((item) => item.id === (activeConversation?.selectedConnectionId ?? aiConnections.snapshot.defaults.textConnectionId));
  const summaryModelId = activeConversation?.selectedModelId ?? aiConnections.snapshot.defaults.textModelId;
  const summary: WorkspaceSummary = {
    workspaceLabel: "错题复盘",
    sectionLabel: settingsMode ? "设置" : reviewWorkspaceViewTitles[workspace.view],
    conversationTitle: workspace.view === "conversation" ? activeConversation?.title ?? conversation.launchContext?.title ?? "新对话" : activeConversation?.title,
    modelLabel: summaryModelId ? `${summaryConnection?.label ? `${summaryConnection.label} · ` : ""}${summaryModelId}` : undefined,
    projectLabel: activeProject?.label,
    attachedContextCount: activeConversation ? conversation.snapshot.attachments.filter((item) => item.conversationId === activeConversation.id).length : undefined,
    statusLabel: workspace.notice,
  };
  const contextPanelRegistrations: WorkspaceContextPanelRegistration[] = workspace.view === "conversation" ? [{
    id: "conversation",
    title: "对话上下文",
    description: "当前会话的本地资料与来源。",
    matches: (context) => context.view === "conversation",
    content: <ConversationContextPanel
      activeConversation={activeConversation}
      attachments={activeConversation ? conversation.snapshot.attachments.filter((item) => item.conversationId === activeConversation.id) : []}
      partitionLabel={activePartition?.label}
      launchContext={conversation.launchContext}
      projectLabel={activeProject?.label}
    />,
  }] : workspace.view === "fenbi" ? [{
    id: "fenbi",
    title: "粉笔",
    description: "粉笔嵌入练习的本地会话状态与控制。",
    matches: (context) => context.view === "fenbi",
    content: <FenbiContextPanel onOpenImport={() => workspace.switchView("import")} />,
  }] : [];
  const context = { view: workspace.view, conversationId: activeConversation?.id ?? null };
  const reviewControls = scope.kind === "personal" ? (
    <SampleScenarioControls
      busy={busy}
      installedCount={installedCount}
      settingsSection={settingsMode ? workspace.settingsSection : undefined}
      scope={scope}
      view={workspace.view}
      onClear={onClearSamples}
      onExit={onExitSample}
      onInstallAll={onInstallAllSamples}
      onLoad={onLoadSample}
    />
  ) : null;
  const leaveSettings = () => {
    workspace.resetSettingsSection();
    workspace.switchView(workspace.lastAppView);
  };

  return (
    <ReviewWorkspaceShell
      automationUnreadCount={automation.snapshot.unreadCount}
      activeConversationId={conversation.activeConversationId}
      conversations={activeConversations}
      context={context}
      contextPanelRegistrations={contextPanelRegistrations}
      openProjectTree={installedCount > 0}
      partitions={conversation.snapshot.partitions}
      notice={workspace.notice}
      contentClassName={settingsMode ? "settings-content settings-main-scroll py-8 max-lg:py-6" : undefined}
      sidebarOverride={settingsMode ? (
        <SettingsWorkspaceSidebar
          activeSection={workspace.settingsSection}
          footer={reviewControls}
          onBack={leaveSettings}
          onSectionChange={workspace.setSettingsSection}
        />
      ) : undefined}
      sidebarCollapsed={workspace.sidebarCollapsed}
      summary={summary}
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
      sidebarFooter={settingsMode ? undefined : reviewControls}
    >
      {settingsMode ? (
        <SettingsWorkspace
          activeSection={workspace.settingsSection}
          appearanceSettings={workspace.appearanceSettings}
          diagnosticsInput={workspace.health.diagnosticsInput}
          onAppearanceChange={workspace.updateAppearanceSettings}
          onDataChanged={workspace.refreshAfterDataManagement}
          onConfigurationChanged={() => {
            void controller.aiConnections.refresh();
            void controller.data.refreshData();
          }}
          onOpenDiagnosticsTarget={workspace.openDiagnosticsTarget}
          onPersonalizationChange={controller.personalization.setSettings}
          onSectionChange={workspace.setSettingsSection}
          profileContent={<ProfileUsageSettingsView
            connections={controller.aiConnections.snapshot.profiles}
            conversationCount={conversation.snapshot.conversations.length}
            importCount={controller.data.importJobs.length}
            knowledgeCount={controller.data.knowledgeEntries.length}
            mistakeCount={controller.data.mistakes.length}
            textModelId={controller.aiConnections.snapshot.defaults.textModelId}
          />}
          importContent={pluginPreferences.enabled["fenbi-import"] ? <ImportWorkspace
            textConnection={controller.aiConnections.textConnection}
            visionConnection={controller.aiConnections.visionConnection}
            importJobs={controller.data.importJobs}
            mistakes={controller.data.mistakes}
            today={workspace.today}
            onRefreshWorkspace={controller.data.refreshData}
            onSwitchSettings={() => workspace.setSettingsSection("configuration")}
            setNotice={workspace.setNotice}
            scope={workspace.scope}
          /> : <section className="settings-disabled-feature"><strong>粉笔导入插件已停用</strong><p>现有草稿、凭据和导入记录均已保留。</p><Button onClick={() => workspace.setSettingsSection("installed-plugins")}>前往已安装插件</Button></section>}
          installedPluginsContent={<SettingsPluginsView
            appearanceSettings={workspace.appearanceSettings}
            entries={controller.data.knowledgeEntries}
            importJobs={controller.data.importJobs}
            knowledgeDrafts={controller.knowledge.snapshot.drafts}
            mistakes={controller.data.mistakes}
            personalization={controller.personalization.settings}
            textConnection={controller.aiConnections.textConnection}
            visionConnection={controller.aiConnections.visionConnection}
            today={workspace.today}
            onChanged={controller.data.refreshData}
            onAppearanceChange={workspace.updateAppearanceSettings}
            onConfirmKnowledgeDrafts={controller.knowledge.actions.confirmDrafts}
            onDeleteKnowledgeDraft={controller.knowledge.actions.deleteDraft}
            onImportKnowledgeText={controller.knowledge.actions.importText}
            onNotice={workspace.setNotice}
            onOpenConnections={() => workspace.setSettingsSection("configuration")}
            onPersonalizationChange={controller.personalization.setSettings}
            onRefreshWorkspace={controller.data.refreshData}
            onUpdateKnowledgeDraft={controller.knowledge.actions.updateDraft}
            onUpdateKnowledgeDraftList={controller.knowledge.actions.updateDraftList}
          />}
        />
      ) : (
        <>
          {scope.kind === "sample" ? <SampleScenarioControls
            busy={busy} installedCount={installedCount} scope={scope} view={workspace.view} settingsSection={settingsMode ? workspace.settingsSection : undefined}
            onClear={onClearSamples} onExit={onExitSample} onInstallAll={onInstallAllSamples} onLoad={onLoadSample}
          /> : null}
          <ReviewWorkspaceCoreViews controller={controller} />
          <ReviewWorkspaceSecondaryViews controller={controller} />
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
