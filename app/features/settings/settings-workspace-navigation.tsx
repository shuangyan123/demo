"use client";

import type { ReactNode } from "react";
import { SidebarNav } from "../shared/workspace-shell";
import { SettingsNavIcon, type SettingsIconName } from "./appearance-settings-view";

/** 设置页可切换的稳定分区键，由工作台控制器统一持有当前值。 */
export type SettingsSectionKey = "profile" | "appearance" | "configuration" | "personalization" | "quota" | "import" | "installed-plugins" | "mcp" | "diagnostics";

/** 设置导航定义同时供桌面侧栏和移动端选择器复用。 */
export const settingsSections = [
  { key: "profile", label: "个人资料", icon: "personalization" },
  { key: "appearance", label: "外观", icon: "appearance" },
  { key: "configuration", label: "AI 连接", icon: "configuration" },
  { key: "personalization", label: "个性化", icon: "personalization" },
  { key: "quota", label: "额度", icon: "plugins" },
  { key: "import", label: "导入", icon: "import" },
  { key: "installed-plugins", label: "插件", icon: "plugins" },
  { key: "mcp", label: "MCP", icon: "mcp" },
  { key: "diagnostics", label: "诊断", icon: "diagnostics" },
] satisfies Array<{ key: SettingsSectionKey; label: string; icon: SettingsIconName }>;

/** 设置模式只替换共享侧栏的内容，不创建新的应用外壳。 */
export function SettingsWorkspaceSidebar({
  activeSection,
  footer,
  onBack,
  onSectionChange,
}: {
  activeSection: SettingsSectionKey;
  footer?: ReactNode;
  onBack: () => void;
  onSectionChange: (section: SettingsSectionKey) => void;
}) {
  return (
    <div className="workspace-sidebar-shell settings-sidebar-shell" data-sidebar-kind="settings">
      <header className="workspace-sidebar-header">
        <button
          data-mobile-sidebar-close="true"
          className="grid min-h-8 w-full grid-cols-[18px_1fr] items-center gap-2 rounded-[var(--ui-radius-row)] px-2.5 text-left text-sm text-muted hover:bg-chrome-hover max-lg:min-h-11 max-lg:grid-cols-[20px_1fr] max-lg:gap-2.5 max-lg:px-3"
          type="button"
          onClick={onBack}
        >
          <SettingsNavIcon name="back" small />
          <span>返回应用</span>
        </button>
      </header>
      <div className="workspace-sidebar-scroll" data-sidebar-scroll-region="true">
        <div className="workspace-sidebar-section">
          <div className="workspace-sidebar-section-heading"><span>设置</span></div>
          <SidebarNav
            activeKey={activeSection}
            items={settingsSections}
            renderIcon={(icon) => <SettingsNavIcon name={icon as SettingsIconName} small />}
            onSelect={onSectionChange}
          />
        </div>
      </div>
      {footer ? <footer className="workspace-sidebar-footer" aria-label="设置辅助操作">{footer}</footer> : null}
    </div>
  );
}
