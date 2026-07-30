"use client";

import { useState } from "react";

export type DevelopmentExampleOption = {
  id: string;
  label: string;
  group?: string;
};

export const DEVELOPMENT_EXAMPLE_CHANGE_EVENT = "review-workspace:development-example-change";

/** 管理无法持久化的加载、错误和权限等 UI 审查状态；生产构建不渲染入口。 */
export function useDevelopmentExample(initialValue: string | undefined, options: DevelopmentExampleOption[]) {
  const allowed = process.env.NODE_ENV === "development";
  const [value, setValue] = useState<string | undefined>(() => (
    allowed && options.some((option) => option.id === initialValue) ? initialValue : undefined
  ));

  function select(nextValue: string | undefined): void {
    if (!allowed) return;
    setValue(nextValue);
    const url = new URL(window.location.href);
    if (nextValue) url.searchParams.set("example", nextValue);
    else url.searchParams.delete("example");
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(DEVELOPMENT_EXAMPLE_CHANGE_EVENT));
  }

  return { enabled: allowed, value, select };
}

/** 在真实组件原位提供瞬时 UI 审查状态，并明确标注不会保存或外联。 */
export function DevelopmentExampleSwitcher({
  options,
  value,
  onChange,
}: {
  options: DevelopmentExampleOption[];
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <label className="mb-4 flex min-h-9 items-center gap-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)]">
      <strong className="text-foreground">UI 审查状态</strong>
      <select
        aria-label="UI 审查状态"
        className="min-h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value || undefined)}
      >
        <option value="">真实数据</option>
        {groupDevelopmentOptions(options).map(([group, groupOptions]) => (
          group ? (
            <optgroup key={group} label={group}>
              {groupOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </optgroup>
          ) : groupOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)
        ))}
      </select>
      <span className="max-sm:col-span-2">瞬时状态仅在本地展示，不保存、不请求外部服务</span>
    </label>
  );
}

/** 保留声明顺序生成分组，未分组选项继续作为一级选项展示。 */
function groupDevelopmentOptions(options: DevelopmentExampleOption[]): Array<[string, DevelopmentExampleOption[]]> {
  const groups = new Map<string, DevelopmentExampleOption[]>();
  for (const option of options) {
    const group = option.group ?? "";
    groups.set(group, [...(groups.get(group) ?? []), option]);
  }
  return [...groups.entries()];
}
