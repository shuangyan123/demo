"use client";

import { useState } from "react";
import { PERSONAL_WORKSPACE_DATA_SCOPE, type WorkspaceDataScope } from "../../services/workspace-data-scope";
import type { SampleScenarioId } from "../shared/sample-scenario-registry";

/** 示例模式只保存在当前 React 生命周期；刷新或重启始终回到个人数据。 */
export function useReviewWorkspaceSampleScope() {
  const [scope, setScope] = useState<WorkspaceDataScope>(PERSONAL_WORKSPACE_DATA_SCOPE);
  const [controllerKey, setControllerKey] = useState(0);
  async function loadSample(scenarioId: SampleScenarioId) {
    const { sampleScenarioRepository } = await import("../../services/sample-scenario-repository");
    await sampleScenarioRepository.seed(scenarioId);
    setScope({ kind: "sample", scenarioId });
    setControllerKey((value) => value + 1);
  }
  async function clearSamples() {
    const { sampleScenarioRepository } = await import("../../services/sample-scenario-repository");
    await sampleScenarioRepository.clearAll();
    setScope(PERSONAL_WORKSPACE_DATA_SCOPE);
    setControllerKey((value) => value + 1);
  }
  function exitSample() {
    setScope(PERSONAL_WORKSPACE_DATA_SCOPE);
    setControllerKey((value) => value + 1);
  }
  return { clearSamples, controllerKey, exitSample, loadSample, scope };
}
