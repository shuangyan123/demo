"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./learning-session-layout.module.css";

/** 桌面侧栏与移动底部抽屉共享同一内容，避免两个断点产生不同学习状态。 */
export function LearningSessionLayout({
  children,
  insightLabel,
  insights,
}: {
  children: ReactNode;
  insightLabel: string;
  insights: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab") {
        const dialog = closeRef.current?.closest<HTMLElement>('[role="dialog"]');
        const focusable = dialog?.querySelectorAll<HTMLElement>("button, a, input, textarea, select, [tabindex]:not([tabindex='-1'])");
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.main}>{children}</div>
        <aside className={styles.aside} aria-label={insightLabel}>{insights}</aside>
      </div>
      <button ref={triggerRef} className={styles.mobileTrigger} type="button" aria-expanded={open} onClick={() => setOpen(true)}>
        {insightLabel}
      </button>
      {open ? (
        <>
          <button className={styles.backdrop} type="button" aria-label="关闭学习提示" onClick={() => setOpen(false)} />
          <section className={styles.drawer} role="dialog" aria-modal="true" aria-label={insightLabel}>
            <header className={styles.drawerHeader}>
              <strong>{insightLabel}</strong>
              <button ref={closeRef} type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
            </header>
            {insights}
          </section>
        </>
      ) : null}
    </>
  );
}

/** 会话侧栏的统一文本分区。 */
export function LearningSessionInsightSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className={styles.section}><h2>{title}</h2>{children}</section>;
}
