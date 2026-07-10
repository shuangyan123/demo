"use client";

import { useCallback, useState } from "react";
import type { LocalDiagnosticAction } from "../diagnostics/use-local-diagnostics";
import type { ConfigurationHealthAction } from "../onboarding/use-configuration-health";
import type { SettingsSectionKey } from "../settings/settings-workspace";
import type { SettingsPluginId } from "../settings/plugins/settings-plugin-registry";
import type { ViewKey } from "../../types/review";

type ReviewWorkspaceRecoveryNavigationInput = {
  setNotice: (message: string) => void;
  switchView: (view: ViewKey) => void;
};

const defaultApiSettingsMessage = "请在 AI 连接中配置所需的默认连接后再继续";

// 集中管理设置页入口、健康检查 CTA 和诊断恢复 CTA，避免主工作台散落跨模块跳转规则。
export function useReviewWorkspaceRecoveryNavigation({ setNotice, switchView }: ReviewWorkspaceRecoveryNavigationInput) {
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionKey>("appearance");
  const [settingsInitialPluginId, setSettingsInitialPluginId] = useState<SettingsPluginId | undefined>();

  const openApiSettings = useCallback(
    (message = defaultApiSettingsMessage) => {
      setSettingsInitialSection("configuration");
      switchView("settings");
      setNotice(message);
    },
    [setNotice, switchView],
  );

  const openPluginSettings = useCallback(
    (message = "插件已集中到设置中管理", pluginId?: SettingsPluginId) => {
      setSettingsInitialSection("plugins");
      setSettingsInitialPluginId(pluginId);
      switchView("settings");
      setNotice(message);
    },
    [setNotice, switchView],
  );

  const openMcpSettings = useCallback(
    (message = "MCP 工具已移到独立设置中") => {
      setSettingsInitialSection("mcp");
      setSettingsInitialPluginId(undefined);
      switchView("settings");
      setNotice(message);
    },
    [setNotice, switchView],
  );

  const resetSettingsSection = useCallback(() => {
    setSettingsInitialSection("appearance");
    setSettingsInitialPluginId(undefined);
  }, []);

  const openDiagnosticsTarget = useCallback(
    (action: Exclude<LocalDiagnosticAction, "ai-connections">) => {
      setSettingsInitialSection("appearance");
      switchView(action === "knowledge" ? "knowledge" : "automation");
    },
    [switchView],
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
        openPluginSettings("粉笔导入已移到插件中", "fenbi-import");
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
    [openApiSettings, openPluginSettings, switchView],
  );

  return {
    openApiSettings,
    openPluginSettings,
    openMcpSettings,
    openConfigurationHealthAction,
    openDiagnosticsTarget,
    resetSettingsSection,
    settingsInitialPluginId,
    settingsInitialSection,
  };
}
