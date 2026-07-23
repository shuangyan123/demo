"use client";

import { KnowledgeView } from "../knowledge/knowledge-workspace";
import { EntryView } from "./review-entry-view";
import {
  AutomationView,
  ImportWorkspace,
  InterviewWorkspace,
  KnowledgeTrainingView,
  SettingsPluginsView,
  TutoringWorkspace,
} from "./review-workspace-lazy-views";
import type { ReviewWorkspaceController } from "./use-review-workspace-controller";

/** 渲染训练、知识和低频专项视图，保持业务依赖由 controller 注入。 */
export function ReviewWorkspaceSecondaryViews({ controller }: { controller: ReviewWorkspaceController }) {
  const { aiConnections, automation, conversation, data, knowledge, learning, personalization, workspace } = controller;
  const view = workspace.view;

  return (
    <>
      {view === "knowledgeTraining" ? (
        <KnowledgeTrainingView
          answerOpen={knowledge.snapshot.answerOpen}
          attemptsCount={data.knowledgeAttemptsCount}
          correctRate={knowledge.snapshot.correctRate}
          currentEntry={knowledge.snapshot.currentTraining}
          dueEntries={knowledge.snapshot.dueEntries}
          lowEntries={knowledge.snapshot.lowEntries}
          queueEntries={knowledge.snapshot.trainingQueue}
          queueFilter={knowledge.snapshot.queueFilter}
          trainingIndex={knowledge.snapshot.trainingIndex}
          onChangeQueueFilter={knowledge.actions.changeQueueFilter}
          onMove={knowledge.actions.moveTraining}
          onOpenKnowledgeEntry={knowledge.actions.openEntry}
          onRecordReview={knowledge.actions.recordTraining}
          onSkip={knowledge.actions.skipTraining}
          onSelectEntry={knowledge.actions.openTraining}
          onToggleAnswer={() => knowledge.actions.setAnswerOpen((value) => !value)}
        />
      ) : null}

      {view === "automation" ? (
        <AutomationView
          center={automation}
          onNotice={workspace.setNotice}
          onOpenEntry={() => workspace.switchView("entry")}
          onOpenImport={() => workspace.switchView("import")}
          onOpenKnowledge={() => workspace.switchView("knowledge")}
          onOpenSettings={() => workspace.openApiSettings("请先配置默认文本连接，再运行自动化")}
        />
      ) : null}

      {view === "knowledge" ? (
        <KnowledgeView
          aiAssociationBusy={knowledge.snapshot.associationBusy}
          apiReady={Boolean(aiConnections.textConnection)}
          associationLinks={knowledge.snapshot.selectedEntryAssociation.links}
          associationSuggestions={knowledge.snapshot.selectedEntryAssociation.suggestions}
          allKnowledgeEntries={data.knowledgeEntries}
          allMistakes={data.mistakes}
          entries={knowledge.snapshot.filteredEntries}
          filters={knowledge.snapshot.filters}
          internalization={knowledge.snapshot.internalization}
          relatedMistakes={knowledge.snapshot.selectedEntryMistakes}
          selectedEntry={knowledge.snapshot.selectedEntry}
          summaries={knowledge.snapshot.categorySummaries}
          tagOptions={knowledge.snapshot.tagOptions}
          onAddEntry={knowledge.actions.addEntry}
          onAnalyzeKnowledgeAssociations={knowledge.actions.analyzeEntry}
          onChangeFilters={knowledge.actions.setFilters}
          onClearAssociationSuggestions={(targetId) => knowledge.actions.clearSuggestions(targetId, "knowledge")}
          onConfirmAssociationSuggestions={() => knowledge.actions.confirmSuggestions(knowledge.snapshot.selectedEntryAssociation.suggestions)}
          onBulkDeleteEntries={knowledge.actions.deleteEntries}
          onDeleteAssociationSuggestion={knowledge.actions.deleteSuggestion}
          onDeleteEntry={knowledge.actions.deleteEntry}
          onExportKnowledgeEntries={knowledge.actions.exportItems}
          onOpenRelatedMistake={learning.actions.openMistake}
          onOpenSettings={() => workspace.openApiSettings("请先配置默认文本连接，再使用 AI 关联分析")}
          onRemoveAssociationLink={knowledge.actions.removeLink}
          onSelectEntry={knowledge.actions.setSelectedId}
          onStartTraining={knowledge.actions.openTraining}
          onCreateStarterDrafts={knowledge.actions.createStarterDrafts}
          onToggleFavorite={knowledge.actions.toggleFavorite}
          onToggleAssociationSuggestion={knowledge.actions.toggleSuggestion}
          onUpdateEntry={knowledge.actions.updateEntry}
          onKnowledgeChanged={workspace.health.refreshWorkspaceAndObsidianHealth}
          onNotice={workspace.setNotice}
          personalizationSettings={personalization.settings}
          textConnection={aiConnections.textConnection}
        />
      ) : null}

      {view === "interview" ? (
        <InterviewWorkspace
          textConnection={aiConnections.textConnection}
          knowledgeEntries={data.knowledgeEntries}
          mistakes={data.mistakes}
          personalizationSettings={personalization.settings}
          speechConnection={aiConnections.speechConnection}
          onNotice={workspace.setNotice}
          onOpenSettings={() => workspace.openApiSettings("请先配置默认文本连接，再使用 AI 模拟面试")}
        />
      ) : null}

      {view === "tutoring" ? (
        <TutoringWorkspace
          textConnection={aiConnections.textConnection}
          visionConnection={aiConnections.visionConnection}
          knowledgeEntries={data.knowledgeEntries}
          mistakes={data.mistakes}
          personalizationSettings={personalization.settings}
          onNotice={workspace.setNotice}
          onOpenConversation={conversation.openConversation}
        />
      ) : null}

      {view === "import" ? (
        <ImportWorkspace
          textConnection={aiConnections.textConnection}
          visionConnection={aiConnections.visionConnection}
          importJobs={data.importJobs}
          knowledgeDrafts={knowledge.snapshot.drafts}
          mistakes={data.mistakes}
          today={workspace.today}
          onConfirmKnowledgeDrafts={knowledge.actions.confirmDrafts}
          onDeleteKnowledgeDraft={knowledge.actions.deleteDraft}
          onImportKnowledgeText={knowledge.actions.importText}
          onRefreshWorkspace={data.refreshData}
          onSwitchSettings={() => workspace.switchView("settings")}
          onUpdateKnowledgeDraft={knowledge.actions.updateDraft}
          onUpdateKnowledgeDraftList={knowledge.actions.updateDraftList}
          setNotice={workspace.setNotice}
        />
      ) : null}

      {view === "plugins" ? (
        <SettingsPluginsView
          appearanceSettings={workspace.appearanceSettings}
          entries={data.knowledgeEntries}
          importJobs={data.importJobs}
          knowledgeDrafts={knowledge.snapshot.drafts}
          mistakes={data.mistakes}
          personalization={personalization.settings}
          textConnection={aiConnections.textConnection}
          visionConnection={aiConnections.visionConnection}
          today={workspace.today}
          onChanged={data.refreshData}
          onAppearanceChange={workspace.updateAppearanceSettings}
          onConfirmKnowledgeDrafts={knowledge.actions.confirmDrafts}
          onDeleteKnowledgeDraft={knowledge.actions.deleteDraft}
          onImportKnowledgeText={knowledge.actions.importText}
          onNotice={workspace.setNotice}
          onOpenConnections={() => workspace.openApiSettings("在 AI 连接中配置插件所需的模型能力")}
          onPersonalizationChange={personalization.setSettings}
          onRefreshWorkspace={data.refreshData}
          onUpdateKnowledgeDraft={knowledge.actions.updateDraft}
          onUpdateKnowledgeDraftList={knowledge.actions.updateDraftList}
        />
      ) : null}

      {view === "entry" ? <EntryView onSubmit={learning.actions.addMistake} /> : null}
    </>
  );
}
