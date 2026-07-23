"use client";

import { useCallback, useEffect, useState } from "react";
import { createDefaultPersonalizationSettings, personalizationSettingsRepository } from "../../services/personalization-settings-repository";
import type { PersonalizationSettings } from "../../types/review";

// 读取并缓存当前个性化设置，让辅导、面试和知识内化共享同一份选择。
export function usePersonalizationSettings(onError: (message: string) => void) {
  const [settings, setSettings] = useState<PersonalizationSettings>(() => createDefaultPersonalizationSettings());
  const refresh = useCallback(async () => setSettings(await personalizationSettingsRepository.load()), []);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      refresh().catch((error) => {
        if (active) onError(error instanceof Error ? error.message : "个性化设置读取失败");
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onError, refresh]);
  return { refresh, setSettings, settings };
}
