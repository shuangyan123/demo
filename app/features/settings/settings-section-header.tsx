import type { ReactNode } from "react";
import styles from "./settings-layout.module.css";

/** 设置分区统一标题，避免各页面自行决定字号、间距和操作位置。 */
export function SettingsSectionHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <header className={styles.sectionHeader}>
      <div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
      {action}
    </header>
  );
}
