"use client";

import { useEffect, useMemo, useState } from "react";
import { useAutomationCenter } from "../automation/use-automation-center";
import { useAiConnections } from "../settings/use-ai-connections";
import { usePersonalizationSettings } from "../settings/use-personalization-settings";
import { useWorkspaceNavigation } from "../shared/use-workspace-navigation";
import { useWorkspaceSidebar } from "../shared/use-workspace-sidebar";
import {
  appearanceSettingsRepository,
  applyAppearanceSettings,
  createDefaultAppearanceSettings,
} from "../../services/appearance-settings-repository";
import { makeToday } from "../../lib/review-utils";
import type { AppearanceSettings } from "../../types/domains/appearance.ts";
import type { ViewKey } from "../../types/domains/workspace.ts";
import { useReviewConversationController } from "./use-review-conversation-controller.ts";
import { useReviewKnowledgeController } from "./use-review-knowledge-controller.ts";
import { useReviewLearningController } from "./use-review-learning-controller.ts";
import { useReviewNotice } from "./use-review-notice.ts";
import { useReviewWorkspaceData } from "./use-review-workspace-data.ts";
import { useReviewWorkspaceHealth } from "./use-review-workspace-health.ts";
import { useReviewWorkspaceRecoveryNavigation } from "./use-review-workspace-recovery-navigation.ts";

/** 组合领域 controller 与跨模块依赖；展示结构由独立 view router 负责。 */
export function useReviewWorkspaceController() {
  const [today] = useState(() => makeToday());
  const { markReadFailed, markSynced, notice, setNotice } = useReviewNotice();
  const dataNotice = useMemo(() => ({ onReadFailed: markReadFailed, onSynced: markSynced }), [markReadFailed, markSynced]);
  const data = useReviewWorkspaceData(today, dataNotice);
  const aiConnections = useAiConnections(setNotice);
  const personalization = usePersonalizationSettings(setNotice);
  const automation = useAutomationCenter({
    connection: aiConnections.textConnection,
    aiSnapshot: aiConnections.snapshot,
    personalization: personalization.settings,
    onChanged: data.refreshData,
    onNotice: setNotice,
  });
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(() => createDefaultAppearanceSettings());
  const { lastAppView, switchView: navigateView, view } = useWorkspaceNavigation<ViewKey>("dashboard", "settings");
  const { sidebarCollapsed, toggleSidebar } = useWorkspaceSidebar();

  const {
    openApiSettings,
    openConfigurationHealthAction,
    openDiagnosticsTarget,
    openMcpSettings,
    resetSettingsSection,
    setSettingsSection,
    settingsSection,
  } = useReviewWorkspaceRecoveryNavigation({ setNotice, switchView });

  const learning = useReviewLearningController({
    attempts: data.attempts,
    attemptsCount: data.attemptsCount,
    correctCount: data.correctCount,
    mistakes: data.mistakes,
    onNotice: setNotice,
    onRefresh: data.refreshData,
    onSelectView: navigateView,
    today,
  });

  const knowledge = useReviewKnowledgeController({
    associationLinks: data.associationLinks,
    currentReview: learning.snapshot.currentReview,
    entries: data.knowledgeEntries,
    knowledgeAttemptsCount: data.knowledgeAttemptsCount,
    knowledgeCorrectCount: data.knowledgeCorrectCount,
    mistakes: data.mistakes,
    onNotice: setNotice,
    onOpenApiSettings: openApiSettings,
    onRefresh: data.refreshData,
    onSelectView: navigateView,
    personalization: personalization.settings,
    selectedMistake: learning.snapshot.selectedMistake,
    textConnection: aiConnections.textConnection,
    today,
  });

  const conversation = useReviewConversationController({
    automationSnapshot: automation.snapshot,
    knowledgeEntries: data.knowledgeEntries,
    mistakes: data.mistakes,
    onNotice: setNotice,
    onOpenApiSettings: openApiSettings,
    onOpenMcpSettings: openMcpSettings,
    onSwitchView: switchView,
    today,
  });

  const health = useReviewWorkspaceHealth({
    aiReadError: aiConnections.readError,
    aiSnapshot: aiConnections.snapshot,
    automationSnapshot: automation.snapshot,
    dataReadError: data.readError,
    dueKnowledgeCount: knowledge.snapshot.dueEntries.length,
    dueMistakeCount: learning.snapshot.dueMistakes.length,
    importJobs: data.importJobs,
    knowledgeEntries: data.knowledgeEntries,
    mistakes: data.mistakes,
    refreshData: data.refreshData,
  });

  useEffect(() => {
    let active = true;
    appearanceSettingsRepository.load().then((settings) => {
      if (!active) return;
      setAppearanceSettings(settings);
      applyAppearanceSettings(settings);
    }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "外观设置读取失败");
    });
    return () => {
      active = false;
    };
  }, [setNotice]);

  useEffect(() => {
    applyAppearanceSettings(appearanceSettings);
    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleSystemAppearanceChange = () => applyAppearanceSettings(appearanceSettings);
    colorSchemeQuery.addEventListener("change", handleSystemAppearanceChange);
    reducedMotionQuery.addEventListener("change", handleSystemAppearanceChange);
    return () => {
      colorSchemeQuery.removeEventListener("change", handleSystemAppearanceChange);
      reducedMotionQuery.removeEventListener("change", handleSystemAppearanceChange);
    };
  }, [appearanceSettings]);

  function switchView(nextView: ViewKey) {
    navigateView(nextView);
    if (nextView === "review") learning.actions.resetReview();
    if (nextView === "knowledgeTraining") knowledge.actions.resetTraining();
  }

  function updateAppearanceSettings(nextSettings: AppearanceSettings) {
    setAppearanceSettings(nextSettings);
    applyAppearanceSettings(nextSettings);
    void appearanceSettingsRepository.save(nextSettings).then((savedSettings) => {
      setAppearanceSettings(savedSettings);
      applyAppearanceSettings(savedSettings);
      setNotice("外观设置已保存");
    }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "外观设置保存失败");
    });
  }

  async function refreshAfterDataManagement() {
    knowledge.actions.setDrafts([]);
    await Promise.all([data.refreshData(), conversation.refresh(), aiConnections.refresh(), personalization.refresh()]);
  }

  return {
    aiConnections,
    automation,
    conversation,
    data,
    knowledge,
    learning,
    personalization,
    workspace: {
      appearanceSettings,
      health,
      lastAppView,
      loading: data.loading,
      notice,
      openApiSettings,
      openConfigurationHealthAction,
      openDiagnosticsTarget,
      refreshAfterDataManagement,
      resetSettingsSection,
      setNotice,
      setSettingsSection,
      settingsSection,
      sidebarCollapsed,
      switchView,
      today,
      toggleSidebar,
      updateAppearanceSettings,
      view,
    },
  };
}

export type ReviewWorkspaceController = ReturnType<typeof useReviewWorkspaceController>;
