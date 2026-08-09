"use client";

import { useEffect, useState, type ReactNode } from "react";
import { localDataManagementRepository, type InterruptedRestoreRecoveryResult } from "../../services/local-data-management-repository";

/** 在任何业务 controller 挂载前回滚上次中断的跨库恢复事务。 */
export function ReviewWorkspaceBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [recovery, setRecovery] = useState<InterruptedRestoreRecoveryResult>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void localDataManagementRepository.recoverInterruptedRestore()
      .then((result) => {
        if (!active) return;
        setRecovery(result.status === "recovered" ? result : undefined);
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "本地数据恢复检查失败");
    });
    return () => { active = false; };
  }, [retry]);
  if (error) return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground"><div className="ui-card max-w-lg p-5" role="alert"><strong>无法安全打开本地数据</strong><p className="mt-2 text-sm text-muted">{error}</p><p className="mt-2 text-sm text-muted">恢复事务记录已保留。请不要重置、清库或手工删除 transfer job；可先重试，持续失败时保留当前 profile 并联系维护者。</p><button className="ui-button mt-4" type="button" onClick={() => { setReady(false); setError(undefined); setRetry((value) => value + 1); }}>重新尝试安全恢复</button></div></main>;
  if (!ready) return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted">正在检查本地数据…</main>;
  return <>{children}{recovery ? <div className="ui-toast fixed left-1/2 top-14 z-50 -translate-x-1/2 border border-line bg-surface px-4 py-2 text-sm" role="status">{recovery.message} 正常业务已在验证成功后启动。<button aria-label="关闭恢复结果" type="button" onClick={() => setRecovery(undefined)}>关闭</button></div> : null}</>;
}
