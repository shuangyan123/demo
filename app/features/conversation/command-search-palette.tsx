"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CommandSearchResult } from "../../types/domains/conversation.ts";
import { AppIcon } from "../shared/app-icon";
import { cx } from "../shared/ui-primitives";
import styles from "./command-search-palette.module.css";

type CommandSearchPaletteProps = {
  open: boolean;
  results: CommandSearchResult[];
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (result: CommandSearchResult) => void;
};

const groupLabels: Record<CommandSearchResult["group"], string> = {
  chat: "聊天",
  project: "项目",
  study: "公考专项",
  mistake: "错题",
  knowledge: "知识",
  scheduled: "已安排",
  plugin: "插件",
  settings: "设置",
};

export function CommandSearchPalette({ open, results, onClose, onQueryChange, onSelect }: CommandSearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const groupedResults = useMemo(() => {
    const groups = new Map<CommandSearchResult["group"], CommandSearchResult[]>();
    for (const result of results) {
      const items = groups.get(result.group) ?? [];
      items.push(result);
      groups.set(result.group, items);
    }
    return Array.from(groups.entries());
  }, [results]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    onQueryChange(query);
  }, [onQueryChange, query]);

  if (!open) return null;
  const selectedIndex = Math.max(0, Math.min(activeIndex, results.length - 1));

  function close() {
    setQuery("");
    setActiveIndex(0);
    onQueryChange("");
    onClose();
  }

  function choose(result: CommandSearchResult) {
    setQuery("");
    setActiveIndex(0);
    onQueryChange("");
    onSelect(result);
  }

  return createPortal(
    <div className={cx("command-palette-backdrop", styles.backdrop)} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section
        ref={dialogRef}
        aria-label="搜索聊天或运行命令"
        aria-modal="true"
        className={cx("command-palette", styles.palette)}
        role="dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
          if (event.key === "Tab") {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
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
        }}
      >
        <div className={styles.searchRow}>
          <AppIcon name="search" size={18} />
          <input
            ref={inputRef}
            aria-label="搜索聊天或运行命令"
            placeholder="搜索聊天、学习资料或设置"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(results.length - 1, index + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter" && results[selectedIndex]) {
              event.preventDefault();
              choose(results[selectedIndex]);
            }
          }}
          />
          <button className={styles.close} type="button" onClick={close}>关闭</button>
        </div>
        <div className={styles.results}>
          {groupedResults.length ? groupedResults.map(([group, groupItems]) => (
            <div key={group} className={styles.group}>
              <p className={styles.groupLabel}>{groupLabels[group]}</p>
              <div className="grid gap-1">
                {groupItems.map((result) => {
                  const flatIndex = results.findIndex((item) => item.id === result.id);
                  return (
                    <button
                      key={result.id}
                      className={cx("command-result", flatIndex === selectedIndex && "is-active")}
                      type="button"
                      onClick={() => choose(result)}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm">{result.label}</strong>
                        <span className="mt-0.5 block truncate text-xs text-muted">{result.description}</span>
                      </span>
                      {result.shortcut ? <kbd className="rounded-full bg-surface-muted px-2 py-1 text-xs text-muted">{result.shortcut}</kbd> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )) : <p className={styles.empty}>没有匹配结果，换一个关键词试试。</p>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
