"use client";

import { useEffect, useState } from "react";
import type { AppearanceSettings, PersonalizationSettings } from "../../types/review";
import { SidebarNav, WorkspaceShell } from "../shared/workspace-shell";
import { ApiConnectionsSettingsView } from "./api-connections-settings-view";
import { AppearanceSettingsView, SettingsNavIcon, type SettingsIconName } from "./appearance-settings-view";
import { PersonalizationSettingsView } from "./personalization-settings-view";

type SettingsSectionKey = "appearance" | "configuration" | "personalization";

const settingsSections = [
  { key: "appearance", label: "外观", icon: "appearance" },
  { key: "configuration", label: "AI 连接", icon: "configuration" },
  { key: "personalization", label: "个性化", icon: "personalization" },
] satisfies Array<{ key: SettingsSectionKey; label: string; icon: "appearance" | "configuration" | "personalization" }>;

type SettingsWorkspaceProps = {
  appearanceSettings: AppearanceSettings;
  initialSection?: SettingsSectionKey;
  sidebarCollapsed: boolean;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  onBack: () => void;
  onClearLocalRecords?: () => void;
  onConfigurationChanged?: () => void;
  onPersonalizationChange?: (settings: PersonalizationSettings) => void;
  onToggleSidebar: () => void;
};

// 设置壳层只负责全局导航和分区切换，各分区的表单与数据状态由独立组件维护。
export function SettingsWorkspace({
  appearanceSettings,
  initialSection = "appearance",
  sidebarCollapsed,
  onAppearanceChange,
  onBack,
  onClearLocalRecords,
  onConfigurationChanged,
  onPersonalizationChange,
  onToggleSidebar,
}: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>(initialSection);
  const [toast, setToast] = useState("");

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
      return <ApiConnectionsSettingsView onChanged={onConfigurationChanged} onClearLocalRecords={onClearLocalRecords} />;
    }
    return <PersonalizationSettingsView onChanged={onPersonalizationChange} onOpenConnections={() => setActiveSection("configuration")} />;
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
          <button className="mb-3 grid min-h-10 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm text-muted hover:bg-chrome-hover" type="button" onClick={onBack}>
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
      {toast ? <div className="ui-toast fixed left-1/2 top-14 z-50 -translate-x-1/2 border border-line bg-surface px-4 py-2 text-sm">{toast}</div> : null}
    </WorkspaceShell>
  );
}
