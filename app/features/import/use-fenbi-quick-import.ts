"use client";

import { useEffect, useRef, useState } from "react";
import { fenbiCredentialRepository } from "../../services/fenbi-credential-repository";
import { fetchLocalApi } from "../../services/local-runtime-diagnostics";
import type { FenbiImportCredential, FenbiSyncEvent, FenbiSyncScope } from "../../types/domains/fenbi-import.ts";
import type { ImportDraft } from "../../types/domains/import.ts";

type FenbiQuickImportStatus = "unconfigured" | "ready" | "validating" | "syncing" | "error";

type UseFenbiQuickImportInput = {
  onDrafts: (drafts: ImportDraft[]) => Promise<number>;
  setNotice: (message: string) => void;
};

function parseSseBlock(block: string): FenbiSyncEvent<ImportDraft> | undefined {
  const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
  if (!data) return undefined;
  return JSON.parse(data) as FenbiSyncEvent<ImportDraft>;
}

/** 管理粉笔实验直连的验证、SSE 同步和取消；明文 Cookie 仅在单次请求栈中存在。 */
export function useFenbiQuickImport({ onDrafts, setNotice }: UseFenbiQuickImportInput) {
  const [credential, setCredential] = useState<FenbiImportCredential | undefined>(() => fenbiCredentialRepository.load());
  const [status, setStatus] = useState<FenbiQuickImportStatus>(() => fenbiCredentialRepository.load() ? "ready" : "unconfigured");
  const [stage, setStage] = useState<"" | "validate" | "catalog" | "questions" | "normalize">("");
  const [progress, setProgress] = useState<{ completed: number; total?: number }>({ completed: 0 });
  const [error, setError] = useState("");
  const [fallbackRecommended, setFallbackRecommended] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function validateSavedCookie(cookie?: string): Promise<boolean> {
    setStatus("validating");
    setError("");
    try {
      const plainCookie = cookie ?? await fenbiCredentialRepository.reveal();
      const response = await fetchLocalApi("/api/import/fenbi/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: plainCookie }),
      });
      const result = await response.json() as { valid?: boolean; code?: string; message?: string };
      if (!response.ok || !result.valid) throw Object.assign(new Error(result.message || "粉笔会话验证失败"), { code: result.code });
      const verified = fenbiCredentialRepository.markVerified(new Date().toISOString());
      setCredential(verified);
      setStatus("ready");
      setNotice("粉笔账户已连接");
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "粉笔会话验证失败";
      setCredential(fenbiCredentialRepository.markUnverified());
      setStatus("error");
      setError(message);
      setFallbackRecommended(true);
      return false;
    }
  }

  async function saveCookie(cookie: string): Promise<boolean> {
    const saved = await fenbiCredentialRepository.save(cookie);
    setCredential(saved);
    return validateSavedCookie(cookie.trim());
  }

  async function sync(scope: FenbiSyncScope = { wrongOnly: true, sinceDays: 30 }) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("syncing");
    setStage("validate");
    setProgress({ completed: 0 });
    setError("");
    setFallbackRecommended(false);
    try {
      const cookie = await fenbiCredentialRepository.reveal();
      const response = await fetchLocalApi("/api/import/fenbi/sync", {
        method: "POST",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
        body: JSON.stringify({ cookie, scope }),
        signal: controller.signal,
      });
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
            setStatus("ready");
            setStage("");
            setNotice(`已同步 ${savedCount} 条错题，确认前不会写入错题库`);
          }
        }
        if (done) break;
      }
    } catch (caught) {
      if (controller.signal.aborted) {
        setStatus(credential ? "ready" : "unconfigured");
        setNotice("已取消粉笔同步");
        return;
      }
      const message = caught instanceof Error ? caught.message : "粉笔同步失败";
      const code = typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "";
      if (code === "invalid_cookie") setCredential(fenbiCredentialRepository.markUnverified());
      setStatus("error");
      setError(message);
      setFallbackRecommended(code === "invalid_cookie" || code === "malformed_response");
    } finally {
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
    fallbackRecommended,
    progress,
    saveCookie,
    stage,
    status,
    sync,
    validate: () => validateSavedCookie(),
  };
}
