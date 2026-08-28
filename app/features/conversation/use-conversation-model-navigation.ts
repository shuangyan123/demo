"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";

export type ConversationModelRuntimeDimension = "reasoning" | "speed";

/** 模型菜单当前唯一可见的钻取层。 */
export type ConversationModelPickerView =
  | { kind: "controls" }
  | { kind: "providers" }
  | { kind: "models"; provider: ApiProvider; connectionId: string }
  | { kind: "runtime"; provider: ApiProvider; connectionId: string; dimension: ConversationModelRuntimeDimension };

type UseConversationModelNavigationOptions = {
  initialView?: ConversationModelPickerView;
  pickerRef: RefObject<HTMLDivElement | null>;
};

const FOCUSABLE_SELECTOR = "button:not([disabled]), input:not([disabled]), select:not([disabled])";

/**
 * 管理菜单钻取与跨层焦点。前进时聚焦新层的当前选项，返回时恢复触发钻取的入口行，
 * 不把已卸载层留在 Tab 顺序里。
 */
export function useConversationModelNavigation({ initialView = { kind: "controls" }, pickerRef }: UseConversationModelNavigationOptions) {
  const [view, setView] = useState<ConversationModelPickerView>(initialView);
  const [focusRevision, setFocusRevision] = useState(0);
  const pendingFocusRef = useRef<{ key?: string } | undefined>(undefined);

  const navigate = useCallback((nextView: ConversationModelPickerView, focus?: { key?: string }) => {
    pendingFocusRef.current = focus;
    if (focus) setFocusRevision((revision) => revision + 1);
    setView(nextView);
  }, []);

  useLayoutEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) return;
    pendingFocusRef.current = undefined;
    const frame = window.requestAnimationFrame(() => {
      const picker = pickerRef.current;
      if (!picker) return;
      const keyedTarget = pendingFocus.key
        ? Array.from(picker.querySelectorAll<HTMLElement>("[data-picker-focus-key]")).find((item) => item.dataset.pickerFocusKey === pendingFocus.key)
        : undefined;
      const defaultTarget = picker.querySelector<HTMLElement>("[data-picker-default-focus]");
      const fallbackTarget = picker.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      const target = keyedTarget ?? defaultTarget ?? fallbackTarget;
      if (!target) return;
      target.dataset.tooltipProgrammaticFocus = "true";
      target.dataset.pickerProgrammaticFocus = "true";
      target.focus();
      window.requestAnimationFrame(() => {
        delete target.dataset.tooltipProgrammaticFocus;
        delete target.dataset.pickerProgrammaticFocus;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRevision, pickerRef, view]);

  const showModels = useCallback((provider: ApiProvider, connectionId: string, focusModels = false) => {
    navigate({ kind: "models", provider, connectionId }, focusModels ? {} : undefined);
  }, [navigate]);

  const showProviders = useCallback((focusProviders = false) => navigate({ kind: "providers" }, focusProviders ? {} : undefined), [navigate]);

  const showRuntime = useCallback((provider: ApiProvider, connectionId: string, dimension: ConversationModelRuntimeDimension, focusOptions = false) => {
    navigate({ kind: "runtime", provider, connectionId, dimension }, focusOptions ? {} : undefined);
  }, [navigate]);

  const changeConnection = useCallback((provider: ApiProvider, connectionId: string) => {
    navigate({ kind: "models", provider, connectionId });
  }, [navigate]);

  const back = useCallback(() => {
    if (view.kind === "runtime") {
      navigate({ kind: "controls" }, { key: `runtime-entry:${view.dimension}` });
      return;
    }
    if (view.kind === "models") {
      navigate({ kind: "providers" }, { key: `provider:${view.provider}` });
      return;
    }
    if (view.kind === "providers") navigate({ kind: "controls" }, { key: "control-entry:model" });
  }, [navigate, view]);

  return { back, changeConnection, showModels, showProviders, showRuntime, view };
}
