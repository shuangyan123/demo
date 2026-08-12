"use client";

import { Button } from "../shared/ui-primitives";
import { useDesktopCredentialMigration } from "./use-desktop-credential-migration.ts";

const STATUS_LABELS = {
  ready: "可迁移",
  in_progress: "迁移中",
  complete: "已完成",
  requires_reentry: "需要重新输入",
  blocked: "已阻止",
  recovery_required: "需要恢复",
  unavailable: "不可用",
} as const;

/** 只展示 Desktop 安全状态和显式动作；Web 宿主不会渲染这块能力。 */
export function DesktopCredentialMigrationPanel() {
  const migration = useDesktopCredentialMigration();
  if (migration.loading || !migration.visible) return null;

  return (
    <section
      aria-label="Desktop 凭据保护"
      className="mb-6 grid gap-3 border border-line bg-surface px-4 py-3"
      data-status={migration.status}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Desktop 凭据保护</h2>
          <p className="text-sm text-muted">状态：{STATUS_LABELS[migration.status]}</p>
        </div>
        {migration.status === "unavailable" ? (
          <Button size="sm" variant="outline" onClick={() => void migration.refresh()}>重新检查保护状态</Button>
        ) : migration.canStart ? (
          <Button size="sm" variant="outline" disabled={migration.busy} onClick={() => void migration.start()}>
            {migration.status === "ready" ? "迁移到 Desktop 保护" : "重试迁移"}
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="text-sm text-muted" role="status">{migration.message}</p>
    </section>
  );
}
