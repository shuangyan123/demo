"use client";

import { useEffect, useRef, useState } from "react";
import { fenbiCredentialRepository } from "../../services/fenbi-credential-repository";
import { fetchLocalApi } from "../../services/local-runtime-diagnostics";
import type { FenbiImportCredential, FenbiSyncEvent, FenbiSyncScope } from "../../types/domains/fenbi-import.ts";
import type { ImportDraft } from "../../types/domains/import.ts";
import { normalizeFenbiCookie } from "../../services/fenbi-cookie";
import { useUiReviewData } from "../shared/ui-review-data-context.tsx";

type FenbiQuickImportStatus = "unconfigured" | "ready" | "validating" | "syncing" | "error";

type UseFenbiQuickImportInput = {
  onDrafts: (drafts: ImportDraft[]) => Promise<number>;
  setNotice: (message: string) => void;
  sampleMode?: boolean;
};

function parseSseBlock(block: string): FenbiSyncEvent<ImportDraft> | undefined {
  const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
  if (!data) return undefined;
  return JSON.parse(data) as FenbiSyncEvent<ImportDraft>;
}

/** 管理粉笔实验直连的验证、SSE 同步和取消；明文 Cookie 仅在单次请求栈中存在。 */
export function useFenbiQuickImport({ onDrafts, setNotice, sampleMode = false }: UseFenbiQuickImportInput) {
  const uiReview = useUiReviewData();
  const safeMode = sampleMode || Boolean(uiReview?.active);
  const [credential, setCredential] = useState<FenbiImportCredential | undefined>(() => fenbiCredentialRepository.load());
  const [status, setStatus] = useState<FenbiQuickImportStatus>(() => fenbiCredentialRepository.load() ? "ready" : "unconfigured");
  const [stage, setStage] = useState<"" | "validate" | "catalog" | "questions" | "normalize">("");
  const [progress, setProgress] = useState<{ completed: number; total?: number }>({ completed: 0 });
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [fallbackRecommended, setFallbackRecommended] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function validateSavedCookie(cookie?: string, candidate = false, quiet = false): Promise<boolean> {
    if (safeMode) {
      setError("示例模式禁止验证真实粉笔账户。");
      setErrorCode("sample_mode_blocked");
      setStatus("error");
      return false;
    }
    setStatus("validating");
    setError("");
    setErrorCode("");
    setRequestId("");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const plainCookie = normalizeFenbiCookie(cookie ?? await fenbiCredentialRepository.reveal());
      const response = await fetchLocalApi("/api/import/fenbi/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: plainCookie }),
        signal: controller.signal,
      });
      const result = await response.json() as { valid?: boolean; code?: string; message?: string; requestId?: string };
      const nextRequestId = result.requestId || response.headers.get("x-request-id") || "";
      setRequestId(nextRequestId);
      if (!response.ok || !result.valid) throw Object.assign(new Error(result.message || "粉笔会话验证失败"), { code: result.code });
      if (candidate) await fenbiCredentialRepository.save(plainCookie);
      const verified = fenbiCredentialRepository.markVerified(new Date().toISOString());
      setCredential(verified);
      setStatus("ready");
      if (!quiet) setNotice("粉笔账户已连接");
      return true;
    } catch (caught) {
      const timedOut = controller.signal.aborted;
      const message = timedOut ? "粉笔验证超时，请稍后重试或使用 PDF/Word 导出。" : caught instanceof Error ? caught.message : "粉笔会话验证失败";
      const code = timedOut ? "timeout" : typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "validation_failed";
      if (!candidate) setCredential(fenbiCredentialRepository.markUnverified());
      setStatus("error");
      setError(message);
      setErrorCode(code);
      setFallbackRecommended(true);
      return false;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function saveCookie(cookie: string): Promise<boolean> {
    return validateSavedCookie(cookie, true);
  }

  async function sync(scope: FenbiSyncScope = { wrongOnly: true, sinceDays: 30 }) {
    if (safeMode) {
      setStatus("error");
      setError("示例模式禁止同步真实粉笔账户。");
      setErrorCode("sample_mode_blocked");
      return;
    }
    if (!await validateSavedCookie(undefined, false, true)) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);
    setStatus("syncing");
    setStage("validate");
    setProgress({ completed: 0 });
    setError("");
    setErrorCode("");
    setRequestId("");
    setFallbackRecommended(false);
    try {
      const cookie = await fenbiCredentialRepository.reveal();
      const response = await fetchLocalApi("/api/import/fenbi/sync", {
        method: "POST",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
        body: JSON.stringify({ cookie, scope }),
        signal: controller.signal,
      });
      setRequestId(response.headers.get("x-request-id") || "");
      if (!response.ok || !response.body) throw new Error("粉笔同步通道建立失败");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedDrafts: ImportDraft[] = [];
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.type === "stage") setStage(event.stage);
          if (event.type === "progress") setProgress({ completed: event.completed, total: event.total });
          if (event.type === "drafts") receivedDrafts = event.drafts;
          if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
          if (event.type === "done") {
            const savedCount = await onDrafts(receivedDrafts);
            const scopeLabel = scope.keypointIds?.length
              ? `${scope.keypointIds.length} 个板块`
              : scope.sinceDays ? `最近 ${scope.sinceDays} 天` : "全部错题";
            setCredential(fenbiCredentialRepository.markSynced(new Date().toISOString(), scopeLabel));
            setStatus("ready");
            setStage("");
            const duplicateNote = event.duplicates ? `，跳过 ${event.duplicates} 条分页重复项` : "";
            setNotice(`已同步 ${savedCount} 条错题${duplicateNote}，确认前不会写入错题库`);
          }
        }
        if (done) break;
      }
    } catch (caught) {
      if (controller.signal.aborted && !timedOut) {
        setStatus(credential ? "ready" : "unconfigured");
        setNotice("已取消粉笔同步");
        return;
      }
      const message = timedOut ? "粉笔同步超时，请缩小范围或使用 PDF/Word 导出。" : caught instanceof Error ? caught.message : "粉笔同步失败";
      const code = timedOut ? "timeout" : typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "";
      if (code === "invalid_cookie") setCredential(fenbiCredentialRepository.markUnverified());
      setStatus("error");
      setError(message);
      setErrorCode(code || (caught instanceof DOMException && caught.name === "AbortError" ? "timeout" : "sync_failed"));
      setFallbackRecommended(code === "invalid_cookie" || code === "malformed_response");
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = undefined;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return {
    cancel,
    credential,
    error,
    errorCode,
    fallbackRecommended,
    progress,
    requestId,
    saveCookie,
    stage,
    status,
    sync,
    validate: () => validateSavedCookie(),
  };
}
