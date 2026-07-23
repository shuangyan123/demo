"use client";

import { ApplicationErrorState } from "./features/shared/application-error-state";

/** 捕获根路由段渲染错误并提供原地恢复。 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ApplicationErrorState error={error} reset={reset} />;
}
