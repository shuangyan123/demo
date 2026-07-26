"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { getProviderContract } from "../../services/provider-contracts";
import type { ApiProvider } from "../../types/domains/ai-provider.ts";
import { AppIcon } from "../shared/app-icon";
import { ProviderIcon } from "../shared/provider-icon";
import styles from "./provider-select.module.css";

const groups: Array<{ label: string; providers: ApiProvider[] }> = [
  { label: "已核验厂商", providers: ["openai", "google", "anthropic", "xai", "deepseek", "zhipu", "minimax"] },
  { label: "兼容厂商", providers: ["azure_openai", "qwen", "openrouter", "groq", "mistral", "siliconflow", "kimi", "doubao", "baidu", "tencent"] },
  { label: "语音与自定义", providers: ["elevenlabs", "azure", "custom"] },
];

/** 厂商选择器将图标、完整名称和箭头合并为同一点击区域，并提供完整键盘导航。 */
export function ProviderSelect({ value, providers, onChange }: { value: ApiProvider; providers: ApiProvider[]; onChange: (provider: ApiProvider) => void }) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, providers.indexOf(value)));
  const options = groups.flatMap((group) => group.providers).filter((provider) => providers.includes(provider));

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => () => window.clearTimeout(typeaheadTimerRef.current), []);

  function choose(provider: ApiProvider) {
    onChange(provider);
    setOpen(false);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(options[activeIndex] ?? value);
      else setOpen(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      window.clearTimeout(typeaheadTimerRef.current);
      typeaheadTimerRef.current = window.setTimeout(() => { typeaheadRef.current = ""; }, 600);
      const index = options.findIndex((provider) => getProviderContract(provider).label.toLocaleLowerCase().startsWith(typeaheadRef.current));
      if (index >= 0) {
        setOpen(true);
        setActiveIndex(index);
      }
    }
  }

  const contract = getProviderContract(value);
  return (
    <div ref={rootRef} className={styles.root}>
      <button
        aria-activedescendant={open ? `${listboxId}-${options[activeIndex]}` : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="厂商"
        className={styles.trigger}
        role="combobox"
        type="button"
        onClick={() => { setActiveIndex(Math.max(0, options.indexOf(value))); setOpen((current) => !current); }}
        onKeyDown={handleKeyDown}
      >
        <ProviderIcon provider={value} size={18} />
        <span>{contract.label}</span>
        <AppIcon name="chevronDown" size={16} />
      </button>
      {open ? (
        <div id={listboxId} aria-label="厂商" className={styles.listbox} role="listbox">
          {groups.map((group) => {
            const items = group.providers.filter((provider) => providers.includes(provider));
            return items.length ? (
              <section key={group.label} aria-label={group.label} className={styles.group}>
                <div className={styles.groupLabel}>{group.label}</div>
                {items.map((provider) => {
                  const index = options.indexOf(provider);
                  return (
                    <button
                      key={provider}
                      id={`${listboxId}-${provider}`}
                      aria-selected={provider === value}
                      className={styles.option}
                      data-active={index === activeIndex ? "true" : undefined}
                      role="option"
                      type="button"
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(provider)}
                    >
                      <ProviderIcon provider={provider} size={18} />
                      <span>{getProviderContract(provider).label}</span>
                      {provider === value ? <AppIcon name="check" size={16} /> : null}
                    </button>
                  );
                })}
              </section>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
