"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useCallback,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

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
const TOOLTIP_GAP = 8;
const TOOLTIP_DELAY_MS = 450;
const MINIMUM_SIDE_SPACE = 200;
const activeTooltipListeners = new Set<(activeId: string | undefined) => void>();
let activeTooltipId: string | undefined;

/**
 * 认领当前唯一可见的提示，避免模型列表中的多个提示同时残留。
 * @param id 当前提示标识；省略时关闭全部提示
 */
function setActiveTooltip(id?: string): void {
  activeTooltipId = id;
  activeTooltipListeners.forEach((listener) => listener(id));
}

/**
 * 判断焦点是否由菜单钻取时的程序化聚焦产生；这类焦点只负责键盘定位，不应遮挡内容。
 * @param event React 焦点事件
 */
function isProgrammaticPickerFocus(event: FocusEvent<HTMLDivElement>): boolean {
  return event.target instanceof HTMLElement && event.target.dataset.tooltipProgrammaticFocus === "true";
}

/**
 * 共享轻量提示：鼠标悬停或用户键盘聚焦延迟显示，程序化聚焦与触屏不会创建遮挡浮层。
 * 无论浮层是否可见，控件都通过 aria-describedby 关联一份屏幕阅读器描述。
 */
export function UiTooltip({ children, content }: UiTooltipProps) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0, visible: false });

  /** 清理尚未触发的延迟提示。 */
  const clearOpenTimer = useCallback((): void => {
    if (openTimerRef.current === undefined) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = undefined;
  }, []);

  /** 在用户停留足够久后显示提示，减少快速扫过列表时的视觉噪音。 */
  const scheduleOpen = useCallback((): void => {
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      setActiveTooltip(tooltipId);
      setOpen(true);
      openTimerRef.current = undefined;
    }, TOOLTIP_DELAY_MS);
  }, [clearOpenTimer, tooltipId]);

  /** 关闭当前提示，同时释放单例所有权。 */
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
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeTooltip();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeTooltip, open]);

  useLayoutEffect(() => {
    if (!open) return;

    /** 将提示固定放在锚点左右侧；空间不足时不显示可视浮层。 */
    function updatePosition() {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const spaceRight = window.innerWidth - anchorRect.right - TOOLTIP_GAP - VIEWPORT_GUTTER;
      const spaceLeft = anchorRect.left - TOOLTIP_GAP - VIEWPORT_GUTTER;
      const canUseRight = spaceRight >= Math.max(MINIMUM_SIDE_SPACE, tooltipRect.width);
      const canUseLeft = spaceLeft >= Math.max(MINIMUM_SIDE_SPACE, tooltipRect.width);
      if (!canUseRight && !canUseLeft) {
        setPosition((current) => ({ ...current, visible: false }));
        return;
      }
      const left = canUseRight
        ? anchorRect.right + TOOLTIP_GAP
        : anchorRect.left - tooltipRect.width - TOOLTIP_GAP;
      const maximumTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - tooltipRect.height - VIEWPORT_GUTTER);
      const top = Math.min(
        maximumTop,
        Math.max(VIEWPORT_GUTTER, anchorRect.top + (anchorRect.height - tooltipRect.height) / 2),
      );
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

  /** 只响应鼠标或触控笔悬停；触屏点击必须直接完成选择。 */
  function handlePointerEnter(event: PointerEvent<HTMLDivElement>): void {
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
        if (event.pointerType === "touch") closeTooltip();
      }}
      onFocusCapture={(event) => {
        if (!isProgrammaticPickerFocus(event)) scheduleOpen();
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
