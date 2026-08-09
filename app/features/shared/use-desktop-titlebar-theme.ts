"use client";

import { useEffect } from "react";
import { host } from "../../platform/host.ts";

/** Electron Window Controls Overlay 与网页主题同步；桥接只接受 light/dark 两个枚举值。 */
export function useDesktopTitlebarTheme(): void {
  useEffect(() => {
    const nativeWindow = host.capabilities.nativeWindow;
    if (!nativeWindow) return;
    const sync = () => {
      const mode = document.body.dataset.theme === "dark" ? "dark" : "light";
      void nativeWindow.setTitleBarTheme(mode).catch(() => undefined);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
}
