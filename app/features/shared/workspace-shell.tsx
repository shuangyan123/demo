import type { ReactNode } from "react";

// 渲染左上角侧栏切换按钮，使用按钮语义让键盘和屏幕阅读器都能识别当前折叠状态。
export function SidebarToggleButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      className="sidebar-toggle-button grid h-7 w-7 place-items-center rounded-lg border border-line text-muted hover:bg-chrome-hover hover:text-foreground"
      type="button"
      aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
      aria-pressed={collapsed}
      onClick={onToggle}
    >
      <span className="h-3 w-1 rounded-sm border border-current" />
    </button>
  );
}

// 渲染应用顶部栏；只保留真实可用的侧栏切换、返回和当前区域标题。
export function WindowMenuBar({
  sidebarCollapsed,
  title = "错题复盘",
  onBack,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  title?: string;
  onBack?: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="chrome-topbar z-40 flex shrink-0 items-center gap-3 border-b border-chrome-sidebar-border px-3 text-sm text-muted">
      <SidebarToggleButton collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
      {onBack && (
        <button
          className="inline-grid h-8 w-8 place-items-center rounded-lg transition hover:bg-settings-selected hover:text-foreground"
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
  sidebar,
  sidebarClassName = "",
  sidebarCollapsed,
  title,
  onBack,
  onToggleSidebar,
}: {
  children: ReactNode;
  contentClassName?: string;
  sidebar: ReactNode;
  sidebarClassName?: string;
  sidebarCollapsed: boolean;
  title: string;
  onBack?: () => void;
  onToggleSidebar: () => void;
}) {
  const sidebarStateClass = sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-expanded";

  return (
    <div className="chrome-shell flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <WindowMenuBar sidebarCollapsed={sidebarCollapsed} title={title} onBack={onBack} onToggleSidebar={onToggleSidebar} />
      <div
        className={`chrome-layout ${sidebarStateClass} min-h-0 flex-1`}
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
      >
        <aside aria-hidden={sidebarCollapsed} className={`chrome-sidebar diffuse-sidebar settings-sidebar-scroll relative z-30 min-h-0 border-r border-chrome-sidebar-border ${sidebarClassName}`}>
          {sidebar}
        </aside>
        <main className={`chrome-content min-h-0 min-w-0 overflow-y-auto overscroll-y-none ${contentClassName}`}>{children}</main>
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
  return (
    <nav className="scrollbar-none grid gap-1 max-lg:flex max-lg:overflow-x-auto max-lg:pb-1" aria-label="侧栏导航">
      {items.map((item) => (
        <button
          key={item.key}
          className={`grid min-h-9 grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium max-lg:min-h-11 max-lg:min-w-36 ${
            activeKey === item.key ? "bg-chrome-selected" : "hover:bg-chrome-hover"
          }`}
          type="button"
          onClick={() => onSelect(item.key)}
        >
          {renderIcon(item.icon)}
          <span className="truncate">{item.label}</span>
          {item.badge ? <span className="inline-grid min-h-5 min-w-5 place-items-center rounded-full bg-blue px-1 text-[11px] text-white">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}

// 渲染工作台内容区标题、状态提示和右侧操作，统一主应用各视图顶部布局。
export function ViewHeader({ actions, eyebrow, title }: { actions?: ReactNode; eyebrow: string; title: string }) {
  return (
    <header className="mb-5 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
      <div>
        <p className="mb-1 text-xs font-medium text-muted" role="status">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}
