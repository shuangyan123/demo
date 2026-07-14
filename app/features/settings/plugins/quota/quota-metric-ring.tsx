"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AiQuotaSnapshot } from "../../../../types/domains/ai-quota";
import { deriveQuotaRingPresentation } from "../../../../services/ai-quota-presentation";
import styles from "../../settings-compact.module.css";

/** 额度环在桌面悬浮、键盘聚焦和触屏点击时展示同一份精确指标。 */
export function QuotaMetricRing({ snapshot }: { snapshot?: AiQuotaSnapshot }) {
  const tooltipId = useId();
  const timerRef = useRef<number | undefined>(undefined);
  const pointerFocusRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const presentation = deriveQuotaRingPresentation(snapshot);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!visible || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const tooltipWidth = 240;
    const left = window.innerWidth - rect.right >= tooltipWidth + 12
      ? rect.right + 8
      : Math.max(8, rect.left - tooltipWidth - 8);
    setPosition({ left, top: Math.max(8, Math.min(window.innerHeight - 120, rect.top + rect.height / 2 - 48)) });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) setVisible(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [visible]);

  function scheduleOpen(): void {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setVisible(true), 450);
  }

  function close(): void {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setVisible(false);
  }

  return (
    <span className={styles.quotaRingWrap} onMouseEnter={scheduleOpen} onMouseLeave={close}>
      <button
        ref={buttonRef}
        aria-describedby={tooltipId}
        aria-expanded={visible}
        aria-label={presentation.accessibleLabel}
        className={styles.quotaRingButton}
        data-mode={presentation.mode}
        data-tone={presentation.tone}
        style={{ "--quota-ring-value": `${Math.round((presentation.ratio ?? 1) * 360)}deg` } as CSSProperties}
        type="button"
        onBlur={() => { pointerFocusRef.current = false; close(); }}
        onClick={() => { pointerFocusRef.current = false; setVisible((current) => !current); }}
        onFocus={() => { if (!pointerFocusRef.current) setVisible(true); }}
        onKeyDown={(event) => { if (event.key === "Escape") { close(); event.currentTarget.blur(); } }}
        onPointerDown={() => { pointerFocusRef.current = true; }}
      >
        <span aria-hidden="true">{presentation.centerLabel}</span>
      </button>
      {visible && typeof document !== "undefined" ? createPortal(
        <span id={tooltipId} className={styles.quotaTooltip} role="tooltip" style={position}>
          {presentation.details.map((detail) => <span key={detail}>{detail}</span>)}
        </span>,
        document.body,
      ) : <span id={tooltipId} className={styles.srOnly}>{presentation.accessibleLabel}</span>}
    </span>
  );
}
