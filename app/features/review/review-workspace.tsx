"use client";

import { ReviewWorkspaceBootstrap } from "./review-workspace-bootstrap";
import { ReviewWorkspaceViewRouter } from "./review-workspace-view-router";
import { useReviewWorkspaceController } from "./use-review-workspace-controller.ts";
import { useReviewWorkspaceSampleScope } from "./use-review-workspace-sample-scope";

type SampleScopeController = ReturnType<typeof useReviewWorkspaceSampleScope>;

export function ReviewWorkspace() {
  const samples = useReviewWorkspaceSampleScope();
  return (
    <ReviewWorkspaceBootstrap>
      <ReviewWorkspaceLive
        key={samples.controllerKey}
        scope={samples.scope}
        onClearSamples={samples.clearSamples}
        onExitSample={samples.exitSample}
        onLoadSample={samples.loadSample}
      />
    </ReviewWorkspaceBootstrap>
  );
}

/** 真实工作台继续只组合 controller 与视图路由。 */
function ReviewWorkspaceLive({
  scope,
  onClearSamples,
  onExitSample,
  onLoadSample,
}: {
  scope: SampleScopeController["scope"];
  onClearSamples: SampleScopeController["clearSamples"];
  onExitSample: SampleScopeController["exitSample"];
  onLoadSample: SampleScopeController["loadSample"];
}) {
  const controller = useReviewWorkspaceController(scope);
  return (
    <ReviewWorkspaceViewRouter
      controller={controller}
      scope={scope}
      onClearSamples={onClearSamples}
      onExitSample={onExitSample}
      onLoadSample={onLoadSample}
    />
  );
}
