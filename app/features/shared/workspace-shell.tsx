import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref } from "react";
import { AppIcon } from "./app-icon";
// 渲染左上角侧栏切换按钮，使用按钮语义让键盘和屏幕阅读器都能识别当前折叠状态。
export function SidebarToggleButton({
  buttonRef,
  collapsed,
  onToggle,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      className="sidebar-toggle-button grid h-7 w-7 place-items-center rounded-lg border border-line text-muted hover:bg-chrome-hover hover:text-foreground max-lg:h-11 max-lg:w-11"
      type="button"
      aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
      aria-pressed={collapsed}
      onClick={onToggle}
    >
      <AppIcon name="sidebar" size={18} />
    </button>
  );
}
// 渲染应用顶部栏；只保留真实可用的侧栏切换、返回和当前区域标题。
export function WindowMenuBar({
  sidebarButtonRef,
  sidebarCollapsed,
  title = "错题复盘",
  onBack,
  onToggleSidebar,
}: {
  sidebarButtonRef?: Ref<HTMLButtonElement>;
  sidebarCollapsed: boolean;
  title?: string; onBack?: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="chrome-topbar z-40 flex shrink-0 items-center gap-3 px-3 text-sm text-muted">
      <SidebarToggleButton buttonRef={sidebarButtonRef} collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
      {onBack && (
        <button
          className="hidden h-8 w-8 place-items-center rounded-lg transition hover:bg-settings-selected hover:text-foreground max-lg:inline-grid"
          type="button"
          aria-label="返回"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span>
        </button>
      )}
      <strong className="truncate text-foreground">{title}</strong>
    </header>
  );
}
// 渲染 Codex 风格工作台壳层，统一顶部栏、侧栏折叠、内容滚动和弥散侧栏结构。
export function WorkspaceShell({
  children,
  contentClassName = "",
  contentSurface = "raised-surface",
  sidebar,
  sidebarClassName = "",
  sidebarCollapsed,
  title,
  onBack,
  onToggleSidebar,
}: {
  children: ReactNode;
  contentClassName?: string;
  contentSurface?: "plain" | "raised-surface";
  sidebar: ReactNode;
  sidebarClassName?: string;
  sidebarCollapsed: boolean;
  title: string; onBack?: () => void;
  onToggleSidebar: () => void;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const sidebarButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarStateClass = sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-expanded";
  const effectiveCollapsed = isMobile ? !mobileSidebarOpen : sidebarCollapsed;
  // 移动端侧栏是临时抽屉，桌面端继续使用既有持久化折叠状态。
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMobileSidebarOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  // 抽屉打开时锁定滚动、约束 Tab 焦点，并在关闭后恢复触发按钮焦点。
  useEffect(() => {
    if (!isMobile || !mobileSidebarOpen) return;
    const drawer = mobileSidebarRef.current;
    const restoreTarget = sidebarButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    document.body.style.overflow = "hidden";
    drawer?.querySelector<HTMLElement>(focusableSelector)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileSidebarOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const controls = [...drawer.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => restoreTarget?.focus());
    };
  }, [isMobile, mobileSidebarOpen]);
  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen((current) => !current);
      return;
    }
    onToggleSidebar();
  }, [isMobile, onToggleSidebar]);
  // 只有显式标记的导航动作会关闭移动抽屉，展开项目等局部操作仍可留在抽屉内完成。
  const handleMobileSidebarAction = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!isMobile) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-mobile-sidebar-close="true"]')) setMobileSidebarOpen(false);
  }, [isMobile]);

  return (
    <div
      className="chrome-shell flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <WindowMenuBar
        sidebarButtonRef={sidebarButtonRef}
        sidebarCollapsed={effectiveCollapsed}
        title={title}
        onBack={onBack}
        onToggleSidebar={toggleSidebar}
      />
      <div
        className={`chrome-layout ${sidebarStateClass} min-h-0 flex-1`}
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
        data-mobile-sidebar={mobileSidebarOpen ? "open" : "closed"}
      >
        <button
          className="chrome-mobile-sidebar-backdrop"
          type="button"
          aria-label="关闭侧边栏"
          tabIndex={mobileSidebarOpen ? 0 : -1}
          onClick={() => setMobileSidebarOpen(false)}
        />
        <aside
          ref={mobileSidebarRef}
          aria-hidden={effectiveCollapsed}
          inert={effectiveCollapsed}
          aria-label={isMobile ? "应用导航" : undefined}
          aria-modal={isMobile && mobileSidebarOpen ? true : undefined}
          className={`chrome-sidebar diffuse-sidebar settings-sidebar-scroll relative z-30 min-h-0 ${sidebarClassName}`}
          role={isMobile ? "dialog" : undefined}
          onClickCapture={handleMobileSidebarAction}
        >
          {sidebar}
        </aside>
        <div className="chrome-content-frame" data-content-surface={contentSurface}><main className={`chrome-content min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-none ${contentClassName}`}>{children}</main></div>
      </div>
    </div>
  );
}

// 渲染侧栏导航列表，图标由调用方传入，便于主应用和设置页共享同一个导航结构。
export function SidebarNav<T extends string>({
  activeKey,
  items,
  renderIcon,
  onSelect,
}: {
  activeKey: T;
  items: Array<{ key: T; label: string; icon: string; badge?: ReactNode }>;
  renderIcon: (icon: string) => ReactNode;
  onSelect: (key: T) => void;
}) {
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // 移动端横向导航在切换分区后把当前项带入视口，避免内容已切换但选中项仍藏在屏幕外。
  useEffect(() => {
    if (!window.matchMedia("(max-width: 1024px)").matches) return;
    activeItemRef.current?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
  }, [activeKey]);

  return (
    <nav className="scrollbar-none grid gap-px" aria-label="侧栏导航">
      {items.map((item) => (
        <button
          key={item.key}
          data-mobile-sidebar-close="true"
          ref={activeKey === item.key ? activeItemRef : undefined}
          className={`grid min-h-8 grid-cols-[18px_1fr_auto] items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium max-lg:min-h-11 max-lg:grid-cols-[20px_1fr_auto] max-lg:gap-2.5 max-lg:px-3 ${
            activeKey === item.key ? "bg-chrome-selected" : "hover:bg-chrome-hover"
          }`}
          type="button"
          onClick={() => onSelect(item.key)}
        >
          {renderIcon(item.icon)}
          <span className="truncate">{item.label}</span>
          {item.badge ? <span className="inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[11px] text-[var(--surface)]">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}

// 渲染工作台内容区标题、状态提示和右侧操作，统一主应用各视图顶部布局。
export function ViewHeader({ actions, eyebrow, title }: { actions?: ReactNode; eyebrow: string; title: string }) {
  return (
    <header className="workspace-view-header mb-5 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
      <div>
        <p className="mb-1 text-xs font-medium text-muted" role="status">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
