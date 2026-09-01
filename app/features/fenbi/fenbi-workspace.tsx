"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FenbiViewState } from "../../platform/capabilities";
import { resolveHost } from "../../platform/host";
import {
  getNativeSurfaceOcclusionSnapshot,
  subscribeNativeSurfaceOcclusion,
} from "../shared/ui-overlay-events";

const BROWSER_FENBI_URL = "https://www.fenbi.com/";
const NO_SUBSCRIBE = () => () => undefined;
const SERVER_OCCLUSION_SNAPSHOT = { occluded: false, sources: [] as readonly string[] };

function FenbiBrowserFallback() {
  return (
    <section className="ui-empty grid max-w-lg gap-2" data-fenbi-browser-fallback="true" role="status" style={{ margin: "auto" }}>
      <strong className="text-foreground">粉笔练习</strong>
      <p className="text-sm">粉笔嵌入仅桌面版可用</p>
      <a className="font-medium text-foreground" href={BROWSER_FENBI_URL} rel="noreferrer" target="_blank">在浏览器中打开粉笔</a>
    </section>
  );
}

function FenbiViewUnavailable() {
  return (
    <section className="ui-empty grid max-w-lg gap-2" data-fenbi-view-unavailable="true" role="alert" style={{ margin: "auto" }}>
      <strong className="text-foreground">粉笔练习暂不可用</strong>
      <p className="text-sm">桌面视图暂时没有准备好，请稍后重试。</p>
    </section>
  );
}

/** 维护 native WebContentsView 的 DOM 几何锚点；不在 renderer 复制或接管远程页面。 */
function FenbiNativeSurfaceSlot({ view, viewState }: { view?: ReturnType<typeof resolveHost>["capabilities"]["fenbiView"]; viewState: FenbiViewState | undefined }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  const scheduleBounds = useCallback(() => {
    if (!view || frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const slot = slotRef.current;
      if (!slot) return;
      const rect = slot.getBoundingClientRect();
      void view.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }).catch(() => undefined);
    });
  }, [view]);

  useLayoutEffect(() => {
    if (!view) return;
    const slot = slotRef.current;
    if (!slot) return;
    const frame = slot.closest<HTMLElement>('[data-workspace-frame="true"]');
    const layout = slot.closest<HTMLElement>(".chrome-layout");
    const observedElements = [slot, frame, layout].filter((element, index, elements): element is HTMLElement => Boolean(element) && elements.indexOf(element) === index);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleBounds);
    observedElements.forEach((element) => observer?.observe(element));
    const transitionEvents = ["transitionrun", "transitionstart", "transitionend", "transitioncancel"];
    [frame, layout].forEach((element) => transitionEvents.forEach((event) => element?.addEventListener(event, scheduleBounds)));
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("orientationchange", scheduleBounds);
    window.addEventListener("scroll", scheduleBounds, true);
    window.visualViewport?.addEventListener("resize", scheduleBounds);
    scheduleBounds();
    return () => {
      observer?.disconnect();
      [frame, layout].forEach((element) => transitionEvents.forEach((event) => element?.removeEventListener(event, scheduleBounds)));
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("orientationchange", scheduleBounds);
      window.removeEventListener("scroll", scheduleBounds, true);
      window.visualViewport?.removeEventListener("resize", scheduleBounds);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [scheduleBounds, view]);

  return (
    <div ref={slotRef} aria-label="粉笔练习区域" className="relative flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden bg-surface" data-fenbi-native-surface-slot="true">
      {viewState && !viewState.available ? <FenbiViewUnavailable /> : null}
    </div>
  );
}

export function FenbiWorkspace() {
  const isDesktop = useSyncExternalStore(NO_SUBSCRIBE, () => resolveHost().kind === "desktop", () => false);
  const runtime = useMemo(() => {
    const resolved = resolveHost();
    return (isDesktop && resolved.kind === "desktop") || (!isDesktop && resolved.kind !== "desktop") ? resolved : resolveHost();
  }, [isDesktop]);
  const view = runtime.capabilities.fenbiView;
  const occlusion = useSyncExternalStore(subscribeNativeSurfaceOcclusion, getNativeSurfaceOcclusionSnapshot, () => SERVER_OCCLUSION_SNAPSHOT);
  const [viewState, setViewState] = useState<FenbiViewState>();
  const effectiveViewState = view ? viewState : undefined;

  useEffect(() => {
    if (!view) return;
    let active = true;
    const unsubscribe = view.onStateChanged((next) => {
      if (active) setViewState(next);
    });
    void view.getState().then((next) => {
      if (active) setViewState(next);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [view]);

  useEffect(() => {
    if (!view) return;
    const operation = occlusion.occluded ? view.hide() : view.show();
    void operation.then((next) => setViewState(next)).catch(() => undefined);
  }, [occlusion.occluded, view]);

  useEffect(() => {
    if (!view) return;
    return () => {
      void view.hide().catch(() => undefined);
    };
  }, [view]);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 bg-surface"
      data-fenbi-workspace="true"
      data-fenbi-view-available={effectiveViewState?.available ? "true" : "false"}
      data-native-surface-occluded={occlusion.occluded ? "true" : "false"}
    >
      {isDesktop && view ? <FenbiNativeSurfaceSlot view={view} viewState={effectiveViewState} /> : <FenbiBrowserFallback />}
    </div>
  );
}
