"use client";

import { useCallback, useEffect, useState } from "react";
import { PERSONAL_WORKSPACE_DATA_SCOPE, type WorkspaceDataScope } from "../../services/workspace-data-scope";
import { getSampleScenario, type SampleScenarioId } from "../shared/sample-scenario-registry";
import type { UiReviewPackId } from "../shared/ui-review-scenario-registry.ts";
import { setUiReviewRuntimeActive } from "../../services/ui-review-runtime-guard.ts";

const PACK_SCENARIOS: Record<UiReviewPackId, readonly SampleScenarioId[]> = {
  learning: ["dashboard-normal", "library-normal", "review-normal", "knowledge-normal", "knowledge-training-normal", "stats-normal", "library-insights-dense"],
  conversation: ["conversation-normal"],
  import: ["import-normal", "import-needs-review", "import-console-mixed"],
  automation: ["automation-normal", "automation-failed"],
  interview: ["interview-active", "interview-completed", "interview-cancelled"],
  tutoring: ["tutoring-active"],
  settings: ["settings-ai-credential-recovery", "settings-ai-connections-dense"],
  integrations: ["plugins-directory-dense"],
};

/** UI 审查数据写入真实本地表；只用稳定命名空间区分和清理，不切换数据作用域。 */
export function useReviewWorkspaceSampleScope() {
  const [scope] = useState<WorkspaceDataScope>(PERSONAL_WORKSPACE_DATA_SCOPE);
  const [controllerKey, setControllerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installedCount, setInstalledCount] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);

  const refreshCount = useCallback(async () => {
    const { sampleScenarioRepository } = await import("../../services/sample-scenario-repository");
    const { uiReviewSettingsRepository } = await import("../../services/ui-review-settings-repository");
    const count = await sampleScenarioRepository.countAll() + await uiReviewSettingsRepository.count();
    setInstalledCount(count);
    setUiReviewRuntimeActive(count > 0);
    setReviewReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshCount(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (!reviewReady) return;
    let active = true;
    let stop: (() => Promise<void>) | undefined;
    void import("../../services/obsidian-sync-runtime.ts").then(({ obsidianSyncRuntime }) => {
      stop = () => obsidianSyncRuntime.stop();
      if (!active || installedCount > 0) return obsidianSyncRuntime.stop();
      return obsidianSyncRuntime.start();
    });
    return () => {
      active = false;
      void stop?.();
    };
  }, [installedCount, reviewReady]);

  const installScenarios = useCallback(async (scenarioIds: readonly SampleScenarioId[]) => {
    setBusy(true);
    try {
      const { sampleScenarioRepository } = await import("../../services/sample-scenario-repository");
      const { uiReviewSettingsRepository } = await import("../../services/ui-review-settings-repository");
      for (const scenarioId of scenarioIds) {
        const scenario = getSampleScenario(scenarioId);
        if (scenario?.fixtureOwner === "settings") await uiReviewSettingsRepository.seedScenario(scenarioId as Parameters<typeof uiReviewSettingsRepository.seedScenario>[0]);
        else await sampleScenarioRepository.seed(scenarioId);
      }
      await refreshCount();
      setControllerKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, [refreshCount]);

  const loadSample = useCallback(async (scenarioId: SampleScenarioId) => {
    await installScenarios([scenarioId]);
  }, [installScenarios]);

  const installPack = useCallback(async (packId: UiReviewPackId) => {
    await installScenarios(PACK_SCENARIOS[packId]);
  }, [installScenarios]);

  const installAll = useCallback(async () => {
    setBusy(true);
    try {
      const { sampleScenarioRepository } = await import("../../services/sample-scenario-repository");
      const { uiReviewSettingsRepository } = await import("../../services/ui-review-settings-repository");
      await sampleScenarioRepository.seedAll();
      await uiReviewSettingsRepository.seedScenario("plugins-directory-dense");
      await uiReviewSettingsRepository.seedScenario("settings-ai-credential-recovery");
      await uiReviewSettingsRepository.seedScenario("settings-ai-connections-dense");
      setInstalledCount(await sampleScenarioRepository.countAll() + await uiReviewSettingsRepository.count());
      setControllerKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  const clearSamples = useCallback(async () => {
    setBusy(true);
    try {
      const { sampleScenarioRepository } = await import("../../services/sample-scenario-repository");
      const { uiReviewSettingsRepository } = await import("../../services/ui-review-settings-repository");
      await sampleScenarioRepository.clearAll();
      await uiReviewSettingsRepository.clear();
      setInstalledCount(0);
      setUiReviewRuntimeActive(false);
      setReviewReady(true);
      setControllerKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  const exitSample = useCallback(() => {
    setControllerKey((value) => value + 1);
  }, []);

  return {
    busy,
    clearSamples,
    controllerKey,
    exitSample,
    installAll,
    installPack,
    installedCount,
    loadSample,
    reviewReady,
    scope,
  };
}
