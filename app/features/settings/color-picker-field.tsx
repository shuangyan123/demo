"use client";

import { useEffect, useRef, useState } from "react";

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const COMMON_COLORS = ["#2563EB", "#0969DA", "#0EA5E9", "#16A34A", "#D97706", "#DC2626", "#7C3AED", "#111827", "#FFFFFF"];

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim().toUpperCase());
}

function hexToHsv(hex: string): HsvColor {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    h: hue < 0 ? hue + 360 : hue,
    s: max ? delta / max : 0,
    v: max,
  };
}

function hsvToHex({ h, s, v }: HsvColor): string {
  const chroma = v * s;
  const section = h / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const offset = v - chroma;
  const [red, green, blue] =
    section < 1 ? [chroma, second, 0]
      : section < 2 ? [second, chroma, 0]
        : section < 3 ? [0, chroma, second]
          : section < 4 ? [0, second, chroma]
            : section < 5 ? [second, 0, chroma]
              : [chroma, 0, second];
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function hueColor(hue: number): string {
  return hsvToHex({ h: hue, s: 1, v: 1 });
}

export function ColorPickerField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const normalizedValue = isValidHexColor(value) ? value.toUpperCase() : "#000000";
  const [draftState, setDraftState] = useState(() => ({ sourceValue: value, draft: normalizedValue }));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const draft = draftState.sourceValue === value ? draftState.draft : normalizedValue;
  const draftValid = isValidHexColor(draft);
  const hsv = hexToHsv(normalizedValue);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      window.requestAnimationFrame(() => swatchRef.current?.focus());
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function commitColor(nextColor: string) {
    const normalized = nextColor.toUpperCase();
    setDraftState({ sourceValue: normalized, draft: normalized });
    onChange(normalized);
  }

  function updateDraft(nextValue: string) {
    const nextDraft = nextValue.trim().toUpperCase();
    if (isValidHexColor(nextDraft)) commitColor(nextDraft);
    else setDraftState({ sourceValue: value, draft: nextDraft });
  }

  function updateSaturationAndValue(clientX: number, clientY: number, target: HTMLDivElement) {
    const bounds = target.getBoundingClientRect();
    const saturation = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const brightness = Math.min(1, Math.max(0, 1 - (clientY - bounds.top) / bounds.height));
    commitColor(hsvToHex({ h: hsv.h, s: saturation, v: brightness }));
  }

  return (
    <div ref={rootRef} className="color-picker relative w-56 max-md:w-full">
      <div className={`flex min-h-10 items-center gap-2 rounded-lg border bg-surface px-2.5 ${draftValid ? "border-line" : "border-red"}`}>
        <button
          ref={swatchRef}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`打开${label}调色板`}
          className="color-swatch h-5 w-5 shrink-0 rounded-full border border-line"
          style={{ background: normalizedValue }}
          type="button"
          onClick={() => setOpen((current) => !current)}
        />
        <input
          aria-label={`${label}十六进制颜色`}
          aria-invalid={!draftValid}
          className="settings-input min-w-0 flex-1 border-0 bg-transparent font-mono text-sm uppercase"
          spellCheck={false}
          value={draft}
          onBlur={() => setDraftState({ sourceValue: normalizedValue, draft: normalizedValue })}
          onChange={(event) => updateDraft(event.target.value)}
        />
      </div>
      {!draftValid ? <p className="mt-1 text-xs text-red">请输入 #RRGGBB 格式</p> : null}
      {open ? (
        <div className="color-palette-popover absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-xl border border-line bg-surface p-3 shadow-2xl" role="dialog" aria-label={`${label}调色板`}>
          <div
            aria-label="饱和度和明度"
            className="color-sv-plane relative h-36 cursor-crosshair overflow-hidden rounded-lg"
            role="slider"
            tabIndex={0}
            style={{ backgroundColor: hueColor(hsv.h) }}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.05 : 0.01;
              let next = hsv;
              if (event.key === "ArrowLeft") next = { ...hsv, s: Math.max(0, hsv.s - step) };
              else if (event.key === "ArrowRight") next = { ...hsv, s: Math.min(1, hsv.s + step) };
              else if (event.key === "ArrowUp") next = { ...hsv, v: Math.min(1, hsv.v + step) };
              else if (event.key === "ArrowDown") next = { ...hsv, v: Math.max(0, hsv.v - step) };
              else return;
              event.preventDefault();
              commitColor(hsvToHex(next));
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateSaturationAndValue(event.clientX, event.clientY, event.currentTarget);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationAndValue(event.clientX, event.clientY, event.currentTarget);
            }}
          >
            <span className="color-sv-white absolute inset-0" />
            <span className="color-sv-black absolute inset-0" />
            <span
              aria-hidden="true"
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: normalizedValue }}
            />
          </div>
          <label className="mt-3 grid gap-1.5 text-xs font-medium text-muted">
            色相
            <input
              aria-label={`${label}色相`}
              className="color-hue-slider"
              max="359"
              min="0"
              type="range"
              value={Math.round(hsv.h)}
              onChange={(event) => commitColor(hsvToHex({ ...hsv, h: Number(event.target.value) }))}
            />
          </label>
          <label className="mt-3 grid grid-cols-[44px_1fr] items-center gap-2 text-xs font-medium text-muted">
            HEX
            <input
              className="settings-input min-h-9 rounded-lg border border-line bg-surface px-2.5 font-mono text-sm text-foreground uppercase"
              value={draft}
              onBlur={() => setDraftState({ sourceValue: normalizedValue, draft: normalizedValue })}
              onChange={(event) => updateDraft(event.target.value)}
            />
          </label>
          <div className="mt-3">
            <p className="text-xs font-medium text-muted">常用主题色</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {COMMON_COLORS.map((color) => (
                <button
                  key={color}
                  aria-label={`选择颜色 ${color}`}
                  className={`h-7 w-7 rounded-full border ${color === normalizedValue ? "ring-2 ring-foreground ring-offset-2 ring-offset-[var(--surface)]" : "border-line"}`}
                  style={{ background: color }}
                  type="button"
                  onClick={() => commitColor(color)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
