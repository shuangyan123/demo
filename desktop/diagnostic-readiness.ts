export type DesktopDiagnosticReadiness = "ready" | "storage_config_unavailable" | "storage_unavailable"
  | "history_incomplete" | "history_corrupt" | "unsupported_history" | "initialization_failed";
const kinds = new Set<DesktopDiagnosticReadiness>(["ready", "storage_config_unavailable", "storage_unavailable",
  "history_incomplete", "history_corrupt", "unsupported_history", "initialization_failed"]);

export class DiagnosticStartupFailure extends Error {
  constructor(readonly kind: DesktopDiagnosticReadiness) { super(`Diagnostic storage: ${kind}`); }
}

/** Main 的随机 child token 同时通过 proxy 与 route 独立验证；localhost 不是认证。 */
export async function confirmDesktopDiagnosticReadiness(baseUrl: string, token: string): Promise<void> {
  try {
    const response = await fetch(new URL("/api/internal/diagnostic-ready", baseUrl), {
      headers: { "x-review-runtime-token": token, "x-review-startup-token": token },
      signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store",
    });
    const text = await response.text();
    if (text.length > 256) throw new Error("invalid_readiness");
    const value = JSON.parse(text);
    if (!value || Object.keys(value).length !== 1 || !kinds.has(value.kind)) throw new Error("invalid_readiness");
    if (response.status === 200 && value.kind === "ready") return;
    if (response.status === 503 && value.kind !== "ready") throw new DiagnosticStartupFailure(value.kind);
    throw new Error("invalid_readiness");
  } catch (error) {
    if (error instanceof DiagnosticStartupFailure) throw error;
    throw new DiagnosticStartupFailure("storage_unavailable");
  }
}
