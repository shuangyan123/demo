"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from "react";
import { AppIcon } from "./app-icon";
import { UiHint } from "./ui-tooltip";
import type { WorkspaceContextPanelRegistration } from "./workspace-context-registry";

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function elementFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

/** 让已经打开的摘要、菜单或信息提示优先消费 Escape，避免面板抢走交互层级。 */
function isOtherSurfaceFocused(event: KeyboardEvent): boolean {
  const candidates = [elementFrom(event.target), document.activeElement instanceof HTMLElement ? document.activeElement : null];
  return candidates.some((element) => {
    if (!element || element.closest("[data-context-panel='true']")) return false;
    if (element.closest("[data-summary-popover-surface='true'], [data-summary-popover-trigger='true'], [role='tooltip'], [role='dialog']")) return true;
    const expandedOwner = element.closest<HTMLElement>("[aria-expanded='true']");
    return Boolean(expandedOwner && !expandedOwner.closest("[data-context-panel-toggle='true']"));
  });
}

export function ContextPanelHeader({ closeButtonRef, headingId, onClose, title }: { closeButtonRef: RefObject<HTMLButtonElement | null>; headingId: string; onClose: () => void; title: string }) {
  return (
    <header className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2" style={{ minHeight: "var(--chrome-workspace-topbar-height)" }}>
      <h2 className="m-0 min-w-0 truncate text-sm font-bold" id={headingId} title={title}>{title}</h2>
      <UiHint label="关闭上下文面板" placement="bottom">
        {({ describedBy }) => (
          <button
            ref={closeButtonRef}
            aria-describedby={describedBy}
            aria-label="关闭上下文面板"
            className="sidebar-toggle-button grid h-7 w-7 place-items-center rounded-lg border border-line text-muted hover:bg-chrome-hover hover:text-foreground max-lg:h-11 max-lg:w-11"
            data-context-panel-close="true"
            type="button"
            onClick={onClose}
          >
            <AppIcon name="close" size={18} />
          </button>
        )}
      </UiHint>
    </header>
  );
}

export function ContextPanelBody({ children, description, empty }: { children?: ReactNode; description?: string; empty?: boolean }) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4" data-context-panel-body="true" style={{ overscrollBehavior: "contain" }}>
      {description ? <p className="mb-3 text-xs leading-6 text-muted">{description}</p> : null}
      {empty ? <ContextPanelEmptyState /> : children}
    </div>
  );
}

export function ContextPanelEmptyState({ message = "当前工作区暂无专属上下文工具。" }: { message?: string }) {
  return (
    <div className="mx-auto grid max-w-60 gap-2 text-center text-muted" data-context-panel-empty="true" style={{ marginTop: "16vh" }}>
      <AppIcon name="blocks" size={20} />
      <strong className="text-sm text-foreground">暂无上下文工具</strong>
      <p className="m-0 text-xs leading-6">{message}</p>
    </div>
  );
}

type ContextPanelProps = {
  id: string;
  open: boolean;
  registration?: WorkspaceContextPanelRegistration;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

/** 全站唯一右侧面板宿主：桌面 push，移动端 drawer；feature 内容经 registration 注入。 */
export function ContextPanel({ id, onClose, open, registration, triggerRef }: ContextPanelProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // 打开后把焦点放到可见关闭操作，关闭时恢复到稳定的顶栏触发器。
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobile, open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isOtherSurfaceFocused(event)) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (!isMobile || event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, onClose, open]);

  const title = registration?.title ?? "上下文面板";
  const transition = reducedMotion ? "none" : "opacity var(--motion-structure) var(--motion-ease), transform var(--motion-structure) var(--motion-ease)";
  const panelStyle: CSSProperties = {
    position: isMobile ? "fixed" : "relative",
    zIndex: isMobile ? 80 : 3,
    display: "flex",
    minWidth: 0,
    minHeight: 0,
    width: isMobile ? "min(22rem, calc(100vw - 1rem))" : "100%",
    height: isMobile ? "auto" : "100%",
    flexDirection: "column",
    overflow: "hidden",
    gridColumn: isMobile ? undefined : "4",
    top: isMobile ? "var(--chrome-topbar-height)" : undefined,
    right: isMobile ? 0 : undefined,
    bottom: isMobile ? 0 : undefined,
    left: isMobile ? "auto" : undefined,
    borderLeft: "1px solid var(--chrome-context-panel-divider)",
    background: "var(--chrome-context-panel-surface)",
    color: "var(--foreground)",
    opacity: open ? 1 : 0,
    pointerEvents: open ? "auto" : "none",
    transform: open ? "none" : isMobile ? "translateX(100%)" : "translateX(.5rem)",
    transition,
    visibility: open ? "visible" : "hidden",
    boxShadow: isMobile ? "-18px 0 48px rgb(15 23 42 / 16%)" : undefined,
  };
  const backdropStyle: CSSProperties = {
    display: isMobile ? "block" : "none",
    position: "fixed",
    zIndex: 75,
    inset: "var(--chrome-topbar-height) 0 0",
    background: "rgb(15 23 42 / 28%)",
    opacity: open ? 1 : 0,
    pointerEvents: open && isMobile ? "auto" : "none",
    transition: reducedMotion ? "none" : "opacity var(--motion-fast) var(--motion-ease)",
  };
  return (
    <>
      <button
        aria-hidden={!open || !isMobile}
        aria-label="关闭上下文面板"
        className="chrome-context-panel-backdrop"
        data-context-panel-backdrop="true"
        style={backdropStyle}
        tabIndex={open && isMobile ? 0 : -1}
        type="button"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        id={id}
        aria-hidden={!open}
        aria-labelledby={headingId}
        aria-modal={open && isMobile ? true : undefined}
        className="chrome-context-panel"
        data-context-panel="true"
        data-context-panel-content-id={registration?.id ?? "empty"}
        data-open={open ? "true" : "false"}
        inert={!open}
        role={isMobile ? "dialog" : "complementary"}
        style={panelStyle}
      >
        <ContextPanelHeader closeButtonRef={closeButtonRef} headingId={headingId} onClose={onClose} title={title} />
        <ContextPanelBody description={registration?.description} empty={!registration}>
          {registration?.content}
        </ContextPanelBody>
      </aside>
    </>
  );
}

export function ContextPanelToggleButton({ buttonRef, onToggle, open, panelId }: { buttonRef: RefObject<HTMLButtonElement | null>; onToggle: () => void; open: boolean; panelId: string }) {
  const label = open ? "隐藏上下文面板" : "显示上下文面板";
  return (
    <UiHint label={label} placement="bottom">
      {({ describedBy }) => (
        <button
          ref={buttonRef}
          aria-controls={panelId}
          aria-describedby={describedBy}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={label}
          aria-pressed={open}
          className={`workspace-context-panel-toggle sidebar-toggle-button grid h-7 w-7 place-items-center rounded-lg border border-line text-muted hover:bg-chrome-hover hover:text-foreground max-lg:h-11 max-lg:w-11 ${open ? "bg-chrome-selected text-foreground" : ""}`}
          data-context-panel-toggle="true"
          type="button"
          onClick={onToggle}
        >
          <AppIcon name="panelRight" size={18} />
        </button>
      )}
    </UiHint>
  );
}
