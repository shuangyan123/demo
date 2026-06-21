"use client";

import { useState } from "react";

// 管理工作台主视图和进入设置前的业务视图，避免每个 feature 自己维护返回逻辑。
export function useWorkspaceNavigation<TView extends string>(initialView: TView, settingsView: TView) {
  const [view, setView] = useState<TView>(initialView);
  const [lastAppView, setLastAppView] = useState<TView>(initialView);

  // 切换视图时记录最后一个非设置页，用于设置页“返回应用”。
  function switchView(nextView: TView) {
    if (nextView !== settingsView) {
      setLastAppView(nextView);
    }
    setView(nextView);
  }

  return { lastAppView, setView, switchView, view };
}
