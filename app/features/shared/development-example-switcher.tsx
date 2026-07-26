"use client";

import { useState } from "react";

export type DevelopmentExampleOption = {
  id: string;
  label: string;
};

/** 管理组件内部的纯内存开发示例；生产构建不会渲染入口。 */
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
  }

  return { enabled: allowed, value, select };
}

/** 在真实组件原位提供开发示例选择，并明确标注不会保存或外联。 */
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
    <label className="mb-4 flex min-h-9 items-center gap-3 rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
      <strong className="text-foreground">开发示例</strong>
      <select
        aria-label="开发示例状态"
        className="min-h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground"
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value || undefined)}
      >
        <option value="">真实数据</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <span>仅内存展示，不保存、不请求外部服务</span>
    </label>
  );
}
