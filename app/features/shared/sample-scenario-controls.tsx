"use client";

import { useEffect, useRef, useState } from "react";
import type { ViewKey } from "../../types/domains/workspace";
import type { WorkspaceDataScope } from "../../services/workspace-data-scope";
import type { SettingsSectionKey } from "../settings/settings-workspace-navigation";
import { sampleScenariosForView, type SampleScenarioId } from "./sample-scenario-registry";
import { AppIcon } from "./app-icon";
import "./sample-scenario-controls.module.css";

/** 管理可持久化、可清理的 UI 审查数据；数据继续由真实业务组件读取。 */
export function SampleScenarioControls({
  busy: externalBusy,
  installedCount,
  settingsSection,
  view,
  onClear,
  onInstallAll,
  onLoad,
}: {
  busy: boolean;
  installedCount: number;
  settingsSection?: SettingsSectionKey;
  scope: WorkspaceDataScope;
  view: ViewKey;
  onClear: () => Promise<void>;
  onExit: () => void;
  onInstallAll: () => Promise<void>;
  onLoad: (scenarioId: SampleScenarioId) => Promise<void>;
}) {
  const options = sampleScenariosForView(view, settingsSection);
  const [selectedId, setSelectedId] = useState<SampleScenarioId | "">((options[0]?.id as SampleScenarioId | undefined) ?? "");
  const [open, setOpen] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState("");
  const launcherRef = useRef<HTMLDivElement>(null);
  const busy = externalBusy || localBusy;
  const enabled = process.env.NODE_ENV === "development"
    || process.env.NEXT_PUBLIC_ENABLE_UI_REVIEW === "1"
    || installedCount > 0
    || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ui-review") === "1");
  const effectiveSelectedId = options.some((option) => option.id === selectedId)
    ? selectedId
    : (options[0]?.id as SampleScenarioId | undefined) ?? "";

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!launcherRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!enabled) return null;

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
    <div ref={launcherRef} className="sample-scenario-launcher">
      <button
        className={installedCount ? "sample-scenario-trigger is-active" : "sample-scenario-trigger"}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <AppIcon name="sparkles" size={16} />
        <span>UI 审查</span>
        {installedCount ? <em>{installedCount}</em> : null}
        <AppIcon name="chevronRight" size={14} />
      </button>
      {open ? (
        <section className="sample-scenario-popover" role="dialog" aria-label="UI 审查数据">
          <header>
            <div><strong>UI 审查数据</strong><span>{installedCount ? `已安装 ${installedCount} 条，可精准清理` : "只写入本地审查命名空间，不调用外部服务"}</span></div>
            <button type="button" aria-label="关闭 UI 审查数据" onClick={() => setOpen(false)}><AppIcon name="close" size={16} /></button>
          </header>
          {options.length ? (
            <div className="sample-scenario-current">
              <label htmlFor="ui-review-scenario">当前页面场景</label>
              <select
                id="ui-review-scenario"
                aria-label="选择当前页面审查场景"
                value={effectiveSelectedId}
                disabled={busy}
                title={options.find((option) => option.id === effectiveSelectedId)?.label}
                onChange={(event) => setSelectedId(event.currentTarget.value as SampleScenarioId)}
              >
                {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <button data-mobile-sidebar-close="true" type="button" disabled={busy || !effectiveSelectedId} onClick={() => void run(() => onLoad(effectiveSelectedId as SampleScenarioId))}><AppIcon name="import" size={16} />载入本页</button>
            </div>
          ) : <p className="sample-scenario-empty">当前分区没有专用审查场景。</p>}
          <div className="sample-scenario-mode-actions">
            <button data-mobile-sidebar-close="true" type="button" disabled={busy} onClick={() => void run(onInstallAll)}><AppIcon name="download" size={16} />载入完整数据</button>
            {installedCount ? <button type="button" disabled={busy} onClick={() => void run(onClear)}><AppIcon name="trash" size={16} />删除审查数据</button> : null}
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
