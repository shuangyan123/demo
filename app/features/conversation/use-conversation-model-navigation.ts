"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ApiProvider } from "../../types/domains/ai-provider";

export type ConversationModelRuntimeDimension = "reasoning" | "speed";

/** 模型菜单当前唯一可见的钻取层。 */
export type ConversationModelPickerView =
  | { kind: "providers" }
  | { kind: "models"; provider: ApiProvider; connectionId: string }
  | { kind: "runtime"; provider: ApiProvider; connectionId: string; dimension: ConversationModelRuntimeDimension };

type UseConversationModelNavigationOptions = {
  pickerRef: RefObject<HTMLDivElement | null>;
};

const FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), select:not([disabled])";

/**
 * 管理菜单钻取与跨层焦点。前进时聚焦新层的当前选项，返回时恢复触发钻取的入口行，
 * 不把已卸载层留在 Tab 顺序里。
 */
export function useConversationModelNavigation({ pickerRef }: UseConversationModelNavigationOptions) {
  const [view, setView] = useState<ConversationModelPickerView>({ kind: "providers" });
  const pendingFocusKeyRef = useRef<string | undefined>(undefined);

  const navigate = useCallback((nextView: ConversationModelPickerView, focusKey?: string) => {
    pendingFocusKeyRef.current = focusKey;
    setView(nextView);
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const picker = pickerRef.current;
      if (!picker) return;
      const focusKey = pendingFocusKeyRef.current;
      pendingFocusKeyRef.current = undefined;
      const keyedTarget = focusKey
        ? Array.from(picker.querySelectorAll<HTMLElement>("[data-picker-focus-key]")).find((item) => item.dataset.pickerFocusKey === focusKey)
        : undefined;
      const defaultTarget = picker.querySelector<HTMLElement>("[data-picker-default-focus]");
      const fallbackTarget = picker.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      const target = keyedTarget ?? defaultTarget ?? fallbackTarget;
      if (!target) return;
      target.dataset.tooltipProgrammaticFocus = "true";
      target.focus();
      window.requestAnimationFrame(() => delete target.dataset.tooltipProgrammaticFocus);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pickerRef, view]);

  const showModels = useCallback((provider: ApiProvider, connectionId: string) => {
    navigate({ kind: "models", provider, connectionId });
  }, [navigate]);

  const showRuntime = useCallback((provider: ApiProvider, connectionId: string, dimension: ConversationModelRuntimeDimension) => {
    navigate({ kind: "runtime", provider, connectionId, dimension });
  }, [navigate]);

  const changeConnection = useCallback((provider: ApiProvider, connectionId: string) => {
    navigate({ kind: "models", provider, connectionId });
  }, [navigate]);

  const back = useCallback(() => {
    if (view.kind === "runtime") {
      navigate(
        { kind: "models", provider: view.provider, connectionId: view.connectionId },
        `runtime-entry:${view.dimension}`,
      );
      return;
    }
    if (view.kind === "models") {
      navigate({ kind: "providers" }, `provider:${view.provider}`);
    }
  }, [navigate, view]);

  return { back, changeConnection, showModels, showRuntime, view };
}
