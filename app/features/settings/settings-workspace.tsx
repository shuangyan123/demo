"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { AppearanceSettings, PersonalizationSettings } from "../../types/review";
import { LocalDiagnosticsPanel } from "../diagnostics/local-diagnostics-panel";
import { useLocalDiagnostics, type LocalDiagnosticAction, type LocalDiagnosticsHookInput } from "../diagnostics/use-local-diagnostics";
import { SidebarNav, WorkspaceShell } from "../shared/workspace-shell";
import { AiActivityPanel } from "../shared/ai-activity-panel";
import { ApiConnectionsSettingsView } from "./api-connections-settings-view";
import { AppearanceSettingsView, SettingsNavIcon, type SettingsIconName } from "./appearance-settings-view";
import { McpSettingsView } from "./mcp-settings-view";
const PersonalizationSettingsView = dynamic(() => import("./personalization-settings-view").then((module) => module.PersonalizationSettingsView));
const AiQuotaSettingsPanel = dynamic(() => import("./plugins/quota/ai-quota-settings-panel").then((module) => module.AiQuotaSettingsPanel));

export type SettingsSectionKey = "appearance" | "configuration" | "roles" | "quota" | "mcp" | "diagnostics";
type LegacySettingsSectionKey = SettingsSectionKey | "personalization";

const settingsSections = [
  { key: "appearance", label: "外观", icon: "appearance" },
  { key: "configuration", label: "AI 连接", icon: "configuration" },
  { key: "roles", label: "角色", icon: "personalization" },
  { key: "quota", label: "额度", icon: "plugins" },
  { key: "mcp", label: "MCP", icon: "mcp" },
  { key: "diagnostics", label: "诊断", icon: "diagnostics" },
] satisfies Array<{ key: SettingsSectionKey; label: string; icon: SettingsIconName }>;

type SettingsWorkspaceProps = {
  appearanceSettings: AppearanceSettings;
  diagnosticsInput: LocalDiagnosticsHookInput;
  initialSection?: LegacySettingsSectionKey;
  sidebarCollapsed: boolean;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onBack: () => void;
  onClearLocalRecords?: () => void;
  onConfigurationChanged?: () => void;
  onOpenDiagnosticsTarget: (action: Exclude<LocalDiagnosticAction, "ai-connections">) => void;
  onPersonalizationChange?: (settings: PersonalizationSettings) => void;
  onToggleSidebar: () => void;
};

// 设置壳层只负责全局导航和分区切换，各分区的表单与数据状态由独立组件维护。
export function SettingsWorkspace({
  appearanceSettings,
  diagnosticsInput,
  initialSection = "appearance",
  sidebarCollapsed,
  onAppearanceChange,
  onBack,
  onConfigurationChanged,
  onOpenDiagnosticsTarget,
  onPersonalizationChange,
  onToggleSidebar,
}: SettingsWorkspaceProps) {
  const normalizeSection = (section: LegacySettingsSectionKey): SettingsSectionKey => section === "personalization" ? "roles" : section;
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(() => normalizeSection(initialSection));
  const [toast, setToast] = useState("");
  const { diagnostics, refresh: refreshDiagnostics, refreshing: diagnosticsRefreshing } = useLocalDiagnostics(diagnosticsInput);

  useEffect(() => {
    const timer = window.setTimeout(() => setActiveSection(normalizeSection(initialSection)), 0);
    return () => window.clearTimeout(timer);
  }, [initialSection]);

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
      return <ApiConnectionsSettingsView onChanged={onConfigurationChanged} />;
    }
    if (activeSection === "roles") {
      return <PersonalizationSettingsView onChanged={onPersonalizationChange} onOpenConnections={() => setActiveSection("configuration")} />;
    }
    if (activeSection === "quota") {
      return <AiQuotaSettingsPanel />;
    }
    if (activeSection === "mcp") {
      return <McpSettingsView onNotice={setToast} />;
    }
    return (
      <LocalDiagnosticsPanel
        diagnostics={diagnostics}
        refreshing={diagnosticsRefreshing}
        onAction={(action) => {
          if (action === "ai-connections") {
            setActiveSection("configuration");
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
      contentClassName="settings-content settings-main-scroll px-8 py-8 max-lg:px-4 max-lg:py-6"
      sidebarCollapsed={sidebarCollapsed}
      sidebarClassName="flex flex-col overflow-y-auto px-3 py-4 text-settings-sidebar-text max-lg:overflow-visible"
      title="设置"
      onBack={onBack}
      onToggleSidebar={onToggleSidebar}
      sidebar={
        <>
          <button className="mb-3 grid min-h-9 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm text-muted hover:bg-chrome-hover max-lg:min-h-11" type="button" onClick={onBack}>
            <SettingsNavIcon name="back" />
            <span>返回应用</span>
          </button>
          <SidebarNav
            activeKey={activeSection}
            items={settingsSections}
            renderIcon={(icon) => <SettingsNavIcon name={icon as SettingsIconName} />}
            onSelect={setActiveSection}
          />
        </>
      }
    >
      <div key={activeSection} className="settings-section-enter mx-auto max-w-6xl">{renderSection()}</div>
      <AiActivityPanel />
      {toast ? <div className="ui-toast fixed left-1/2 top-14 z-50 -translate-x-1/2 border border-line bg-surface px-4 py-2 text-sm">{toast}</div> : null}
    </WorkspaceShell>
  );
}
