"use client";

import { SidebarNav } from "../shared/workspace-shell";
import { SettingsNavIcon, type SettingsIconName } from "./appearance-settings-view";

/** 设置页可切换的稳定分区键，由工作台控制器统一持有当前值。 */
export type SettingsSectionKey = "appearance" | "configuration" | "personalization" | "quota" | "mcp" | "diagnostics";

/** 设置导航定义同时供桌面侧栏和移动端选择器复用。 */
export const settingsSections = [
  { key: "appearance", label: "外观", icon: "appearance" },
  { key: "configuration", label: "AI 连接", icon: "configuration" },
  { key: "personalization", label: "个性化", icon: "personalization" },
  { key: "quota", label: "额度", icon: "plugins" },
  { key: "mcp", label: "MCP", icon: "mcp" },
  { key: "diagnostics", label: "诊断", icon: "diagnostics" },
] satisfies Array<{ key: SettingsSectionKey; label: string; icon: SettingsIconName }>;

/** 设置模式只替换共享侧栏的内容，不创建新的应用外壳。 */
export function SettingsWorkspaceSidebar({
  activeSection,
  onBack,
  onSectionChange,
}: {
  activeSection: SettingsSectionKey;
  onBack: () => void;
  onSectionChange: (section: SettingsSectionKey) => void;
}) {
  return (
    <>
      <button
        data-mobile-sidebar-close="true"
        className="mb-3 grid min-h-9 grid-cols-[20px_1fr] items-center gap-2.5 rounded-lg px-3 text-left text-sm text-muted hover:bg-chrome-hover max-lg:min-h-11"
        type="button"
        onClick={onBack}
      >
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
  );
}
