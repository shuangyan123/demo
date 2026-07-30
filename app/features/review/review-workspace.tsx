"use client";

import { ReviewWorkspaceBootstrap } from "./review-workspace-bootstrap";
import { ReviewWorkspaceViewRouter } from "./review-workspace-view-router";
import { useReviewWorkspaceController } from "./use-review-workspace-controller.ts";
import { useReviewWorkspaceSampleScope } from "./use-review-workspace-sample-scope";
import { UiReviewDataProvider } from "../shared/ui-review-data-context.tsx";

type SampleScopeController = ReturnType<typeof useReviewWorkspaceSampleScope>;

export function ReviewWorkspace() {
  const samples = useReviewWorkspaceSampleScope();
  return (
    <ReviewWorkspaceBootstrap>
      <UiReviewDataProvider
        active={samples.installedCount > 0}
        busy={samples.busy}
        installPack={samples.installPack}
        ready={samples.reviewReady}
      >
        <ReviewWorkspaceLive
          key={samples.controllerKey}
          busy={samples.busy}
          installedCount={samples.installedCount}
          scope={samples.scope}
          onClearSamples={samples.clearSamples}
          onExitSample={samples.exitSample}
          onInstallAllSamples={samples.installAll}
          onLoadSample={samples.loadSample}
        />
      </UiReviewDataProvider>
    </ReviewWorkspaceBootstrap>
  );
}

/** 真实工作台继续只组合 controller 与视图路由。 */
function ReviewWorkspaceLive({
  busy,
  installedCount,
  scope,
  onClearSamples,
  onExitSample,
  onInstallAllSamples,
  onLoadSample,
}: {
  busy: SampleScopeController["busy"];
  installedCount: SampleScopeController["installedCount"];
  scope: SampleScopeController["scope"];
  onClearSamples: SampleScopeController["clearSamples"];
  onExitSample: SampleScopeController["exitSample"];
  onInstallAllSamples: SampleScopeController["installAll"];
  onLoadSample: SampleScopeController["loadSample"];
}) {
  const controller = useReviewWorkspaceController(scope);
  return (
    <ReviewWorkspaceViewRouter
      controller={controller}
      busy={busy}
      installedCount={installedCount}
      scope={scope}
      onClearSamples={onClearSamples}
      onExitSample={onExitSample}
      onInstallAllSamples={onInstallAllSamples}
      onLoadSample={onLoadSample}
    />
  );
}
