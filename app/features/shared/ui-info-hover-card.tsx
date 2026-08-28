"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { computeUiOverlayPosition, type UiOverlayPlacement } from "./ui-overlay-position";
import { INTERACTIVE_OVERLAY_OPEN_EVENT } from "./ui-overlay-events";
import { dismissUiHints } from "./ui-tooltip";

type UiInfoHoverCardRenderProps = {
  contentId: string;
  expanded: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  toggleForTouch: () => void;
};

const CLOSE_GRACE_MS = 160;

/** 只读信息卡：桌面 hover/focus，触屏 tap；不提供动作，也不接管焦点。 */
export function UiInfoHoverCard({
  children,
  content,
  contentClassName,
  contentLabel,
  placement = "top",
}: {
  children: (props: UiInfoHoverCardRenderProps) => ReactNode;
  content: ReactNode;
  contentClassName: string;
  contentLabel: string;
  placement?: UiOverlayPlacement;
}) {
  const contentId = useId();
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const lastPointerTypeRef = useRef<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false });

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === undefined) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);

  const open = useCallback(() => {
    clearCloseTimer();
    dismissUiHints();
    setExpanded(true);
  }, [clearCloseTimer]);

  const close = useCallback(() => {
    clearCloseTimer();
    setExpanded(false);
    setPosition((current) => ({ ...current, visible: false }));
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(close, CLOSE_GRACE_MS);
  }, [clearCloseTimer, close]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const card = contentRef.current;
    if (!trigger || !card) return;
    setPosition({
      ...computeUiOverlayPosition({
        anchor: trigger.getBoundingClientRect(),
        overlay: card.getBoundingClientRect(),
        placement,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }),
      visible: true,
    });
  }, [placement]);

  useLayoutEffect(() => {
    if (!expanded) return;
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [expanded, updatePosition]);

  useEffect(() => {
    if (!expanded) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (contentRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [close, expanded]);

  useEffect(() => {
    window.addEventListener(INTERACTIVE_OVERLAY_OPEN_EVENT, close);
    return () => window.removeEventListener(INTERACTIVE_OVERLAY_OPEN_EVENT, close);
  }, [close]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  function handlePointerEnter(event: ReactPointerEvent<HTMLDivElement>): void {
    lastPointerTypeRef.current = event.pointerType;
    if (event.pointerType !== "touch") open();
  }

  function handleFocus(event: FocusEvent<HTMLDivElement>): void {
    if (lastPointerTypeRef.current === "touch") return;
    if (event.currentTarget.contains(event.target)) open();
  }

  return (
    <div
      ref={anchorRef}
      className="ui-info-hover-card-anchor"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={scheduleClose}
      onPointerDown={(event) => { lastPointerTypeRef.current = event.pointerType; }}
      onKeyDownCapture={() => { lastPointerTypeRef.current = undefined; }}
      onFocusCapture={handleFocus}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextTarget) && !contentRef.current?.contains(nextTarget)) scheduleClose();
      }}
    >
      {children({
        contentId,
        expanded,
        triggerRef,
        toggleForTouch: () => {
          if (lastPointerTypeRef.current !== "touch") return;
          if (expanded) close();
          else open();
        },
      })}
      {expanded && typeof document !== "undefined" ? createPortal(
        <div
          ref={contentRef}
          id={contentId}
          aria-label={contentLabel}
          className={contentClassName}
          role="tooltip"
          style={{ left: position.left, top: position.top, visibility: position.visible ? "visible" : "hidden" }}
          onPointerEnter={clearCloseTimer}
          onPointerLeave={scheduleClose}
        >
          {content}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
