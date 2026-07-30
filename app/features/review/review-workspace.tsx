"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { DEVELOPMENT_EXAMPLE_CHANGE_EVENT } from "../shared/development-example-switcher";
import { isWorkspaceDevelopmentExample } from "../shared/development-example-registry";
import { ReviewWorkspaceBootstrap } from "./review-workspace-bootstrap";
import { ReviewWorkspaceViewRouter } from "./review-workspace-view-router";
import { useReviewWorkspaceController } from "./use-review-workspace-controller.ts";

const DevelopmentExampleWorkspace = process.env.NODE_ENV === "development"
  ? dynamic(() => import("../shared/development-example-workspace").then((module) => module.DevelopmentExampleWorkspace))
  : undefined;

function subscribeToDevelopmentExample(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(DEVELOPMENT_EXAMPLE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(DEVELOPMENT_EXAMPLE_CHANGE_EVENT, onStoreChange);
  };
}

/** 开发示例在业务 controller 挂载前分流，保证 fixture 不读取仓储或调用外部服务。 */
export function ReviewWorkspace() {
  const developmentExample = useSyncExternalStore(
    subscribeToDevelopmentExample,
    () => process.env.NODE_ENV === "development" ? new URLSearchParams(window.location.search).get("example") ?? undefined : undefined,
    () => undefined,
  );
  if (DevelopmentExampleWorkspace && isWorkspaceDevelopmentExample(developmentExample)) {
    return <DevelopmentExampleWorkspace initialExample={developmentExample} />;
  }
  return <ReviewWorkspaceBootstrap><ReviewWorkspaceLive developmentExample={developmentExample} /></ReviewWorkspaceBootstrap>;
}

/** 真实工作台继续只组合 controller 与视图路由。 */
function ReviewWorkspaceLive({ developmentExample }: { developmentExample?: string }) {
  const controller = useReviewWorkspaceController();
  return <ReviewWorkspaceViewRouter controller={controller} developmentExample={developmentExample} />;
}
