"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

/** 管理模型菜单的外部关闭、Escape、初始聚焦和触发器焦点恢复。 */
export function useConversationModelMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("button:not([disabled]), select, input")?.focus());
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return {
    close,
    menuId,
    menuRef,
    open,
    openMenu: () => setOpen(true),
    triggerRef,
    toggle: () => setOpen((current) => !current),
  };
}
