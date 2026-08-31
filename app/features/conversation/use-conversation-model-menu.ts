"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { announceInteractiveOverlayOpen } from "../shared/ui-overlay-events";

type ConversationModelMenuOptions = {
  onClose?: () => void;
};

/** 管理模型菜单的外部关闭、Escape、初始聚焦和触发器焦点恢复。 */
export function useConversationModelMenu({ onClose }: ConversationModelMenuOptions = {}) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusFrameRef = useRef<number | undefined>(undefined);
  const menuId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const close = useCallback((restoreFocus = true) => {
    if (!openRef.current) return;
    onCloseRef.current?.();
    openRef.current = false;
    setOpen(false);
    if (restoreFocus) {
      if (restoreFocusFrameRef.current !== undefined) window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = undefined;
        triggerRef.current?.focus();
      });
    }
  }, []);

  const openMenu = useCallback(() => {
    if (openRef.current) return false;
    openRef.current = true;
    if (restoreFocusFrameRef.current !== undefined) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = undefined;
    }
    announceInteractiveOverlayOpen();
    setOpen(true);
    return true;
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const target = menuRef.current?.querySelector<HTMLElement>("[data-picker-default-focus], button:not([disabled]), select, input");
      if (!target) return;
      target.dataset.tooltipProgrammaticFocus = "true";
      target.dataset.pickerProgrammaticFocus = "true";
      target.focus();
      window.requestAnimationFrame(() => {
        delete target.dataset.tooltipProgrammaticFocus;
        delete target.dataset.pickerProgrammaticFocus;
      });
    });
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (menuRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      close(true);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  return {
    close,
    menuId,
    menuRef,
    open,
    openMenu,
    triggerRef,
  };
}
