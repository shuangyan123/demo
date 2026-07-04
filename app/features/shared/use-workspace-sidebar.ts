"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "review-workspace:sidebar:v1";
const CHANGE_EVENT = "review-workspace:sidebar-change";

// 订阅同标签页和其他标签页的侧栏变化，让应用页、设置页与刷新后的状态保持一致。
function subscribe(onStoreChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function readCollapsedState(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "collapsed";
}

// 服务端快照固定为展开状态，避免首次水合时依赖浏览器存储。
function readServerSnapshot(): boolean {
  return false;
}

export function useWorkspaceSidebar() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsedState, readServerSnapshot);

  const setCollapsed = useCallback((nextCollapsed: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, nextCollapsed ? "collapsed" : "expanded");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const toggle = useCallback(() => setCollapsed(!readCollapsedState()), [setCollapsed]);
  return { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed, toggleSidebar: toggle };
}
