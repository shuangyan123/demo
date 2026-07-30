"use client";

import { useEffect, useState, type ReactNode } from "react";
import { localDataManagementRepository } from "../../services/local-data-management-repository";

/** 在任何业务 controller 挂载前回滚上次中断的跨库恢复事务。 */
export function ReviewWorkspaceBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void localDataManagementRepository.recoverInterruptedRestore()
      .then(() => { if (active) setReady(true); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "本地数据恢复检查失败");
      });
    return () => { active = false; };
  }, []);
  if (error) return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground"><div className="ui-card max-w-lg p-5"><strong>无法安全打开本地数据</strong><p className="mt-2 text-sm text-muted">{error}</p></div></main>;
  if (!ready) return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted">正在检查本地数据…</main>;
  return children;
}
