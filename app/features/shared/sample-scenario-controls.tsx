"use client";

import { useState } from "react";
import type { ViewKey } from "../../types/domains/workspace";
import type { WorkspaceDataScope } from "../../services/workspace-data-scope";
import { sampleScenariosForView, type SampleScenarioId } from "./sample-scenario-registry";
import { AppIcon } from "./app-icon";
import "./sample-scenario-controls.module.css";

/** 管理可持久化、可清理的 UI 审查数据；数据继续由真实业务组件读取。 */
export function SampleScenarioControls({
  busy: externalBusy,
  installedCount,
  view,
  onClear,
  onInstallAll,
  onLoad,
}: {
  busy: boolean;
  installedCount: number;
  scope: WorkspaceDataScope;
  view: ViewKey;
  onClear: () => Promise<void>;
  onExit: () => void;
  onInstallAll: () => Promise<void>;
  onLoad: (scenarioId: SampleScenarioId) => Promise<void>;
}) {
  const options = sampleScenariosForView(view);
  const [selectedId, setSelectedId] = useState<SampleScenarioId | "">((options[0]?.id as SampleScenarioId | undefined) ?? "");
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState("");
  const busy = externalBusy || localBusy;
  const effectiveSelectedId = options.some((option) => option.id === selectedId)
    ? selectedId
    : (options[0]?.id as SampleScenarioId | undefined) ?? "";

  async function run(action: () => Promise<void>) {
    setLocalBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "UI 审查数据操作失败");
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <section className={installedCount ? "sample-scenario-bar is-active" : "sample-scenario-bar"} aria-label="UI 审查数据">
      <div className="sample-scenario-status">
        <AppIcon name="sparkles" size={16} />
        <div>
          <strong>UI 审查数据</strong>
          <span>{installedCount ? `已安装 ${installedCount} 条，可编辑并单独删除` : "按需载入真实本地数据，不调用外部服务"}</span>
        </div>
      </div>
      {options.length ? (
        <div className="sample-scenario-actions">
          <select
            aria-label="选择当前页面审查场景"
            value={effectiveSelectedId}
            disabled={busy}
            onChange={(event) => setSelectedId(event.currentTarget.value as SampleScenarioId)}
          >
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <button
            data-mobile-sidebar-close="true"
            type="button"
            disabled={busy || !effectiveSelectedId}
            onClick={() => void run(() => onLoad(effectiveSelectedId as SampleScenarioId))}
          >
            载入本页
          </button>
        </div>
      ) : null}
      <div className="sample-scenario-mode-actions">
        <button type="button" disabled={busy} onClick={() => void run(onInstallAll)}>载入完整数据</button>
        {installedCount ? <button type="button" disabled={busy} onClick={() => void run(onClear)}>删除审查数据</button> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
