"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { computeUiOverlayPosition, type UiOverlayPlacement } from "./ui-overlay-position";

type UiPopoverRenderProps = {
  contentId: string;
  expanded: boolean;
  toggle: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/** 点击式共享浮层：通过 portal 脱离裁剪容器，并统一碰撞、关闭与焦点恢复语义。 */
export function UiPopover({
  children,
  content,
  contentClassName,
  contentLabel,
  placement = "top-end",
}: {
  children: (props: UiPopoverRenderProps) => ReactNode;
  content: ReactNode;
  contentClassName: string;
  contentLabel: string;
  placement?: UiOverlayPlacement;
}) {
  const contentId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, visible: false });

  const close = useCallback((restoreFocus = true) => {
    setExpanded(false);
    setPosition((current) => ({ ...current, visible: false }));
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = contentRef.current;
    if (!trigger || !popover) return;
    setPosition({
      ...computeUiOverlayPosition({
        anchor: trigger.getBoundingClientRect(),
        overlay: popover.getBoundingClientRect(),
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
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [close, expanded]);

  return (
    <>
      {children({ contentId, expanded, toggle: () => setExpanded((current) => !current), triggerRef })}
      {expanded && typeof document !== "undefined" ? createPortal(
        <div
          ref={contentRef}
          id={contentId}
          aria-label={contentLabel}
          className={contentClassName}
          role="dialog"
          style={{ left: position.left, top: position.top, visibility: position.visible ? "visible" : "hidden" }}
        >
          {content}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
