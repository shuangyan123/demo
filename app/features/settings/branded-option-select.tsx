"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ApiProvider } from "../../types/domains/ai-provider";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import styles from "./provider-select.module.css";

export type BrandedSelectOption = {
  value: string;
  label: string;
  provider?: ApiProvider;
  description?: string;
};

/** 默认能力使用的紧凑品牌列表框，统一连接和模型的键盘、焦点与图标行为。 */
export function BrandedOptionSelect({
  ariaLabel,
  value,
  options,
  placeholder,
  provider,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: BrandedSelectOption[];
  placeholder: string;
  provider?: ApiProvider;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const typeaheadRef = useRef("");
  const timerRef = useRef<number | undefined>(undefined);
  const selectedIndex = useMemo(() => options.findIndex((option) => option.value === value), [options, value]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { typeaheadRef.current = ""; }, 600);
      const index = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(typeaheadRef.current));
      if (index >= 0) {
        setOpen(true);
        setActiveIndex(index);
      }
    }
  }

  const visibleProvider = selected?.provider ?? provider;
  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={triggerRef}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={styles.trigger}
        disabled={disabled}
        role="combobox"
        type="button"
        onClick={() => { setActiveIndex(Math.max(0, selectedIndex)); setOpen((current) => !current); }}
        onKeyDown={handleKeyDown}
      >
        {visibleProvider ? <ProviderIcon provider={visibleProvider} size={18} /> : <span className={styles.emptyIcon} />}
        <span>{selected?.label ?? (value ? `手动：${value}` : placeholder)}</span>
        <AppIcon name="chevronDown" size={16} />
      </button>
      {open ? (
        <div id={listboxId} aria-label={ariaLabel} className={styles.listbox} role="listbox">
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-${index}`}
              aria-selected={option.value === value}
              className={styles.option}
              data-active={index === activeIndex ? "true" : undefined}
              role="option"
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              {option.provider ?? provider ? <ProviderIcon provider={(option.provider ?? provider)!} size={18} /> : <span className={styles.emptyIcon} />}
              <span>{option.label}{option.description ? ` · ${option.description}` : ""}</span>
              {option.value === value ? <AppIcon name="check" size={16} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
