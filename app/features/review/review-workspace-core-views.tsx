"use client";

import { LearningDataExplorer } from "./learning-data-explorer";
import { DashboardView } from "./review-dashboard-view";
import { LibraryView } from "./review-library-view";
import { ReviewView } from "./review-session-view";
import { StatsView } from "./review-stats-view";
import { ConversationWorkspace } from "./review-workspace-lazy-views";
import type { ReviewWorkspaceController } from "./use-review-workspace-controller.ts";
import { toISODate } from "../../lib/review-utils";

/** 渲染总览、错题、复盘和历史统计等首屏核心路径。 */
export function ReviewWorkspaceCoreViews({ controller }: { controller: ReviewWorkspaceController }) {
  const { aiConnections, automation, conversation, data, knowledge, learning, personalization, workspace } = controller;
  const view = workspace.view;

  return (
    <>
      {view === "conversation" ? (
        <ConversationWorkspace
          key={conversation.activeConversationId ?? conversation.launchContext?.id ?? "blank-conversation"}
          activeConversationId={conversation.activeConversationId}
          connections={aiConnections.snapshot.profiles}
          defaultSelections={{
            text: { connectionId: aiConnections.snapshot.defaults.textConnectionId, modelId: aiConnections.snapshot.defaults.textModelId },
            vision: { connectionId: aiConnections.snapshot.defaults.visionConnectionId, modelId: aiConnections.snapshot.defaults.visionModelId },
          }}
          knowledgeEntries={data.knowledgeEntries}
          launchContext={conversation.launchContext}
          personalization={personalization.settings}
          scheduledCount={automation.snapshot.definitions.filter((definition) => definition.enabled).length}
          snapshot={conversation.snapshot}
          transcriptionConnection={aiConnections.snapshot.profiles.find((connection) => connection.id === aiConnections.snapshot.defaults.transcriptionConnectionId)}
          sampleMode={workspace.scope.kind === "sample"}
          onConversationSelected={conversation.setActiveConversationId}
          onCreateConversation={conversation.createForFirstMessage}
          onNotice={workspace.setNotice}
          onPersonalizationChange={personalization.setSettings}
          onClearLaunchContext={() => conversation.setLaunchContext(null)}
          onOpenConnections={() => workspace.openApiSettings("请先配置默认文本连接，再继续使用对话")}
          onOpenKnowledge={() => workspace.switchView("knowledge")}
          onOpenTutoringRecords={() => workspace.switchView("tutoring")}
          onRefresh={conversation.refresh}
        />
      ) : null}

      {view === "dashboard" ? (
        <DashboardView
          avgMastery={learning.snapshot.avgMastery}
          automationActiveCount={automation.snapshot.definitions.filter((definition) => definition.enabled).length}
          automationUnreadCount={automation.snapshot.unreadCount}
          boardStats={learning.snapshot.boardStats}
          configurationHealth={workspace.health.configurationHealth}
          correctRate={learning.snapshot.correctRate}
          dateLabel={toISODate(workspace.today)}
          dueKnowledgeEntries={knowledge.snapshot.dueEntries}
          dueMistakes={learning.snapshot.dueMistakes}
          importDraftCount={knowledge.snapshot.drafts.length}
          importJobCount={data.importJobs.length}
          knowledgeCategorySummaries={knowledge.snapshot.categorySummaries}
          knowledgeCorrectRate={knowledge.snapshot.correctRate}
          lowMistakes={learning.snapshot.lowMistakes}
          learnerState={data.learnerState}
          notice={workspace.notice}
          obsidianConnected={workspace.health.obsidianSnapshot.connected}
          pendingProposalCount={workspace.health.obsidianSnapshot.pendingProposalCount}
          onConfigurationHealthAction={workspace.openConfigurationHealthAction}
          onOpenAutomation={() => workspace.switchView("automation")}
          onOpenBoard={learning.actions.openBoard}
          onOpenImport={() => workspace.switchView("import")}
          onOpenKnowledge={() => workspace.switchView("knowledge")}
          onOpenInterview={() => workspace.switchView("interview")}
          onOpenTutoring={() => conversation.openBlank({
            id: crypto.randomUUID(),
            moduleId: "conversation",
            moduleLabel: "对话辅导",
            kind: "tutoring",
            sourceType: "manual",
            sourceId: "new-tutoring",
            title: "AI 辅导",
            summary: "从公考总览进入对话辅导，可按需调用摄像头、屏幕共享、截图和知识库检索工具。",
            suggestedPrompt: "我想开始一轮 AI 辅导，请先询问我的学习目标和当前卡点。",
          })}
          onOpenKnowledgeCategory={knowledge.actions.openCategory}
          onOpenKnowledgeTraining={knowledge.actions.openTraining}
          onCreateKnowledgeStarterDrafts={knowledge.actions.createStarterDrafts}
          onOpenReviewQueue={() => learning.actions.openReview()}
          onOpenReview={learning.actions.openReview}
          onOpenLearningAction={(action) => {
            const targetId = action.destination.targetIds?.[0];
            if (action.destination.module === "review") learning.actions.openReview(targetId);
            if (action.destination.module === "library") {
              const mistake = data.mistakes.find((item) => item.id === targetId);
              if (mistake) learning.actions.openMistake(mistake);
              else workspace.switchView("library");
            }
            if (action.destination.module === "knowledgeTraining") knowledge.actions.openTraining(targetId);
            if (action.destination.module === "tutoring") workspace.switchView("tutoring");
            if (action.destination.module === "interview") workspace.switchView("interview");
          }}
        />
      ) : null}

      {view === "library" ? (
        <>
          <LearningDataExplorer
          attempts={learning.snapshot.attempts}
          knowledgeEntries={data.knowledgeEntries}
          mistakes={data.mistakes}
          onOpenKnowledgeOperations={() => workspace.switchView("knowledge")}
          onOpenKnowledgeTraining={knowledge.actions.openTraining}
          onOpenReview={learning.actions.openReview}
          onRefresh={data.refreshData}
          onStartConversation={conversation.openBlank}
          managementContent={(
            <LibraryView
              aiAssociationBusy={knowledge.snapshot.associationBusy}
              apiReady={Boolean(aiConnections.textConnection)}
              associationLinks={knowledge.snapshot.selectedMistakeAssociation.links}
              associationSuggestions={knowledge.snapshot.selectedMistakeAssociation.suggestions}
              boardStats={learning.snapshot.boardStats}
              filteredMistakes={learning.snapshot.filteredMistakes}
              filters={learning.snapshot.filters}
              knowledgeEntries={data.knowledgeEntries}
              mistakes={data.mistakes}
              relatedKnowledge={knowledge.snapshot.selectedMistakeKnowledge}
              reasonFilter={learning.snapshot.reasonFilter}
              reasonOptions={learning.snapshot.reasonOptions}
              selectedBoard={learning.snapshot.selectedBoard}
              selectedId={learning.snapshot.activeSelectedId}
              selectedMistake={learning.snapshot.selectedMistake}
              setFilters={learning.actions.setFilters}
              setReasonFilter={learning.actions.setReasonFilter}
              setSelectedBoard={learning.actions.setSelectedBoard}
              setSelectedId={learning.actions.setSelectedId}
              setTagFilter={learning.actions.setTagFilter}
              tagFilter={learning.snapshot.tagFilter}
              tagOptions={learning.snapshot.tagOptions}
              onAnalyzeMistakeAssociations={knowledge.actions.analyzeMistake}
              onBulkDeleteMistakes={learning.actions.deleteMistakes}
              onClearAssociationSuggestions={(targetId) => knowledge.actions.clearSuggestions(targetId, "mistake")}
              onConfirmAssociationSuggestions={() => knowledge.actions.confirmSuggestions(knowledge.snapshot.selectedMistakeAssociation.suggestions)}
              onCreateKnowledgeDraft={knowledge.actions.createDraftFromMistake}
              onDeleteAssociationSuggestion={knowledge.actions.deleteSuggestion}
              onDeleteMistake={learning.actions.deleteMistake}
              onExportMistakes={learning.actions.exportItems}
              onOpenKnowledgeEntry={knowledge.actions.openEntry}
              onOpenSettings={() => workspace.openApiSettings("请先配置默认文本连接，再使用 AI 关联分析")}
              onRemoveAssociationLink={knowledge.actions.removeLink}
              onToggleAssociationSuggestion={knowledge.actions.toggleSuggestion}
            />
          )}
          />
        </>
      ) : null}

      {view === "review" ? (
        <>
          <ReviewView
          answerOpen={learning.snapshot.answerOpen}
          associatedKnowledge={knowledge.snapshot.currentReviewLinkedEntries}
          currentReview={learning.snapshot.currentReview}
          dueMistakes={learning.snapshot.dueMistakes}
          relatedKnowledge={knowledge.snapshot.currentReviewKnowledge}
          reviewIndex={learning.snapshot.reviewIndex}
          timer={learning.snapshot.timer}
          onCreateKnowledgeDraft={knowledge.actions.createDraftFromMistake}
          onOpenKnowledgeEntry={knowledge.actions.openEntry}
          onRecordReview={learning.actions.recordReview}
          onToggleAnswer={() => learning.actions.setAnswerOpen((value) => !value)}
          />
        </>
      ) : null}

      {view === "stats" ? (
        <StatsView
          attempts={data.attempts}
          knowledgeEntries={data.knowledgeEntries}
          mistakes={data.mistakes}
          onOpenKnowledgeTraining={knowledge.actions.openTraining}
          onOpenReview={learning.actions.openReview}
          onRefresh={data.refreshData}
        />
      ) : null}
    </>
  );
}
