"use client";

import { useSyncExternalStore } from "react";
import { settingsPluginPreferencesRepository } from "../../../services/settings-plugin-preferences-repository.ts";

/** 统一订阅内置插件偏好，确保工作台入口与插件目录使用同一状态源。 */
export function useSettingsPluginPreferences() {
  return useSyncExternalStore(
    settingsPluginPreferencesRepository.subscribe,
    settingsPluginPreferencesRepository.getSnapshot,
    settingsPluginPreferencesRepository.getServerSnapshot,
  );
}
