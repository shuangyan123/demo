"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { computeUiOverlayPosition, type UiOverlayPlacement } from "../shared/ui-overlay-position";

export type ConversationModelFlyoutSurface = "provider" | "model" | "runtime";
export type ConversationModelFlyoutPosition = {
  left: number;
  top: number;
  visible: boolean;
};

type PositionMap = Record<ConversationModelFlyoutSurface, ConversationModelFlyoutPosition>;

type UseConversationModelFlyoutPositionOptions = {
  pickerRef: RefObject<HTMLDivElement | null>;
  modelAnchorRef: RefObject<HTMLElement | null>;
  providerAnchorRef: RefObject<HTMLElement | null>;
  runtimeAnchorRef: RefObject<HTMLElement | null>;
  providerSurfaceRef: RefObject<HTMLElement | null>;
  modelSurfaceRef: RefObject<HTMLElement | null>;
  runtimeSurfaceRef: RefObject<HTMLElement | null>;
  surfaceKey: string;
};

const GAP = 6;
const VIEWPORT_GUTTER = 12;
// Keep direction measurement independent of which child surface is mounted first.
// This matches the model surface's 26.25rem desktop width and prevents provider
// positioning from changing when the model surface appears.
const MAX_CHILD_SURFACE_WIDTH = 26.25 * 16;
// Keep the model panel aligned with its provider row while filtering changes
// content height. This covers the sticky header, optional connection selector,
// and five compact result rows without reserving the old tall empty area.
const MAX_MODEL_SURFACE_HEIGHT = 18.5 * 16;
const HIDDEN_POSITION: ConversationModelFlyoutPosition = { left: 0, top: 0, visible: false };

const initialPositions: PositionMap = {
  provider: HIDDEN_POSITION,
  model: HIDDEN_POSITION,
  runtime: HIDDEN_POSITION,
};

function placementsFor(direction: "left" | "right"): readonly UiOverlayPlacement[] {
  return direction === "right" ? ["right-start", "left-start"] : ["left-start", "right-start"];
}

function positionsEqual(left: PositionMap, right: PositionMap): boolean {
  return (Object.keys(left) as ConversationModelFlyoutSurface[]).every((key) => (
    left[key].left === right[key].left
    && left[key].top === right[key].top
    && left[key].visible === right[key].visible
  ));
}

/**
 * 级联菜单的每一层都独立测量和定位，但方向由同一组 surface 尺寸决定，
 * 避免 Provider 向右、Model 又向左形成交叉菜单。子 surface 不参与父级布局尺寸。
 */
export function useConversationModelFlyoutPosition({
  pickerRef,
  modelAnchorRef,
  providerAnchorRef,
  runtimeAnchorRef,
  providerSurfaceRef,
  modelSurfaceRef,
  runtimeSurfaceRef,
  surfaceKey,
}: UseConversationModelFlyoutPositionOptions): {
  positions: PositionMap;
  direction: "left" | "right";
} {
  const [positions, setPositions] = useState<PositionMap>(initialPositions);
  const [direction, setDirection] = useState<"left" | "right">("right");

  const update = useCallback(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const pickerRect = picker.getBoundingClientRect();
    const widestChild = Math.min(MAX_CHILD_SURFACE_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_GUTTER * 2));
    const nextDirection: "left" | "right" = pickerRect.right + GAP + widestChild <= window.innerWidth - VIEWPORT_GUTTER ? "right" : "left";
    const placements = placementsFor(nextDirection);

    const place = (anchor: HTMLElement | null, surface: HTMLElement | null, stableHeight?: number): ConversationModelFlyoutPosition => {
      if (!anchor || !surface) return HIDDEN_POSITION;
      const surfaceRect = surface.getBoundingClientRect();
      const overlay = stableHeight === undefined
        ? surfaceRect
        : {
          bottom: surfaceRect.top + stableHeight,
          height: stableHeight,
          left: surfaceRect.left,
          right: surfaceRect.right,
          top: surfaceRect.top,
          width: surfaceRect.width,
        };
      const next = computeUiOverlayPosition({
        anchor: anchor.getBoundingClientRect(),
        overlay,
        placement: placements,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        gap: GAP,
        gutter: VIEWPORT_GUTTER,
      });
      return { left: next.left - pickerRect.left, top: next.top - pickerRect.top, visible: true };
    };

    const nextPositions: PositionMap = {
      provider: place(modelAnchorRef.current, providerSurfaceRef.current),
      model: place(
        providerAnchorRef.current,
        modelSurfaceRef.current,
        Math.min(MAX_MODEL_SURFACE_HEIGHT, Math.max(0, window.innerHeight - VIEWPORT_GUTTER * 2)),
      ),
      runtime: place(runtimeAnchorRef.current, runtimeSurfaceRef.current),
    };
    setDirection((current) => current === nextDirection ? current : nextDirection);
    setPositions((current) => positionsEqual(current, nextPositions) ? current : nextPositions);
  }, [modelAnchorRef, pickerRef, providerAnchorRef, providerSurfaceRef, runtimeAnchorRef, runtimeSurfaceRef, modelSurfaceRef]);

  useLayoutEffect(() => {
    update();
    const observer = new ResizeObserver(update);
    for (const element of [pickerRef.current, providerSurfaceRef.current, modelSurfaceRef.current, runtimeSurfaceRef.current]) {
      if (element) observer.observe(element);
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [pickerRef, providerSurfaceRef, modelSurfaceRef, runtimeSurfaceRef, surfaceKey, update]);

  return { direction, positions };
}
