"use client";

import { useCallback, useMemo } from "react";
import packageJson from "../../../package.json";
import { useConfigurationHealth } from "../onboarding/use-configuration-health";
import type { LocalDiagnosticsHookInput } from "../diagnostics/use-local-diagnostics";
import type { AiConnectionSnapshot } from "../../types/domains/ai-connection.ts";
import type { AutomationSnapshot } from "../../types/domains/automation.ts";
import type { ImportJob } from "../../types/domains/import.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { Mistake } from "../../types/domains/review.ts";

type ReviewWorkspaceHealthInput = {
  aiReadError?: string;
  aiSnapshot: AiConnectionSnapshot;
  automationSnapshot: AutomationSnapshot;
  dataReadError?: string;
  dueKnowledgeCount: number;
  dueMistakeCount: number;
  importJobs: ImportJob[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  refreshData: () => Promise<void>;
};

// 汇总总览健康检查和设置页诊断所需的只读快照，避免主工作台直接拼装跨模块输入。
export function useReviewWorkspaceHealth(input: ReviewWorkspaceHealthInput) {
  const {
    aiReadError,
    aiSnapshot,
    automationSnapshot,
    dataReadError,
    dueKnowledgeCount,
    dueMistakeCount,
    importJobs,
    knowledgeEntries,
    mistakes,
    refreshData,
  } = input;
  const configurationHealthInput = useMemo(
    () => ({
      aiSnapshot,
      automationSnapshot,
      dueKnowledgeCount,
      dueMistakeCount,
      importJobs,
      knowledgeEntries,
      mistakes,
    }),
    [aiSnapshot, automationSnapshot, dueKnowledgeCount, dueMistakeCount, importJobs, knowledgeEntries, mistakes],
  );
  const { health: configurationHealth, obsidianSnapshot, refreshObsidianHealth } = useConfigurationHealth(configurationHealthInput);

  const diagnosticsInput = useMemo<LocalDiagnosticsHookInput>(
    () => ({
      aiReadError,
      aiSnapshot,
      appVersion: packageJson.version,
      automationSnapshot,
      dataReadError,
      importJobs,
      knowledgeEntryCount: knowledgeEntries.length,
      mistakeCount: mistakes.length,
    }),
    [aiReadError, aiSnapshot, automationSnapshot, dataReadError, importJobs, knowledgeEntries.length, mistakes.length],
  );

  const refreshWorkspaceAndObsidianHealth = useCallback(async () => {
    await refreshData();
    await refreshObsidianHealth();
  }, [refreshData, refreshObsidianHealth]);

  return { configurationHealth, diagnosticsInput, obsidianSnapshot, refreshWorkspaceAndObsidianHealth };
}
