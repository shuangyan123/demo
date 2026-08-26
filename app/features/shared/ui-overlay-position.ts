export type UiOverlayPlacement = "right" | "top-end";

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
  placement: UiOverlayPlacement;
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

  if (placement === "right") {
    const preferredLeft = anchor.right + gap;
    const flippedLeft = anchor.left - overlay.width - gap;
    const left = preferredLeft + overlay.width <= viewportWidth - gutter ? preferredLeft : flippedLeft;
    return {
      left: clampLeft(left),
      top: clampTop(anchor.top + (anchor.height - overlay.height) / 2),
    };
  }

  const preferredTop = anchor.top - overlay.height - gap;
  const flippedTop = anchor.bottom + gap;
  const top = preferredTop >= gutter ? preferredTop : flippedTop;
  return {
    left: clampLeft(anchor.right - overlay.width),
    top: clampTop(top),
  };
}
