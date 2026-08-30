export type UiOverlayPlacement =
  | "auto"
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end";

type RectLike = Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width">;

/** 共享浮层定位只依赖锚点、浮层尺寸和视口，统一处理翻转与四周安全边距。 */
export function computeUiOverlayPosition({
  anchor,
  overlay,
  placement,
  viewportHeight,
  viewportWidth,
  gap = 8,
  gutter = 12,
}: {
  anchor: RectLike;
  overlay: RectLike;
  placement: UiOverlayPlacement | readonly UiOverlayPlacement[];
  viewportHeight: number;
  viewportWidth: number;
  gap?: number;
  gutter?: number;
}): { left: number; top: number } {
  const clampLeft = (left: number) => Math.min(
    Math.max(gutter, viewportWidth - overlay.width - gutter),
    Math.max(gutter, left),
  );
  const clampTop = (top: number) => Math.min(
    Math.max(gutter, viewportHeight - overlay.height - gutter),
    Math.max(gutter, top),
  );

  const preferredPlacements = (Array.isArray(placement) ? placement : [placement]).flatMap((item) => {
    if (item === "auto") return ["right", "left", "top", "bottom"] as const;
    const [side, alignment] = item.split("-") as ["top" | "bottom" | "left" | "right", "start" | "end" | undefined];
    const opposite = side === "right" ? "left" : side === "left" ? "right" : side === "top" ? "bottom" : "top";
    return [item, alignment ? `${opposite}-${alignment}` as UiOverlayPlacement : opposite] as const;
  });

  const candidate = (item: Exclude<UiOverlayPlacement, "auto">): { left: number; top: number } => {
    const [side, alignment] = item.split("-") as ["top" | "bottom" | "left" | "right", "start" | "end" | undefined];
    if (side === "right" || side === "left") {
      const left = side === "right" ? anchor.right + gap : anchor.left - overlay.width - gap;
      const top = alignment === "start"
        ? anchor.top
        : alignment === "end"
          ? anchor.bottom - overlay.height
          : anchor.top + (anchor.height - overlay.height) / 2;
      return { left, top };
    }
    const top = side === "top" ? anchor.top - overlay.height - gap : anchor.bottom + gap;
    const left = alignment === "start"
      ? anchor.left
      : alignment === "end"
        ? anchor.right - overlay.width
        : anchor.left + (anchor.width - overlay.width) / 2;
    return { left, top };
  };

  const fits = ({ left, top }: { left: number; top: number }) => (
    left >= gutter
    && top >= gutter
    && left + overlay.width <= viewportWidth - gutter
    && top + overlay.height <= viewportHeight - gutter
  );
  const selected = preferredPlacements.map(candidate).find(fits) ?? candidate(preferredPlacements[0] ?? "top");
  return { left: clampLeft(selected.left), top: clampTop(selected.top) };
}
