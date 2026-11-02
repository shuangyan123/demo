"use client";

import { useEffect, useRef, useState } from "react";
import { REVIEW_WORKSPACE_VERSION } from "../../config/app-metadata";
import { checkMockUpdate } from "../../services/update-check-client";
import type { UpdateCheckResult } from "../../types/domains/update-check";
import { Button } from "../shared/ui-primitives";

const messages = {
  available: "模拟源有可用新版本。下载与安装尚未启用。",
  current: "当前版本与模拟源版本一致。",
  ahead: "当前版本高于模拟源版本，不提供降级。",
  incompatible: "模拟版本与当前版本或 Windows x64 NSIS 目标不兼容，已拒绝。",
  invalid: "更新信息格式或版本无效，已拒绝。可稍后手动重试。",
  failed: "版本查询失败或超时。可手动重试，应用仍可正常使用。",
  disabled: "本地模拟更新源未启用，尚未接入正式更新渠道。",
};

export function UpdateCheckPanel() {
  const [result, setResult] = useState<UpdateCheckResult>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  async function check() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setResult(undefined);
    const next = await checkMockUpdate(controller.signal);
    if (pending.current !== controller) return;
    pending.current = null; setResult(next); setBusy(false);
  }
  return <section className="rounded-lg border border-line p-4" aria-label="版本与更新">
    <h2 className="text-base font-semibold">版本与更新</h2>
    <p className="mt-2 text-sm">当前应用版本：{REVIEW_WORKSPACE_VERSION}</p>
    <p className="mt-1 text-xs text-muted">更新源：本地模拟（Windows x64 NSIS），不代表正式发布。此阶段仅检查版本，不下载或安装。</p>
    <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => void check()}>{busy ? "检查中…" : "检查模拟更新"}</Button>
    <p className="mt-2 text-sm" aria-live="polite" aria-label="版本检查状态">{busy ? "正在查询本地模拟更新源…" : result ? messages[result.kind] : "尚未检查。仅在点击后查询。"}</p>
    {result && "metadata" in result ? <div className="mt-3 text-sm">
      <p>模拟源版本：{result.metadata.version}</p>
      <h3 className="mt-2 font-medium">更新说明</h3>
      <p className="whitespace-pre-wrap break-words">{result.metadata.releaseNotes}</p>
    </div> : null}
  </section>;
}
