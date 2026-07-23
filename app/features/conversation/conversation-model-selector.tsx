"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { ConversationModelPicker, type ConversationModelPickerProps } from "./conversation-model-picker";
import { useConversationModelMenu } from "./use-conversation-model-menu.ts";
import styles from "./conversation-model-picker.module.css";

/** Composer 可请求打开或聚焦模型选择器，但不接管内部菜单状态。 */
export type ConversationModelSelectorHandle = {
  open: () => void;
  focus: () => void;
};

export type ConversationModelSelectorProps = ConversationModelPickerProps & {
  disabled?: boolean;
};

/**
 * 模型选择器装配层：集中负责触发器、外部点击、Escape、Tab 离开关闭和焦点恢复；
 * Picker 只处理当前钻取层与即时选择。
 */
export const ConversationModelSelector = forwardRef<ConversationModelSelectorHandle, ConversationModelSelectorProps>(function ConversationModelSelector({
  connections,
  disabled = false,
  purpose,
  selectedConnectionId,
  selectedModelId,
  selectedRuntimeValues,
  onOpenConnections,
  onSelect,
}, ref) {
  const { close, menuId, menuRef, open, openMenu, toggle, triggerRef } = useConversationModelMenu();
  const tabbingRef = useRef(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const [mobileBottom, setMobileBottom] = useState(124);
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId);
  const triggerTitle = selectedConnection && selectedModelId
    ? `${selectedConnection.label} · ${selectedModelId}`
    : "选择模型";

  useImperativeHandle(ref, () => ({
    focus: () => triggerRef.current?.focus(),
    open: () => { if (!disabled) openMenu(); },
  }), [disabled, openMenu, triggerRef]);

  useEffect(() => {
    if (disabled && open) close(false);
  }, [close, disabled, open]);

  /** 移动端按 Composer 实际顶部定位，附件 chips 换行时浮层也不会覆盖输入区。 */
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const trigger = triggerRef.current;
    const composer = trigger?.closest<HTMLElement>("[data-conversation-composer]");
    if (!trigger) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const anchorTop = (composer ?? trigger).getBoundingClientRect().top;
        setMobileBottom(Math.max(10, Math.round(viewportHeight - anchorTop + 8)));
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(trigger);
    if (composer) observer.observe(composer);
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [disabled, open, triggerRef]);

  function openConnections() {
    close(false);
    onOpenConnections();
  }

  return (
    <div
      ref={selectorRef}
      className={styles.selector}
      style={{ "--model-picker-mobile-bottom": `${mobileBottom}px` } as CSSProperties}
      onFocusCapture={() => { tabbingRef.current = false; }}
      onBlurCapture={(event) => {
        if (!tabbingRef.current) return;
        const selector = event.currentTarget;
        window.requestAnimationFrame(() => {
          if (!selector.contains(document.activeElement)) close(false);
          tabbingRef.current = false;
        });
      }}
      onKeyDownCapture={(event) => { tabbingRef.current = event.key === "Tab"; }}
    >
      <button
        ref={triggerRef}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open && !disabled}
        aria-haspopup="dialog"
        aria-label="选择模型"
        className={styles.trigger}
        disabled={disabled}
        title={triggerTitle}
        type="button"
        onClick={toggle}
      >
        {selectedConnection && selectedModelId ? (
          <>
            <ProviderIcon provider={selectedConnection.provider} size={18} />
            <span>{selectedModelId}</span>
            <AppIcon name="chevronDown" size={16} />
          </>
        ) : (
          <>
            <AppIcon name="sparkles" size={18} />
            <span>选择模型</span>
          </>
        )}
      </button>
      {open && !disabled ? (
        <ConversationModelPicker
          ref={menuRef}
          id={menuId}
          connections={connections}
          purpose={purpose}
          selectedConnectionId={selectedConnectionId}
          selectedModelId={selectedModelId}
          selectedRuntimeValues={selectedRuntimeValues}
          onOpenConnections={openConnections}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
});
