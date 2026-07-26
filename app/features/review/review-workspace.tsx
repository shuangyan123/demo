"use client";

import { useSyncExternalStore } from "react";
import { ReviewWorkspaceViewRouter } from "./review-workspace-view-router";
import { useReviewWorkspaceController } from "./use-review-workspace-controller.ts";

/** 应用根工作台只组合 controller 与视图路由，不直接持有领域业务。 */
export function ReviewWorkspace() {
  const controller = useReviewWorkspaceController();
  const developmentExample = useSyncExternalStore(
    () => () => undefined,
    () => process.env.NODE_ENV === "development" ? new URLSearchParams(window.location.search).get("example") ?? undefined : undefined,
    () => undefined,
  );
  return <ReviewWorkspaceViewRouter controller={controller} developmentExample={developmentExample} />;
}
