"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import type { AppearanceSettings } from "../../types/domains/appearance.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { LocalDiagnosticsPanel } from "../diagnostics/local-diagnostics-panel";
import { useLocalDiagnostics, type LocalDiagnosticAction, type LocalDiagnosticsHookInput } from "../diagnostics/use-local-diagnostics";
import { ApiConnectionsSettingsView } from "./api-connections-settings-view";
import { AppearanceSettingsView } from "./appearance-settings-view";
import { McpSettingsView } from "./mcp-settings-view";
import layoutStyles from "./settings-layout.module.css";
import { settingsSections, type SettingsSectionKey } from "./settings-workspace-navigation";
const PersonalizationSettingsView = dynamic(() => import("./personalization-settings-view").then((module) => module.PersonalizationSettingsView));
const AiQuotaSettingsPanel = dynamic(() => import("./plugins/quota/ai-quota-settings-panel").then((module) => module.AiQuotaSettingsPanel));

export type { SettingsSectionKey } from "./settings-workspace-navigation";

type SettingsWorkspaceProps = {
  activeSection: SettingsSectionKey;
  appearanceSettings: AppearanceSettings;
  diagnosticsInput: LocalDiagnosticsHookInput;
  developmentExample?: string;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onDataChanged?: () => Promise<void> | void;
  onConfigurationChanged?: () => void;
  onOpenDiagnosticsTarget: (action: Exclude<LocalDiagnosticAction, "ai-connections">) => void;
  onPersonalizationChange?: (settings: PersonalizationSettings) => void;
  onSectionChange: (section: SettingsSectionKey) => void;
  profileContent: ReactNode;
  importContent: ReactNode;
  installedPluginsContent: ReactNode;
};

/** 设置内容只负责分区渲染，各分区的表单与数据状态由独立组件维护。 */
export function SettingsWorkspace({
  activeSection,
  appearanceSettings,
  diagnosticsInput,
  developmentExample,
  onAppearanceChange,
  onDataChanged,
  onConfigurationChanged,
  onOpenDiagnosticsTarget,
  onPersonalizationChange,
  onSectionChange,
  profileContent,
  importContent,
  installedPluginsContent,
}: SettingsWorkspaceProps) {
  const [toast, setToast] = useState("");
  const { diagnostics, refresh: refreshDiagnostics, refreshing: diagnosticsRefreshing } = useLocalDiagnostics(diagnosticsInput);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function renderSection() {
    if (activeSection === "profile") return profileContent;
    if (activeSection === "appearance") {
      return <AppearanceSettingsView settings={appearanceSettings} onChange={onAppearanceChange} onNotify={setToast} />;
    }
    if (activeSection === "configuration") {
      return <ApiConnectionsSettingsView developmentExample={developmentExample} onChanged={onConfigurationChanged} />;
    }
    if (activeSection === "personalization") {
      return <PersonalizationSettingsView onChanged={onPersonalizationChange} onOpenConnections={() => onSectionChange("configuration")} />;
    }
    if (activeSection === "quota") {
      return <AiQuotaSettingsPanel developmentExample={developmentExample} />;
    }
    if (activeSection === "import") return importContent;
    if (activeSection === "installed-plugins") return installedPluginsContent;
    if (activeSection === "mcp") {
      return <McpSettingsView developmentExample={developmentExample} onNotice={setToast} />;
    }
    return (
      <LocalDiagnosticsPanel
        diagnostics={diagnostics}
        onDataChanged={onDataChanged}
        refreshing={diagnosticsRefreshing}
        onAction={(action) => {
          if (action === "ai-connections") {
            onSectionChange("configuration");
            return;
          }
          onOpenDiagnosticsTarget(action);
        }}
        onRefresh={refreshDiagnostics}
      />
    );
  }

  return (
    <>
      <label className="sr-only" htmlFor="mobile-settings-section">设置分区</label>
      <select
        id="mobile-settings-section"
        aria-label="设置分区"
        className={layoutStyles.mobilePicker}
        value={activeSection}
        onChange={(event) => onSectionChange(event.currentTarget.value as SettingsSectionKey)}
      >
        {settingsSections.map((section) => <option key={section.key} value={section.key}>{section.label}</option>)}
      </select>
      <div key={activeSection} className="settings-section-enter settings-section-layout">{renderSection()}</div>
      {toast ? <div className="ui-toast fixed left-1/2 top-14 z-50 -translate-x-1/2 border border-line bg-surface px-4 py-2 text-sm">{toast}</div> : null}
    </>
  );
}
