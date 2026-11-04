import { REVIEW_WORKSPACE_VERSION } from "../config/app-metadata.ts";
import type { UpdateCheckResult } from "../types/domains/update-check.ts";
import { assessMockUpdate, UPDATE_METADATA_MAX_BYTES } from "./update-metadata.ts";

/** 固定同源模拟公告：不接受 URL，不带浏览器凭据，不重试、不缓存、不读取安装包。 */
export async function checkMockUpdate(signal?: AbortSignal): Promise<UpdateCheckResult> {
  try {
    const response = await fetch("/api/updates/mock", { cache: "no-store", credentials: "omit", redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
    if (response.status === 409) return { kind: "disabled" };
    if (!response.ok) return { kind: "failed" };
    if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
      || Number(response.headers.get("content-length")) > UPDATE_METADATA_MAX_BYTES || !response.body) {
      await response.body?.cancel(); return { kind: "invalid" };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let source = "", bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > UPDATE_METADATA_MAX_BYTES) return { kind: "invalid" };
        source += decoder.decode(chunk.value, { stream: true });
      }
      source += decoder.decode();
    } finally { await reader.cancel(); reader.releaseLock(); }
    return assessMockUpdate(source, REVIEW_WORKSPACE_VERSION);
  } catch { return { kind: "failed" }; }
}
