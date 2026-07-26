"use client";

import { useCallback, useState } from "react";
import type { LocalDiagnosticAction } from "../diagnostics/use-local-diagnostics";
import type { ConfigurationHealthAction } from "../onboarding/use-configuration-health";
import type { SettingsSectionKey } from "../settings/settings-workspace";
import type { ViewKey } from "../../types/domains/workspace.ts";

type ReviewWorkspaceRecoveryNavigationInput = {
  setNotice: (message: string) => void;
  switchView: (view: ViewKey) => void;
};

const defaultApiSettingsMessage = "请在 AI 连接中配置所需的默认连接后再继续";

/** 旧入口只在设置边界转换一次，内部始终使用当前分区键。 */
export function normalizeSettingsSection(section: SettingsSectionKey | "roles"): SettingsSectionKey {
  return section === "roles" ? "personalization" : section;
}

// 集中管理设置页入口、健康检查 CTA 和诊断恢复 CTA，避免主工作台散落跨模块跳转规则。
export function useReviewWorkspaceRecoveryNavigation({ setNotice, switchView }: ReviewWorkspaceRecoveryNavigationInput) {
  const [settingsSection, setSettingsSection] = useState<SettingsSectionKey>("appearance");
  const setNormalizedSettingsSection = useCallback((section: SettingsSectionKey | "roles") => {
    setSettingsSection(normalizeSettingsSection(section));
  }, []);

  const openApiSettings = useCallback(
    (message = defaultApiSettingsMessage) => {
      setNormalizedSettingsSection("configuration");
      switchView("settings");
      setNotice(message);
    },
    [setNotice, setNormalizedSettingsSection, switchView],
  );

  const openMcpSettings = useCallback(
    (message = "MCP 工具已移到独立设置中") => {
      setNormalizedSettingsSection("mcp");
      switchView("settings");
      setNotice(message);
    },
    [setNotice, setNormalizedSettingsSection, switchView],
  );

  const resetSettingsSection = useCallback(() => {
    setNormalizedSettingsSection("appearance");
  }, [setNormalizedSettingsSection]);

  const openDiagnosticsTarget = useCallback(
    (action: Exclude<LocalDiagnosticAction, "ai-connections">) => {
      setNormalizedSettingsSection("appearance");
      switchView(action === "knowledge" ? "knowledge" : "automation");
    },
    [setNormalizedSettingsSection, switchView],
  );

  const openConfigurationHealthAction = useCallback(
    (action: ConfigurationHealthAction) => {
      if (action === "ai-connections") {
        openApiSettings("请先补齐默认 AI 连接，再继续使用对应能力");
        return;
      }
      if (action === "obsidian") {
        switchView("knowledge");
        return;
      }
      if (action === "automation") {
        switchView("automation");
        return;
      }
      if (action === "import") {
        switchView("import");
        return;
      }
      if (action === "entry") {
        switchView("entry");
        return;
      }
      if (action === "review") {
        switchView("review");
        return;
      }
      switchView("knowledgeTraining");
    },
    [openApiSettings, switchView],
  );

  return {
    openApiSettings,
    openMcpSettings,
    openConfigurationHealthAction,
    openDiagnosticsTarget,
    resetSettingsSection,
    setSettingsSection: setNormalizedSettingsSection,
    settingsSection,
  };
}
