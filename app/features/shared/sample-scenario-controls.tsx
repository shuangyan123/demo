"use client";

import { useState } from "react";
import type { ViewKey } from "../../types/domains/workspace";
import type { WorkspaceDataScope } from "../../services/workspace-data-scope";
import { getSampleScenario, sampleScenariosForView, type SampleScenarioId } from "./sample-scenario-registry";
import { AppIcon } from "./app-icon";
import "./sample-scenario-controls.module.css";

export function SampleScenarioControls({
  scope,
  view,
  onClear,
  onExit,
  onLoad,
}: {
  scope: WorkspaceDataScope;
  view: ViewKey;
  onClear: () => Promise<void>;
  onExit: () => void;
  onLoad: (scenarioId: SampleScenarioId) => Promise<void>;
}) {
  const options = sampleScenariosForView(view);
  const [selectedId, setSelectedId] = useState<SampleScenarioId | "">((options[0]?.id as SampleScenarioId | undefined) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const activeScenario = scope.kind === "sample" ? getSampleScenario(scope.scenarioId) : undefined;
  const effectiveSelectedId = options.some((option) => option.id === selectedId)
    ? selectedId
    : (options[0]?.id as SampleScenarioId | undefined) ?? "";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "示例操作失败");
    } finally {
      setBusy(false);
    }
  }

  if (!options.length && scope.kind === "personal") return null;
  return (
    <section className={scope.kind === "sample" ? "sample-scenario-bar is-active" : "sample-scenario-bar"} aria-label="示例场景">
      <div className="sample-scenario-status">
        <AppIcon name="sparkles" size={16} />
        <div>
          <strong>{scope.kind === "sample" ? "示例模式" : "查看真实界面示例"}</strong>
          <span>{activeScenario?.label ?? "示例与个人数据完全隔离，且不会调用外部服务"}</span>
        </div>
      </div>
      {options.length ? (
        <div className="sample-scenario-actions">
          <select
            aria-label="选择示例场景"
            value={effectiveSelectedId}
            disabled={busy}
            onChange={(event) => setSelectedId(event.currentTarget.value as SampleScenarioId)}
          >
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button data-mobile-sidebar-close="true" type="button" disabled={busy || !effectiveSelectedId} onClick={() => void run(() => onLoad(effectiveSelectedId as SampleScenarioId))}>
            载入示例
          </button>
        </div>
      ) : null}
      {scope.kind === "sample" ? (
        <div className="sample-scenario-mode-actions">
          <button data-mobile-sidebar-close="true" type="button" disabled={busy} onClick={onExit}>退出示例</button>
          <button type="button" disabled={busy} onClick={() => void run(onClear)}>一键清理</button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
