"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ApiProvider } from "../../types/domains/ai-provider";
import type { AiModelCatalogEntry } from "../../types/review";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import styles from "./provider-select.module.css";

export type ModelCatalogGroup = { label: string; models: AiModelCatalogEntry[] };

/** 将目录稳定分为可用和历史两组，历史模型仍可手动选择但不会成为自动默认值。 */
export function groupModelCatalog(models: AiModelCatalogEntry[]): ModelCatalogGroup[] {
  const unique = [...new Map(models.map((model) => [model.id, model])).values()];
  const active = unique.filter((model) => model.lifecycle !== "deprecated" && model.status !== "deprecated");
  const historical = unique.filter((model) => model.lifecycle === "deprecated" || model.status === "deprecated");
  return [
    ...(active.length ? [{ label: "可用模型", models: active }] : []),
    ...(historical.length ? [{ label: "历史模型", models: historical }] : []),
  ];
}

/** 模型行仅显示用于选择的简短状态，详细能力继续由 descriptor 与 tooltip 负责。 */
export function modelCatalogDescription(model: AiModelCatalogEntry): string | undefined {
  if (model.lifecycle === "deprecated" || model.status === "deprecated") return "历史";
  if (model.capabilitySource === "unknown") return "能力待核验";
  if (model.status === "preview") return "预览";
  return undefined;
}

/** 设置页共享的可搜索模型列表框；当前值不会参与候选过滤。 */
export function ModelCatalogSelect({
  ariaLabel,
  value,
  models,
  provider,
  placeholder,
  disabled,
  allowManual = true,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  models: AiModelCatalogEntry[];
  provider?: ApiProvider;
  placeholder: string;
  disabled?: boolean;
  allowManual?: boolean;
  onChange: (modelId: string) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? models.filter((model) => `${model.label} ${model.id}`.toLocaleLowerCase().includes(needle)) : models;
  }, [models, query]);
  const groups = useMemo(() => groupModelCatalog(filtered), [filtered]);
  const flat = groups.flatMap((group) => group.models);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function close(restoreFocus: boolean) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(modelId: string) {
    onChange(modelId);
    close(true);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (!flat.length) return;
      event.preventDefault();
      setActiveIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? flat.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const model = flat[activeIndex];
      if (model) choose(model.id);
      else if (allowManual && query.trim()) choose(query.trim());
    }
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={styles.trigger}
        disabled={disabled}
        role="combobox"
        type="button"
        onClick={() => {
          setActiveIndex(Math.max(0, models.findIndex((model) => model.id === value)));
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
          if (event.key === "Escape") close(true);
        }}
      >
        {provider ? <ProviderIcon provider={provider} size={18} /> : <span className={styles.emptyIcon} />}
        <span>{selected?.label ?? (value || placeholder)}</span>
        <AppIcon name="chevronDown" size={16} />
      </button>
      {open ? (
        <div id={listboxId} aria-label={ariaLabel} className={`${styles.listbox} ${styles.modelListbox}`} role="listbox" onKeyDown={handleListKeyDown}>
          <input
            ref={searchRef}
            aria-controls={listboxId}
            aria-label={`搜索${ariaLabel}`}
            className={styles.searchInput}
            placeholder="搜索或输入模型 ID"
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setActiveIndex(0); }}
          />
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className={styles.group}>
              <div className={styles.groupLabel}>{group.label}</div>
              {group.models.map((model) => {
                const index = flat.findIndex((item) => item.id === model.id);
                const description = modelCatalogDescription(model);
                return (
                  <button
                    key={model.id}
                    aria-selected={model.id === value}
                    className={styles.option}
                    data-active={index === activeIndex ? "true" : undefined}
                    role="option"
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(model.id)}
                  >
                    {provider ? <ProviderIcon provider={provider} size={18} /> : <span className={styles.emptyIcon} />}
                    <span>{model.label}{description ? ` · ${description}` : ""}</span>
                    {model.id === value ? <AppIcon name="check" size={16} /> : null}
                  </button>
                );
              })}
            </section>
          ))}
          {allowManual && query.trim() && !models.some((model) => model.id === query.trim()) ? (
            <button aria-selected="false" className={styles.manualOption} role="option" type="button" onClick={() => choose(query.trim())}>
              使用手动模型 ID：{query.trim()}
            </button>
          ) : null}
          {!flat.length && !(allowManual && query.trim()) ? <p className={styles.emptyMessage}>没有匹配模型</p> : null}
        </div>
      ) : null}
    </div>
  );
}
