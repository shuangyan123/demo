"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FenbiSessionStatus, FenbiViewState } from "../../platform/capabilities";
import { resolveHost } from "../../platform/host";
import { setNativeSurfaceOcclusion } from "../shared/ui-overlay-events";
import { Button, Chip, ConfirmDialog } from "../shared/ui-primitives";

const NO_SUBSCRIBE = () => () => undefined;

function sessionLabel(status: FenbiSessionStatus | undefined, available: boolean): string {
  if (!status) return available ? "正在读取粉笔会话状态" : "粉笔会话不可用";
  if (!status.available) return "粉笔会话不可用";
  return status.hasSessionData ? "检测到粉笔会话数据" : "未建立粉笔会话";
}

function actionLabel(value: boolean | undefined, positive: string, negative: string): string {
  return value ? positive : negative;
}

/** Fenbi 的业务控制只进入现有 ContextPanel，不创建第二套工作台 chrome。 */
export function FenbiContextPanel({ onOpenImport }: { onOpenImport: () => void }) {
  const nativeSurfaceOcclusionSource = `fenbi-clear-confirm:${useId()}`;
  const isDesktop = useSyncExternalStore(NO_SUBSCRIBE, () => resolveHost().kind === "desktop", () => false);
  const runtime = useMemo(() => {
    const resolved = resolveHost();
    return (isDesktop && resolved.kind === "desktop") || (!isDesktop && resolved.kind !== "desktop") ? resolved : resolveHost();
  }, [isDesktop]);
  const session = runtime.capabilities.fenbiSession;
  const view = runtime.capabilities.fenbiView;
  const [sessionStatus, setSessionStatus] = useState<FenbiSessionStatus>();
  const [viewState, setViewState] = useState<FenbiViewState>();
  const [busyAction, setBusyAction] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);

  useLayoutEffect(() => {
    setNativeSurfaceOcclusion(nativeSurfaceOcclusionSource, clearConfirmationOpen);
    return () => setNativeSurfaceOcclusion(nativeSurfaceOcclusionSource, false);
  }, [clearConfirmationOpen, nativeSurfaceOcclusionSource]);

  useEffect(() => {
    if (!session && !view) return;
    let active = true;
    const refresh = async () => {
      const [sessionResult, viewResult] = await Promise.allSettled([
        session?.getStatus(),
        view?.getState(),
      ]);
      if (!active) return;
      if (sessionResult.status === "fulfilled" && sessionResult.value) setSessionStatus(sessionResult.value);
      if (viewResult.status === "fulfilled" && viewResult.value) setViewState(viewResult.value);
      if (sessionResult.status === "rejected" || viewResult.status === "rejected") setNotice("粉笔状态暂不可用");
    };
    void refresh();
    const unsubscribe = view?.onStateChanged((next) => {
      if (active) setViewState(next);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [session, view]);

  const executeViewAction = useCallback(async (name: string, operation: () => Promise<FenbiViewState>) => {
    setBusyAction(name);
    setNotice(undefined);
    try {
      setViewState(await operation());
    } catch {
      setNotice("粉笔操作暂不可用");
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const clearSession = useCallback(async () => {
    if (!session) return;
    setClearConfirmationOpen(false);
    setBusyAction("clear");
    setNotice(undefined);
    try {
      await session.clear();
      setSessionStatus(await session.getStatus());
      if (view) setViewState(await view.openHome());
      setNotice("粉笔会话已清除，已回到粉笔首页");
    } catch {
      setNotice("粉笔会话清除失败，请稍后重试");
    } finally {
      setBusyAction(undefined);
    }
  }, [session, view]);

  const hasSessionData = Boolean(sessionStatus?.hasSessionData);
  const viewUnavailable = Boolean(isDesktop && viewState && !viewState.available);
  const viewReady = Boolean(isDesktop && view && viewState?.available);
  const disabled = Boolean(busyAction) || !viewReady;

  return (
    <section className="grid gap-3" data-fenbi-context-panel="true">
      <p className="text-xs text-muted">嵌入练习与会话状态由桌面宿主管理，Recall 不读取页面正文。</p>
      <dl className="ui-data-list">
        <div className="ui-data-row grid-cols-[5rem_minmax(0,1fr)] gap-3"><dt className="text-xs text-muted">嵌入状态</dt><dd className="min-w-0 truncate text-xs font-semibold text-foreground">{viewUnavailable ? "粉笔视图暂不可用" : viewReady ? "桌面原生视图" : "粉笔嵌入仅桌面版可用"}</dd></div>
        <div className="ui-data-row grid-cols-[5rem_minmax(0,1fr)] gap-3">
          <dt className="text-xs text-muted">会话状态</dt>
          <dd className="min-w-0 truncate text-xs font-semibold text-foreground">
            {sessionLabel(sessionStatus, Boolean(session))}
            {sessionStatus?.hasSessionData && sessionStatus.authentication === "unknown" ? <small className="mt-1 block text-xs text-muted">登录状态尚未验证</small> : null}
          </dd>
        </div>
        {viewReady ? <>
          <div className="ui-data-row grid-cols-[5rem_minmax(0,1fr)] gap-3"><dt className="text-xs text-muted">页面状态</dt><dd className="min-w-0 truncate text-xs font-semibold text-foreground">{actionLabel(viewState?.loading, "加载中", "已就绪")}</dd></div>
          <div className="ui-data-row grid-cols-[5rem_minmax(0,1fr)] gap-3"><dt className="text-xs text-muted">当前站点</dt><dd className="min-w-0 truncate text-xs font-semibold text-foreground">{viewState?.host ?? "尚未确定"}</dd></div>
          <div className="ui-data-row grid-cols-[5rem_minmax(0,1fr)] gap-3"><dt className="text-xs text-muted">导航</dt><dd className="min-w-0 truncate text-xs font-semibold text-foreground">{viewState?.canGoBack ? "可后退" : "不可后退"} · {viewState?.canGoForward ? "可前进" : "不可前进"}</dd></div>
        </> : null}
      </dl>
      {notice ? <p className="ui-soft-block text-xs leading-5 text-muted" role="status">{notice}</p> : null}
      <div className="flex flex-wrap gap-2" aria-label="粉笔操作">
        <Button disabled={disabled} size="sm" variant="primary" onClick={() => void executeViewAction("home", () => view!.openHome())}>回到粉笔首页</Button>
        <Button disabled={disabled || !viewState?.canGoBack} size="sm" variant="outline" onClick={() => void executeViewAction("back", () => view!.goBack())}>后退</Button>
        <Button disabled={disabled || !viewState?.canGoForward} size="sm" variant="outline" onClick={() => void executeViewAction("forward", () => view!.goForward())}>前进</Button>
        <Button disabled={disabled} size="sm" variant="outline" onClick={() => void executeViewAction("reload", () => view!.reload())}>刷新</Button>
        <Button size="sm" variant="outline" onClick={onOpenImport}>打开粉笔导入</Button>
        <Button disabled={!session || !hasSessionData || Boolean(busyAction)} size="sm" variant="danger" onClick={() => setClearConfirmationOpen(true)}>清除粉笔会话</Button>
      </div>
      {sessionStatus?.hasSessionData ? <Chip tone="yellow">登录状态尚未验证</Chip> : null}
      <ConfirmDialog
        confirmLabel="清除粉笔会话"
        description="这只会清除粉笔专用浏览会话，不会删除 Recall 的错题、对话或其他本地数据。"
        open={clearConfirmationOpen}
        title="清除粉笔会话？"
        onCancel={() => setClearConfirmationOpen(false)}
        onConfirm={() => void clearSession()}
      />
    </section>
  );
}
