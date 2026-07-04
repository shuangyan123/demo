import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { ExportFormat } from "../../types/review";

type ChipTone = "neutral" | "blue" | "green" | "yellow" | "red";
type ButtonVariant = "primary" | "soft" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md";
type SegmentOption<T extends string> = { key: T; label: string; count?: number };

// 拼接可选 className，避免组件里重复手写 filter(Boolean).join(" ")。
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// 渲染统计指标网格，集中管理总览页和分析页的响应式列数。
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-stat-grid", className)}>{children}</div>;
}

// 渲染总览和知识库顶部使用的指标卡片，统一数字、说明和状态点样式。
export function MetricCard({ label, value, hint, tone }: { label: string; value: string | number; hint: string; tone: string }) {
  return (
    <article className="ui-card">
      <span className="text-sm text-muted">{label}</span>
      <strong className="mt-2 block text-3xl leading-none">{value}</strong>
      <small className={`mt-3 flex items-center gap-2 ${tone}`}>
        <span className="h-2 w-2 rounded-full bg-current" />
        {hint}
      </small>
    </article>
  );
}

// 渲染标签、错因和状态使用的小型胶囊；tone 只控制语义色，不承载业务含义。
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: ChipTone }) {
  const className = {
    neutral: "bg-slate-100 text-slate-600",
    blue: "bg-blue/10 text-blue",
    green: "bg-emerald-50 text-green",
    yellow: "bg-amber-50 text-yellow",
    red: "bg-red/10 text-red",
  }[tone];

  return <span className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-xs ${className}`}>{children}</span>;
}

// 用五段短条展示错题或知识资料掌握度，保持列表和详情页的读数一致。
export function MasteryDots({ value }: { value: number }) {
  return (
    <span className="flex gap-1" aria-label={`掌握度 ${value}/5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <i key={index} className={`h-2 w-3 rounded-sm ${index < value ? "bg-green" : "bg-slate-300"}`} />
      ))}
    </span>
  );
}

// 渲染通用内容面板，集中维护卡片边框、标题和 eyebrow 的视觉层级。
export function Panel({ children, className, title }: { children: ReactNode; className?: string; eyebrow: string; title: string }) {
  return (
    <section className={cx("ui-panel", className)}>
      <h3 className="ui-panel-title">{title}</h3>
      {children}
    </section>
  );
}

// 渲染空状态提示，用于列表、队列和详情未选中场景。
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="ui-empty">{children}</div>;
}

// 渲染详情页中的分段内容，避免答案、解析、计划等区块样式分叉。
export function DetailBlock({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="ui-detail-block">
      <strong className="ui-detail-title">{title}</strong>
      <div className="ui-detail-content">{children}</div>
    </div>
  );
}

// 渲染统一按钮；variant 和 size 是公共语义接口，减少业务组件重复按钮 class。
export function Button({
  children,
  className,
  size = "md",
  type = "button",
  variant = "outline",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  return (
    <button className={cx("ui-button", `ui-button-${variant}`, size === "sm" && "ui-button-sm", className)} type={type} {...props}>
      {children}
    </button>
  );
}

// 渲染仅图标或紧凑图标按钮，继承 Button 的语义色和可访问属性。
export function IconButton({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button className={cx("h-9 w-9 p-0", className)} variant="ghost" {...props}>
      {children}
    </Button>
  );
}

// 渲染可点击卡片，常用于板块、知识分类和推荐条目。
export function CardButton({
  active = false,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
}) {
  return (
    <button className={cx("ui-card ui-card-muted text-left transition hover:border-blue/40 hover:bg-blue/5", active && "ui-list-row-active", className)} type="button" {...props}>
      {children}
    </button>
  );
}

// 渲染通用详情卡片，适合复盘题干、编辑详情和侧栏详情容器。
export function DetailCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("ui-detail-card", className)}>{children}</section>;
}

// 渲染柔和背景信息块，适合题干、导入草稿和辅助说明，不承担点击语义。
export function SoftBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-soft-block", className)}>{children}</div>;
}

// 渲染列表容器，统一卡片列表、队列和关联项之间的间距。
export function DataList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-data-list", className)}>{children}</div>;
}

// 渲染左右两端对齐的数据行，常用于待复盘队列和知识训练队列。
export function DataRow({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article className={cx("ui-data-row", className)} {...props}>
      {children}
    </article>
  );
}

// 渲染通用列表行，支持 active 状态，避免列表项样式在错题和知识库间分叉。
export function ListRow({
  active = false,
  as = "article",
  children,
  className,
}: {
  active?: boolean;
  as?: "article" | "div";
  children: ReactNode;
  className?: string;
}) {
  const Component = as;
  return <Component className={cx("ui-list-row", active && "ui-list-row-active", className)}>{children}</Component>;
}

// 渲染模块标题和右侧操作区，供复杂面板内部复用。
export function SectionHeader({ actions, title }: { actions?: ReactNode; eyebrow?: string; title: string }) {
  return (
    <div className="ui-toolbar">
      <div>
        <h3 className="ui-panel-title mb-0">{title}</h3>
      </div>
      {actions}
    </div>
  );
}

// 渲染横向工具栏，统一按钮组、筛选组和草稿操作区的间距。
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-toolbar", className)}>{children}</div>;
}

// 渲染紧凑分段导航，适合工作台内部 tab；计数只做辅助信息，不承载筛选逻辑。
export function SegmentedTabs<T extends string>({
  active,
  items,
  onChange,
}: {
  active: T;
  items: Array<SegmentOption<T>>;
  onChange: (key: T) => void;
}) {
  return (
    <div className="ui-segmented-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          aria-selected={active === item.key}
          className={cx("ui-segmented-tab", active === item.key && "ui-segmented-tab-active")}
          role="tab"
          type="button"
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {typeof item.count === "number" && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

// 渲染筛选工具栏，专门承载搜索框、下拉框和开关等输入控件。
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-toolbar rounded-lg bg-surface-muted p-4", className)}>{children}</div>;
}

// 渲染标签列表；items 为空时不输出空容器。
export function TagGroup({ items, tone = "neutral" }: { items: string[]; tone?: ChipTone }) {
  if (!items.length) return null;
  return (
    <div className="ui-tag-group">
      {items.map((item) => (
        <Chip key={item} tone={tone}>
          {item}
        </Chip>
      ))}
    </div>
  );
}

// 渲染 0-100 分评分条，统一面试复盘和其他评价型模块的视觉尺度。
export function ScoreBar({ label, max = 100, value }: { label: string; max?: number; value: number }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="ui-score-bar">
      <div className="ui-score-bar-head">
        <span>{label}</span>
        <strong>
          {value}/{max}
        </strong>
      </div>
      <span className="ui-score-bar-track">
        <span style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}

// 渲染纵向时间线，适合展示面试阶段、训练计划步骤和复盘证据片段。
export function Timeline({
  items,
}: {
  items: Array<{ id: string; title: string; description?: ReactNode; active?: boolean; done?: boolean }>;
}) {
  return (
    <ol className="ui-timeline">
      {items.map((item) => (
        <li key={item.id} className={cx("ui-timeline-item", item.active && "ui-timeline-item-active", item.done && "ui-timeline-item-done")}>
          <span className="ui-timeline-dot" />
          <div>
            <strong>{item.title}</strong>
            {item.description && <p>{item.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// 渲染横向阶段轨道，给实时模拟会话展示当前推进到哪一步。
export function SessionStageRail({
  activeId,
  stages,
}: {
  activeId: string;
  stages: Array<{ id: string; label: string }>;
}) {
  const activeIndex = Math.max(0, stages.findIndex((stage) => stage.id === activeId));
  return (
    <div className="ui-stage-rail">
      {stages.map((stage, index) => (
        <span key={stage.id} className={cx("ui-stage-step", index <= activeIndex && "ui-stage-step-done", stage.id === activeId && "ui-stage-step-active")}>
          <i />
          <small>{stage.label}</small>
        </span>
      ))}
    </div>
  );
}

// 渲染表单网格容器，调用方只决定列数相关 class，基础 gap 由组件统一。
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-form-grid", className)}>{children}</div>;
}

// 渲染带复选框的列表行；行点击和勾选分离，避免批量模式下误打开详情。
export function CheckboxRow({
  checked,
  children,
  className,
  onCheckedChange,
}: {
  checked: boolean;
  children: ReactNode;
  className?: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className={cx("ui-checkbox-row", className)}>
      <input checked={checked} className="ui-checkbox" type="checkbox" onChange={(event) => onCheckedChange(event.target.checked)} />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

// 渲染导出格式菜单；调用方决定导出范围，组件只提供 JSON、CSV、Markdown 三种格式入口。
export function ExportMenu({
  disabled = false,
  label,
  onExport,
}: {
  disabled?: boolean;
  label: string;
  onExport: (format: ExportFormat) => void;
}) {
  const formats: Array<[ExportFormat, string]> = [
    ["json", "JSON"],
    ["csv", "CSV"],
    ["markdown", "Markdown"],
  ];
  return (
    <details className="ui-export-menu">
      <summary aria-disabled={disabled} className={cx("ui-button ui-button-outline ui-button-sm", disabled && "pointer-events-none opacity-45")}>
        {label}
      </summary>
      <div className="ui-export-popover">
        {formats.map(([format, text]) => (
          <button key={format} className="ui-export-item" type="button" disabled={disabled} onClick={() => onExport(format)}>
            {text}
          </button>
        ))}
      </div>
    </details>
  );
}

// 渲染批量工具栏，集中管理全选、清空、删除和导出入口，错题库与知识库共用同一套交互文案。
export function BulkToolbar({
  allVisibleSelected,
  selectedCount,
  totalCount,
  onClearSelection,
  onDeleteSelected,
  onExportFiltered,
  onExportSelected,
  onSelectAllVisible,
}: {
  allVisibleSelected: boolean;
  selectedCount: number;
  totalCount: number;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onExportFiltered: (format: ExportFormat) => void;
  onExportSelected: (format: ExportFormat) => void;
  onSelectAllVisible: () => void;
}) {
  return (
    <div className="ui-bulk-toolbar">
      <span className="text-sm font-bold text-muted">
        已选 {selectedCount} 条 / 当前 {totalCount} 条
      </span>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!totalCount || allVisibleSelected} size="sm" type="button" variant="outline" onClick={onSelectAllVisible}>
          全选当前
        </Button>
        <Button disabled={!selectedCount} size="sm" type="button" variant="ghost" onClick={onClearSelection}>
          清空
        </Button>
        <ExportMenu disabled={!selectedCount} label="导出已选" onExport={onExportSelected} />
        <ExportMenu disabled={!totalCount} label="导出筛选结果" onExport={onExportFiltered} />
        <Button disabled={!selectedCount} size="sm" type="button" variant="danger" onClick={onDeleteSelected}>
          批量删除
        </Button>
      </div>
    </div>
  );
}

// 渲染轻量确认弹窗；删除类操作统一通过它二次确认，避免继续散落 window.confirm。
export function ConfirmDialog({
  confirmLabel = "确认",
  description,
  open,
  title,
  onCancel,
  onConfirm,
}: {
  confirmLabel?: string;
  description: string;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="ui-dialog-backdrop" role="presentation">
      <section aria-modal="true" className="ui-dialog" role="dialog">
        <h3 className="text-lg font-extrabold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

// 渲染通用单行输入框；value 存在时为受控输入，否则使用 defaultValue 走普通表单提交。
export function TextField({
  defaultValue,
  label,
  name,
  onChange,
  placeholder,
  required,
  type = "text",
  value,
}: {
  defaultValue?: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value?: string;
}) {
  return (
    <label className="ui-field">
      {label}
      <input
        className="ui-input"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  );
}

// 渲染通用多行输入框；导入草稿用受控模式，手动录入表单用非受控模式。
export function TextAreaField({
  className = "",
  defaultValue,
  label,
  name,
  onChange,
  placeholder,
  required,
  value,
}: {
  className?: string;
  defaultValue?: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value?: string;
}) {
  return (
    <label className={cx("ui-field", className)}>
      {label}
      <textarea
        className="ui-textarea"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  );
}

// 渲染通用下拉框，允许纯字符串选项或 value/label 元组，便于筛选和表单共用。
export function SelectField({
  defaultValue,
  label,
  name,
  onChange,
  options,
  value,
}: {
  defaultValue?: string;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  options: Array<string | [string, string]>;
  value?: string;
}) {
  return (
    <label className="ui-field">
      {label}
      <select
        className="ui-select"
        defaultValue={defaultValue}
        name={name}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {options.map((option) => {
          const [optionValue, labelText] = Array.isArray(option) ? option : [option, option];
          return (
            <option key={optionValue} value={optionValue}>
              {labelText}
            </option>
          );
        })}
      </select>
    </label>
  );
}
