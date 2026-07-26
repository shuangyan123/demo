import Dexie, { type Table } from "dexie";
import type { AiConnectionDefaults, ApiConnectionProfile, ApiSetting } from "../types/domains/ai-connection.ts";
import type { AiConversation, AiConversationAttachment, AiConversationFolder, AiConversationMessage, AiConversationRunStep, AiProject } from "../types/domains/conversation.ts";
import type { AppearanceSettings } from "../types/domains/appearance.ts";
import type { Attempt, Mistake } from "../types/domains/review.ts";
import type { AutomationDefinition, AutomationRun } from "../types/domains/automation.ts";
import type { ImportBatch, ImportJob, PersistedImportDraft } from "../types/domains/import.ts";
import type { InterviewEvaluation, InterviewLink, InterviewPracticePlan, InterviewQuestion, InterviewQuestionSet, InterviewSession, InterviewTurn } from "../types/domains/interview.ts";
import type { KnowledgeAttempt, KnowledgeEntry, KnowledgeInternalizationDraft } from "../types/domains/knowledge.ts";
import type { KnowledgeEvolutionProposal, ObsidianNoteMapping, ObsidianVaultConfig } from "../types/domains/obsidian.ts";
import type { KnowledgeMistakeLink } from "../types/domains/association.ts";
import type { PersonalizationSettings } from "../types/domains/personalization.ts";
import type { TutoringLink, TutoringPlan, TutoringSession, TutoringTurn } from "../types/domains/tutoring.ts";
import { createProfileFromLegacySetting } from "../services/legacy-ai-settings-migration.ts";
import { migrateToV16, REVIEW_DB_NAME } from "./review-db-migrations.ts";

// 定义错题复盘应用使用的 IndexedDB 数据库表结构。
class ReviewDexieDatabase extends Dexie {
  mistakes!: Table<Mistake, string>;
  attempts!: Table<Attempt, string>;
  importJobs!: Table<ImportJob, string>;
  apiSettings!: Table<ApiSetting, string>;
  apiConnectionProfiles!: Table<ApiConnectionProfile, string>;
  apiConnectionDefaults!: Table<AiConnectionDefaults, string>;
  appearanceSettings!: Table<AppearanceSettings, string>;
  personalizationSettings!: Table<PersonalizationSettings, string>;
  knowledgeEntries!: Table<KnowledgeEntry, string>;
  knowledgeAttempts!: Table<KnowledgeAttempt, string>;
  knowledgeMistakeLinks!: Table<KnowledgeMistakeLink, string>;
  knowledgeInternalizationDrafts!: Table<KnowledgeInternalizationDraft, string>;
  importBatches!: Table<ImportBatch, string>;
  importDrafts!: Table<PersistedImportDraft, string>;
  interviewQuestions!: Table<InterviewQuestion, string>;
  interviewQuestionSets!: Table<InterviewQuestionSet, string>;
  interviewPracticePlans!: Table<InterviewPracticePlan, string>;
  interviewSessions!: Table<InterviewSession, string>;
  interviewTurns!: Table<InterviewTurn, string>;
  interviewEvaluations!: Table<InterviewEvaluation, string>;
  interviewLinks!: Table<InterviewLink, string>;
  tutoringSessions!: Table<TutoringSession, string>;
  tutoringTurns!: Table<TutoringTurn, string>;
  tutoringPlans!: Table<TutoringPlan, string>;
  tutoringLinks!: Table<TutoringLink, string>;
  obsidianVaultConfigs!: Table<ObsidianVaultConfig, string>;
  obsidianNoteMappings!: Table<ObsidianNoteMapping, string>;
  knowledgeEvolutionProposals!: Table<KnowledgeEvolutionProposal, string>;
  automationDefinitions!: Table<AutomationDefinition, string>;
  automationRuns!: Table<AutomationRun, string>;
  aiProjects!: Table<AiProject, string>;
  aiConversationFolders!: Table<AiConversationFolder, string>;
  aiConversations!: Table<AiConversation, string>;
  aiConversationAttachments!: Table<AiConversationAttachment, string>;
  aiConversationMessages!: Table<AiConversationMessage, string>;
  aiConversationRunSteps!: Table<AiConversationRunStep, string>;

  // 初始化 Dexie 数据库版本；历史版本保留用于旧数据无损升级。
  constructor() {
    super(REVIEW_DB_NAME);
    this.version(2).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
    });
    this.version(3).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
    });
    this.version(4).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, updatedAt, createdAt",
    });
    this.version(5).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
    });
    this.version(6).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, [mistakeId+knowledgeId], updatedAt, createdAt",
    });
    this.version(7).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, [mistakeId+knowledgeId], updatedAt, createdAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
    });
    this.version(8).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, [mistakeId+knowledgeId], updatedAt, createdAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, createdAt, updatedAt",
      interviewSessions: "&id, questionId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
    });
    this.version(9).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, [mistakeId+knowledgeId], updatedAt, createdAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
    });
    this.version(10).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      appearanceSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, [mistakeId+knowledgeId], updatedAt, createdAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
      tutoringTurns: "&id, sessionId, speaker, createdAt",
      tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
      tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
    });
    this.version(11)
      .stores({
        mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
        attempts: "&id, mistakeId, reviewedAt, result",
        importJobs: "&id, type, status, createdAt",
        apiSettings: "&id, provider, updatedAt",
        apiConnectionProfiles: "&id, provider, updatedAt, createdAt",
        apiConnectionDefaults: "&id, updatedAt",
        appearanceSettings: "&id, updatedAt",
        personalizationSettings: "&id, updatedAt",
        knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
        knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
        knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, kind, [mistakeId+knowledgeId], updatedAt, createdAt",
        knowledgeInternalizationDrafts: "&id, mode, targetKnowledgeId, createdAt, updatedAt",
        importBatches: "&id, source, status, createdAt, updatedAt",
        importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
        interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
        interviewQuestionSets: "&id, type, createdAt, updatedAt",
        interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
        interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
        interviewTurns: "&id, sessionId, stage, createdAt",
        interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
        interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
        tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
        tutoringTurns: "&id, sessionId, speaker, createdAt",
        tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
        tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      })
      .upgrade(async (transaction) => {
        // 历史普通关联没有 kind 字段，升级后统一标记为 related。
        await transaction.table<KnowledgeMistakeLink, string>("knowledgeMistakeLinks").toCollection().modify((link) => {
          link.kind = link.kind ?? "related";
        });

        // 把旧版单连接配置复制成 v11 连接档案，旧表继续保留作为兼容桥。
        const legacySetting = await transaction.table<ApiSetting, string>("apiSettings").get("default");
        if (!legacySetting) return;
        const profile = createProfileFromLegacySetting(legacySetting);
        await transaction.table<ApiConnectionProfile, string>("apiConnectionProfiles").put(profile);
        await transaction.table<AiConnectionDefaults, string>("apiConnectionDefaults").put({
          id: "default",
          textConnectionId: profile.id,
          visionConnectionId: profile.capabilities.includes("vision") ? profile.id : undefined,
          speechConnectionId: profile.capabilities.includes("speech") ? profile.id : undefined,
          updatedAt: legacySetting.updatedAt,
        });
      });
    this.version(12).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      apiConnectionProfiles: "&id, provider, updatedAt, createdAt",
      apiConnectionDefaults: "&id, updatedAt",
      appearanceSettings: "&id, updatedAt",
      personalizationSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, kind, [mistakeId+knowledgeId], updatedAt, createdAt",
      knowledgeInternalizationDrafts: "&id, mode, targetKnowledgeId, createdAt, updatedAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
      tutoringTurns: "&id, sessionId, speaker, createdAt",
      tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
      tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      obsidianVaultConfigs: "&id, updatedAt",
      obsidianNoteMappings: "&path, &knowledgeId, category, status, updatedAt",
      knowledgeEvolutionProposals: "&id, mode, status, sourceType, targetKnowledgeId, createdAt, updatedAt",
    });
    this.version(13).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      apiConnectionProfiles: "&id, provider, updatedAt, createdAt",
      apiConnectionDefaults: "&id, updatedAt",
      appearanceSettings: "&id, updatedAt",
      personalizationSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, kind, [mistakeId+knowledgeId], updatedAt, createdAt",
      knowledgeInternalizationDrafts: "&id, mode, targetKnowledgeId, createdAt, updatedAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
      tutoringTurns: "&id, sessionId, speaker, createdAt",
      tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
      tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      obsidianVaultConfigs: "&id, updatedAt",
      obsidianNoteMappings: "&path, &knowledgeId, category, status, updatedAt",
      knowledgeEvolutionProposals: "&id, mode, status, sourceType, targetKnowledgeId, createdAt, updatedAt",
      automationDefinitions: "&id, enabled, nextRunAt, updatedAt",
      automationRuns: "&id, automationId, status, unread, scheduledAt, createdAt, [automationId+scheduledAt]",
    });
    this.version(14).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      apiConnectionProfiles: "&id, provider, updatedAt, createdAt",
      apiConnectionDefaults: "&id, updatedAt",
      appearanceSettings: "&id, updatedAt",
      personalizationSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, kind, [mistakeId+knowledgeId], updatedAt, createdAt",
      knowledgeInternalizationDrafts: "&id, mode, targetKnowledgeId, createdAt, updatedAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
      tutoringTurns: "&id, sessionId, speaker, createdAt",
      tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
      tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+sourceId], [targetType+targetId], createdAt, updatedAt",
      obsidianVaultConfigs: "&id, updatedAt",
      obsidianNoteMappings: "&path, &knowledgeId, category, status, updatedAt",
      knowledgeEvolutionProposals: "&id, mode, status, sourceType, targetKnowledgeId, createdAt, updatedAt",
      automationDefinitions: "&id, enabled, nextRunAt, updatedAt",
      automationRuns: "&id, automationId, status, unread, scheduledAt, createdAt, [automationId+scheduledAt]",
      aiProjects: "&id, studyDomainId, updatedAt, createdAt",
      aiConversations: "&id, projectId, studyDomainId, kind, status, updatedAt, createdAt, [projectId+updatedAt]",
      aiConversationAttachments: "&id, conversationId, messageId, kind, createdAt",
      aiConversationMessages: "&id, conversationId, role, createdAt",
      aiConversationRunSteps: "&id, conversationId, runId, state, updatedAt",
    });
    this.version(15).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      apiConnectionProfiles: "&id, provider, updatedAt, createdAt",
      apiConnectionDefaults: "&id, updatedAt",
      appearanceSettings: "&id, updatedAt",
      personalizationSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, kind, [mistakeId+knowledgeId], updatedAt, createdAt",
      knowledgeInternalizationDrafts: "&id, mode, targetKnowledgeId, createdAt, updatedAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+targetId], createdAt, updatedAt",
      tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
      tutoringTurns: "&id, sessionId, speaker, createdAt",
      tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
      tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+targetId], createdAt, updatedAt",
      obsidianVaultConfigs: "&id, updatedAt",
      obsidianNoteMappings: "&path, &knowledgeId, category, status, updatedAt",
      knowledgeEvolutionProposals: "&id, mode, status, sourceType, targetKnowledgeId, createdAt, updatedAt",
      automationDefinitions: "&id, enabled, nextRunAt, updatedAt",
      automationRuns: "&id, automationId, status, unread, scheduledAt, createdAt, [automationId+scheduledAt]",
      aiProjects: "&id, studyDomainId, updatedAt, createdAt",
      aiConversationFolders: "&id, projectId, parentId, updatedAt, [projectId+parentId+sortOrder]",
      aiConversations: "&id, projectId, folderId, selectedConnectionId, studyDomainId, kind, status, updatedAt, createdAt, [projectId+folderId+updatedAt]",
      aiConversationAttachments: "&id, conversationId, messageId, kind, createdAt",
      aiConversationMessages: "&id, conversationId, role, createdAt",
      aiConversationRunSteps: "&id, conversationId, runId, state, updatedAt",
    });
    this.version(16).stores({
      mistakes: "&id, board, nextReviewAt, mastery, createdAt, updatedAt",
      attempts: "&id, mistakeId, reviewedAt, result",
      importJobs: "&id, type, status, createdAt",
      apiSettings: "&id, provider, updatedAt",
      apiConnectionProfiles: "&id, provider, updatedAt, createdAt",
      apiConnectionDefaults: "&id, updatedAt",
      appearanceSettings: "&id, updatedAt",
      personalizationSettings: "&id, updatedAt",
      knowledgeEntries: "&id, category, favorite, nextReviewAt, mastery, updatedAt, createdAt",
      knowledgeAttempts: "&id, knowledgeId, reviewedAt, result",
      knowledgeMistakeLinks: "&id, mistakeId, knowledgeId, kind, [mistakeId+knowledgeId], updatedAt, createdAt",
      knowledgeInternalizationDrafts: "&id, mode, targetKnowledgeId, createdAt, updatedAt",
      importBatches: "&id, source, status, createdAt, updatedAt",
      importDrafts: "&id, batchId, board, selected, needsReview, createdAt, updatedAt",
      interviewQuestions: "&id, type, difficulty, favorite, lastPracticedAt, practiceCount, createdAt, updatedAt",
      interviewQuestionSets: "&id, type, createdAt, updatedAt",
      interviewPracticePlans: "&id, type, status, sourceSetId, nextPracticeAt, createdAt, updatedAt",
      interviewSessions: "&id, questionId, planId, type, status, stage, createdAt, updatedAt",
      interviewTurns: "&id, sessionId, stage, createdAt",
      interviewEvaluations: "&id, sessionId, type, createdAt, updatedAt",
      interviewLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+targetId], createdAt, updatedAt",
      tutoringSessions: "&id, mode, status, startedAt, completedAt, createdAt, updatedAt",
      tutoringTurns: "&id, sessionId, speaker, createdAt",
      tutoringPlans: "&id, status, nextPracticeAt, createdAt, updatedAt",
      tutoringLinks: "&id, sourceType, sourceId, targetType, targetId, [sourceType+targetId], createdAt, updatedAt",
      obsidianVaultConfigs: "&id, updatedAt",
      obsidianNoteMappings: "&path, &knowledgeId, category, status, updatedAt",
      knowledgeEvolutionProposals: "&id, mode, status, sourceType, targetKnowledgeId, createdAt, updatedAt",
      automationDefinitions: "&id, enabled, nextRunAt, updatedAt",
      automationRuns: "&id, automationId, status, unread, scheduledAt, createdAt, [automationId+scheduledAt]",
      aiProjects: "&id, studyDomainId, updatedAt, createdAt",
      aiConversationFolders: "&id, projectId, parentId, updatedAt, [projectId+parentId+sortOrder]",
      aiConversations: "&id, projectId, folderId, selectedConnectionId, studyDomainId, kind, status, updatedAt, createdAt, [projectId+folderId+updatedAt]",
      aiConversationAttachments: "&id, conversationId, messageId, kind, createdAt",
      aiConversationMessages: "&id, conversationId, role, createdAt",
      aiConversationRunSteps: "&id, conversationId, runId, state, updatedAt",
    }).upgrade(migrateToV16);
  }
}

// 导出单例数据库，保证各 repository 共享同一条 IndexedDB 连接。
export const reviewDb = new ReviewDexieDatabase();
