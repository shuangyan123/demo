"use client";

import { useEffect, useRef, useState } from "react";
import type { ThemePreset } from "./theme-presets.ts";

export function ThemePresetSelect({
  presets,
  value,
  onChange,
}: {
  presets: ThemePreset[];
  value: string;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, presets.findIndex((preset) => preset.theme.name === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open, presets, value]);

  function closeAndRestoreFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openMenu() {
    const selectedIndex = Math.max(0, presets.findIndex((preset) => preset.theme.name === value));
    setActiveIndex(selectedIndex);
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }

  function moveFocus(nextIndex: number) {
    const normalized = (nextIndex + presets.length) % presets.length;
    setActiveIndex(normalized);
    optionRefs.current[normalized]?.focus();
  }

  return (
    <div ref={rootRef} className="theme-menu relative min-w-52 max-md:w-full">
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="theme-menu-trigger flex min-h-10 w-full items-center justify-between gap-6 rounded-lg bg-surface-muted px-3 text-left text-sm"
        type="button"
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className="truncate">{value}</span>
        <svg aria-hidden="true" className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24">
          <path d="m7 9 5 5 5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>
      {open ? (
        <div className="theme-menu-popover absolute right-0 top-[calc(100%+6px)] z-40 min-w-full overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-xl" role="listbox" aria-label="选择主题">
          {presets.map((preset, index) => {
            const selected = preset.theme.name === value;
            return (
              <button
                key={preset.theme.name}
                ref={(node) => { optionRefs.current[index] = node; }}
                aria-selected={selected}
                className={`grid min-h-9 w-full grid-cols-[1fr_18px] items-center gap-3 rounded-md px-2.5 text-left text-sm ${activeIndex === index ? "bg-surface-muted" : "hover:bg-surface-muted"}`}
                role="option"
                tabIndex={activeIndex === index ? 0 : -1}
                type="button"
                onClick={() => {
                  onChange(preset.theme.name);
                  closeAndRestoreFocus();
                }}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    moveFocus(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    moveFocus(presets.length - 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeAndRestoreFocus();
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onChange(preset.theme.name);
                    closeAndRestoreFocus();
                  }
                }}
              >
                <span>{preset.theme.name}</span>
                {selected ? (
                  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path d="m5 12 4 4L19 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
