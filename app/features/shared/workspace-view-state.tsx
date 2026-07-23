import type { ReactNode } from "react";
import styles from "./workspace-view-state.module.css";

/** 通用页面状态只呈现说明和恢复动作，不触发任何业务读取。 */
export function WorkspaceViewState({
  action,
  description,
  title,
  tone = "loading",
}: {
  action?: ReactNode;
  description: string;
  title: string;
  tone?: "loading" | "empty" | "error" | "offline";
}) {
  return (
    <section className={styles.state} role={tone === "error" ? "alert" : "status"}>
      {tone === "loading" ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </section>
  );
}
