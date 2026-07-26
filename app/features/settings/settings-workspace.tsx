"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { AppearanceSettings } from "../../types/domains/appearance.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { LocalDiagnosticsPanel } from "../diagnostics/local-diagnostics-panel";
import { useLocalDiagnostics, type LocalDiagnosticAction, type LocalDiagnosticsHookInput } from "../diagnostics/use-local-diagnostics";
import { SidebarNav, WorkspaceShell } from "../shared/workspace-shell";
import { ApiConnectionsSettingsView } from "./api-connections-settings-view";
import { AppearanceSettingsView, SettingsNavIcon, type SettingsIconName } from "./appearance-settings-view";
import { McpSettingsView } from "./mcp-settings-view";
import layoutStyles from "./settings-layout.module.css";
const PersonalizationSettingsView = dynamic(() => import("./personalization-settings-view").then((module) => module.PersonalizationSettingsView));
const AiQuotaSettingsPanel = dynamic(() => import("./plugins/quota/ai-quota-settings-panel").then((module) => module.AiQuotaSettingsPanel));

export type SettingsSectionKey = "appearance" | "configuration" | "personalization" | "quota" | "mcp" | "diagnostics";

const settingsSections = [
  { key: "appearance", label: "外观", icon: "appearance" },
  { key: "configuration", label: "AI 连接", icon: "configuration" },
  { key: "personalization", label: "个性化", icon: "personalization" },
  { key: "quota", label: "额度", icon: "plugins" },
  { key: "mcp", label: "MCP", icon: "mcp" },
  { key: "diagnostics", label: "诊断", icon: "diagnostics" },
] satisfies Array<{ key: SettingsSectionKey; label: string; icon: SettingsIconName }>;

type SettingsWorkspaceProps = {
  activeSection: SettingsSectionKey;
  appearanceSettings: AppearanceSettings;
  diagnosticsInput: LocalDiagnosticsHookInput;
  developmentExample?: string;
  sidebarCollapsed: boolean;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onBack: () => void;
  onDataChanged?: () => Promise<void> | void;
  onConfigurationChanged?: () => void;
  onOpenDiagnosticsTarget: (action: Exclude<LocalDiagnosticAction, "ai-connections">) => void;
  onPersonalizationChange?: (settings: PersonalizationSettings) => void;
  onSectionChange: (section: SettingsSectionKey) => void;
  onToggleSidebar: () => void;
};

// 设置壳层只负责全局导航和分区切换，各分区的表单与数据状态由独立组件维护。
export function SettingsWorkspace({
  activeSection,
  appearanceSettings,
  diagnosticsInput,
  developmentExample,
  sidebarCollapsed,
  onAppearanceChange,
  onBack,
  onDataChanged,
  onConfigurationChanged,
  onOpenDiagnosticsTarget,
  onPersonalizationChange,
  onSectionChange,
  onToggleSidebar,
}: SettingsWorkspaceProps) {
  const [toast, setToast] = useState("");
  const { diagnostics, refresh: refreshDiagnostics, refreshing: diagnosticsRefreshing } = useLocalDiagnostics(diagnosticsInput);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function renderSection() {
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
    <WorkspaceShell
      key={activeSection}
      contentClassName="settings-content settings-main-scroll px-8 py-8 max-lg:px-4 max-lg:py-6"
      integrationMode="settings"
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName="flex flex-col overflow-y-auto px-3 py-4 text-settings-sidebar-text"
      title="设置"
      onBack={onBack}
      onToggleSidebar={onToggleSidebar}
      sidebar={
        <>
          <button data-mobile-sidebar-close="true" className="mb-3 grid min-h-9 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm text-muted hover:bg-chrome-hover max-lg:min-h-11" type="button" onClick={onBack}>
            <SettingsNavIcon name="back" />
            <span>返回应用</span>
          </button>
          <SidebarNav
            activeKey={activeSection}
            items={settingsSections}
            renderIcon={(icon) => <SettingsNavIcon name={icon as SettingsIconName} />}
            onSelect={onSectionChange}
          />
        </>
      }
    >
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
    </WorkspaceShell>
  );
}
