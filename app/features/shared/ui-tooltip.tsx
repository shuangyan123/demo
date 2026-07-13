"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./ui-tooltip.module.css";

type TooltipRenderProps = {
  describedBy: string;
};

type UiTooltipProps = {
  children: (props: TooltipRenderProps) => ReactNode;
  content: ReactNode;
};

type TooltipPosition = {
  left: number;
  top: number;
  visible: boolean;
};

const VIEWPORT_GUTTER = 8;
const TOOLTIP_GAP = 6;

/**
 * 共享轻量 tooltip：由整行 hover、键盘 focus 或触屏点击触发，浮层通过 portal
 * 脱离滚动容器，并在视口边缘自动翻转和收敛位置。
 */
export function UiTooltip({ children, content }: UiTooltipProps) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [touchPinned, setTouchPinned] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0, visible: false });

  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const maximumLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - tooltipRect.width - VIEWPORT_GUTTER);
      const left = Math.min(
        maximumLeft,
        Math.max(VIEWPORT_GUTTER, anchorRect.left + (anchorRect.width - tooltipRect.width) / 2),
      );
      const spaceAbove = anchorRect.top - TOOLTIP_GAP;
      const preferredTop = spaceAbove >= tooltipRect.height + VIEWPORT_GUTTER
        ? anchorRect.top - tooltipRect.height - TOOLTIP_GAP
        : anchorRect.bottom + TOOLTIP_GAP;
      const maximumTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - tooltipRect.height - VIEWPORT_GUTTER);
      const top = Math.min(maximumTop, Math.max(VIEWPORT_GUTTER, preferredTop));
      setPosition({ left, top, visible: true });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [content, open]);

  useLayoutEffect(() => {
    if (!touchPinned) return;
    function closeWhenPointerLeaves(event: PointerEvent) {
      if (anchorRef.current?.contains(event.target as Node)) return;
      setTouchPinned(false);
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeWhenPointerLeaves);
    return () => document.removeEventListener("pointerdown", closeWhenPointerLeaves);
  }, [touchPinned]);

  return (
    <div
      ref={anchorRef}
      className={styles.anchor}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!touchPinned && !anchorRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!touchPinned && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        setTouchPinned(true);
        setOpen(true);
      }}
    >
      {children({ describedBy: tooltipId })}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              className={styles.tooltip}
              role="tooltip"
              style={{ left: position.left, top: position.top, visibility: position.visible ? "visible" : "hidden" }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
