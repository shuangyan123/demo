"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { UiReviewPackId } from "./ui-review-scenario-registry.ts";

type UiReviewDataActions = {
  installPack: (packId: UiReviewPackId) => Promise<void>;
  busy: boolean;
  active: boolean;
  ready: boolean;
};

const UiReviewDataContext = createContext<UiReviewDataActions | null>(null);

export function UiReviewDataProvider({
  active,
  busy,
  children,
  installPack,
  ready,
}: UiReviewDataActions & { children: ReactNode }) {
  const value = useMemo(() => ({ active, busy, installPack, ready }), [active, busy, installPack, ready]);
  return <UiReviewDataContext.Provider value={value}>{children}</UiReviewDataContext.Provider>;
}

export function useUiReviewData(): UiReviewDataActions | null {
  return useContext(UiReviewDataContext);
}

export function UiReviewEmptyAction({ packId }: { packId?: UiReviewPackId }) {
  const actions = useUiReviewData();
  if (!actions || !packId) return null;
  return (
    <button
      className="ui-button ui-button-outline ui-button-sm ui-empty-review-action"
      disabled={actions.busy}
      type="button"
      onClick={() => void actions.installPack(packId)}
    >
      载入本模块审查数据
    </button>
  );
}
