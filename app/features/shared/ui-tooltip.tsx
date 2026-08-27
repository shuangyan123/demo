"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { computeUiOverlayPosition, type UiOverlayPlacement } from "./ui-overlay-position";

type TooltipRenderProps = {
  describedBy: string;
};

type UiTooltipProps = {
  children: (props: TooltipRenderProps) => ReactNode;
  content: ReactNode;
  placement?: UiOverlayPlacement | readonly UiOverlayPlacement[];
};

type TooltipPosition = {
  left: number;
  top: number;
  visible: boolean;
};

const VIEWPORT_GUTTER = 8;
const TOOLTIP_GAP = 8;
const TOOLTIP_DELAY_MS = 450;
const DEFAULT_TOOLTIP_PLACEMENT = ["right", "left", "top", "bottom"] as const;
const activeTooltipListeners = new Set<(activeId: string | undefined) => void>();
let activeTooltipId: string | undefined;

/** 认领当前唯一可见的提示，避免连续聚焦或快速扫过列表时残留多个小框。 */
function setActiveTooltip(id?: string): void {
  activeTooltipId = id;
  activeTooltipListeners.forEach((listener) => listener(id));
}

/** 菜单钻取时的程序化焦点只负责键盘定位，不应创建遮挡内容的提示。 */
function isProgrammaticPickerFocus(event: FocusEvent<HTMLDivElement>): boolean {
  return event.target instanceof HTMLElement && event.target.dataset.tooltipProgrammaticFocus === "true";
}

/**
 * 共享短提示（UiHint）：只承载短文本说明；交互内容仍由 UiPopover 负责。
 * visual overlay 通过 portal 和统一定位器脱离任何 sidebar/canvas 裁剪。
 */
export function UiTooltip({ children, content, placement = DEFAULT_TOOLTIP_PLACEMENT }: UiTooltipProps) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | undefined>(undefined);
  const lastPointerTypeRef = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0, visible: false });

  const clearOpenTimer = useCallback((): void => {
    if (openTimerRef.current === undefined) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = undefined;
  }, []);

  const scheduleOpen = useCallback((): void => {
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      setActiveTooltip(tooltipId);
      setOpen(true);
      openTimerRef.current = undefined;
    }, TOOLTIP_DELAY_MS);
  }, [clearOpenTimer, tooltipId]);

  const closeTooltip = useCallback((): void => {
    clearOpenTimer();
    setOpen(false);
    setPosition((current) => ({ ...current, visible: false }));
    if (activeTooltipId === tooltipId) setActiveTooltip(undefined);
  }, [clearOpenTimer, tooltipId]);

  useEffect(() => {
    const listener = (nextActiveId: string | undefined) => {
      if (nextActiveId !== tooltipId) setOpen(false);
    };
    activeTooltipListeners.add(listener);
    return () => {
      clearOpenTimer();
      activeTooltipListeners.delete(listener);
      if (activeTooltipId === tooltipId) setActiveTooltip(undefined);
    };
  }, [clearOpenTimer, tooltipId]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeTooltip();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeTooltip, open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const next = computeUiOverlayPosition({
        anchor: anchor.getBoundingClientRect(),
        overlay: tooltip.getBoundingClientRect(),
        placement,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        gap: TOOLTIP_GAP,
        gutter: VIEWPORT_GUTTER,
      });
      setPosition({ ...next, visible: true });
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (tooltipRef.current) observer.observe(tooltipRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [content, open, placement]);

  function handlePointerEnter(event: PointerEvent<HTMLDivElement>): void {
    lastPointerTypeRef.current = event.pointerType;
    if (event.pointerType === "touch") return;
    scheduleOpen();
  }

  return (
    <div
      ref={anchorRef}
      className="ui-tooltip-anchor"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={closeTooltip}
      onPointerDown={(event) => {
        lastPointerTypeRef.current = event.pointerType;
        if (event.pointerType === "touch") closeTooltip();
      }}
      onKeyDownCapture={() => { lastPointerTypeRef.current = undefined; }}
      onFocusCapture={(event) => {
        if (isProgrammaticPickerFocus(event)) return;
        if (lastPointerTypeRef.current === "touch") {
          lastPointerTypeRef.current = undefined;
          return;
        }
        scheduleOpen();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeTooltip();
      }}
    >
      {children({ describedBy: tooltipId })}
      {!open ? <span id={tooltipId} className="ui-tooltip-sr-description" role="tooltip">{content}</span> : null}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              className="ui-tooltip-content"
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

/** 新名称用于新代码；UiTooltip 保留为兼容出口。 */
export const UiHint = UiTooltip;
