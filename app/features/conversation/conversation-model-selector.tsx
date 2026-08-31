"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getAiModelRuntimeDescriptor } from "../../services/model-runtime-descriptors.ts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import type { ConversationModelRuntimeDimension } from "./use-conversation-model-navigation.ts";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import { UiHint } from "../shared/ui-tooltip";
import { getConversationModelProviderOrder } from "./conversation-model-provider-order";
import { ConversationModelPicker, type ConversationModelPickerProps } from "./conversation-model-picker";
import { useConversationModelMenu } from "./use-conversation-model-menu.ts";
import styles from "./conversation-model-picker.module.css";

/** Composer 可请求打开或聚焦模型选择器，但不接管内部菜单状态。 */
export type ConversationModelSelectorHandle = {
  open: () => void;
  openRuntime: (dimension: ConversationModelRuntimeDimension) => void;
  focus: () => void;
};

export type ConversationModelSelectorProps = Omit<ConversationModelPickerProps, "onRequestClose" | "providerOrder"> & {
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
  const tabbingRef = useRef(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const [mobileBottom, setMobileBottom] = useState(124);
  const [initialRuntimeDimension, setInitialRuntimeDimension] = useState<ConversationModelRuntimeDimension>();
  const [sessionProviderOrder, setSessionProviderOrder] = useState<readonly ApiProvider[]>([]);
  const clearPickerSession = useCallback(() => {
    setInitialRuntimeDimension(undefined);
    setSessionProviderOrder([]);
  }, []);
  const { close, menuId, menuRef, open, openMenu, triggerRef } = useConversationModelMenu({ onClose: clearPickerSession });
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId);
  const descriptor = useMemo(() => selectedConnection && selectedModelId ? getAiModelRuntimeDescriptor(selectedConnection.provider, selectedModelId) : undefined, [selectedConnection, selectedModelId]);
  const reasoningLabel = descriptor?.reasoning?.options.find((option) => option.value === (selectedRuntimeValues?.reasoning ?? descriptor.reasoning?.defaultValue))?.label;

  const closePicker = useCallback((restoreFocus = true) => {
    clearPickerSession();
    close(restoreFocus);
  }, [clearPickerSession, close]);

  const openPicker = useCallback((dimension?: ConversationModelRuntimeDimension) => {
    if (open || !openMenu()) return;
    setSessionProviderOrder(getConversationModelProviderOrder(connections, purpose, selectedConnectionId));
    setInitialRuntimeDimension(dimension);
  }, [connections, open, openMenu, purpose, selectedConnectionId]);

  useImperativeHandle(ref, () => ({
    focus: () => triggerRef.current?.focus(),
    open: () => { if (!disabled) openPicker(); },
    openRuntime: (dimension) => { if (!disabled) openPicker(dimension); },
  }), [disabled, openPicker, triggerRef]);

  useEffect(() => {
    if (disabled && open) closePicker(false);
  }, [closePicker, disabled, open]);

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
    closePicker(false);
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
          if (!selector.contains(document.activeElement)) closePicker(false);
          tabbingRef.current = false;
        });
      }}
      onKeyDownCapture={(event) => { tabbingRef.current = event.key === "Tab"; }}
    >
      <UiHint label="选择模型" badge="Ctrl+Shift+M" placement="top">{({ describedBy }) => <button
          ref={triggerRef}
          aria-controls={open ? menuId : undefined}
          aria-describedby={describedBy}
          aria-expanded={open && !disabled}
          aria-haspopup="dialog"
          aria-label="选择模型"
          className={styles.trigger}
          disabled={disabled}
          type="button"
          onClick={() => { if (open) closePicker(false); else openPicker(); }}
        >
          {selectedConnection && selectedModelId ? (
            <>
              <ProviderIcon provider={selectedConnection.provider} size={18} />
              <span>{selectedModelId}{reasoningLabel ? ` · ${reasoningLabel}` : ""}</span>
              <AppIcon name="chevronDown" size={16} />
            </>
          ) : (
            <>
              <AppIcon name="sparkles" size={18} />
              <span>选择模型</span>
            </>
          )}
        </button>}</UiHint>
      {open && !disabled ? (
        <ConversationModelPicker
          ref={menuRef}
          id={menuId}
          connections={connections}
          purpose={purpose}
          providerOrder={sessionProviderOrder}
          selectedConnectionId={selectedConnectionId}
          selectedModelId={selectedModelId}
          selectedRuntimeValues={selectedRuntimeValues}
          initialRuntimeDimension={initialRuntimeDimension}
          onOpenConnections={openConnections}
          onRequestClose={closePicker}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  );
});
