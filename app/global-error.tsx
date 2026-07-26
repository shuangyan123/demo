"use client";

import { ApplicationErrorState } from "./features/shared/application-error-state";

/** 根布局失效时仍提供完整文档壳和脱敏恢复入口。 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body>
        <ApplicationErrorState error={error} reset={reset} />
      </body>
    </html>
  );
}
