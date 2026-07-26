"use client";

import { useState } from "react";
import { WorkspaceViewState } from "./workspace-view-state";
import styles from "./application-error-state.module.css";

type ApplicationErrorStateProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

function diagnosticText(error: ApplicationErrorStateProps["error"]): string {
  return JSON.stringify({
    category: "application_render_error",
    digest: error.digest?.slice(0, 120) || "unavailable",
    generatedAt: new Date().toISOString(),
    message: "应用界面运行失败",
  }, null, 2);
}

/** 根级错误恢复只暴露脱敏摘要，不展示堆栈、厂商响应或用户数据。 */
export function ApplicationErrorState({ error, reset }: ApplicationErrorStateProps) {
  const [copied, setCopied] = useState(false);

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticText(error));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className={styles.root}>
      <div className={styles.panel}>
        <WorkspaceViewState
          tone="error"
          title="工作台暂时无法显示"
          description="可以重试当前页面，或返回工作台重新进入。复制的诊断信息不包含密钥、正文或原始响应。"
          action={(
            <div className={styles.actions}>
              <button className={styles.action} type="button" onClick={reset}>重试</button>
              <button className={styles.action} type="button" onClick={() => window.location.assign("/")}>返回工作台</button>
              <button className={styles.action} type="button" onClick={() => void copyDiagnostic()}>
                {copied ? "已复制诊断" : "复制脱敏诊断"}
              </button>
            </div>
          )}
        />
      </div>
    </main>
  );
}
