"use client";

import { useEffect, useSyncExternalStore } from "react";
import { obsidianSyncRuntime } from "../../services/obsidian-sync-runtime.ts";

/** 常驻工作台根部，确保切换视图不会卸载 Vault 监听。 */
export function ObsidianSyncRuntimeHost({ paused = false }: { paused?: boolean }) {
  useEffect(() => {
    if (paused) {
      void obsidianSyncRuntime.stop();
      return;
    }
    void obsidianSyncRuntime.start();
    return () => {
      void obsidianSyncRuntime.stop();
    };
  }, [paused]);
  return null;
}

export function useObsidianSyncRuntimeSnapshot() {
  return useSyncExternalStore(
    obsidianSyncRuntime.subscribe,
    obsidianSyncRuntime.getSnapshot,
    obsidianSyncRuntime.getSnapshot,
  );
}
