"use client";

/** 本机 API 运行诊断只保存低基数元数据，禁止记录请求体、响应体或凭据。 */
export type LocalRuntimeDiagnostic = {
  id: string;
  route: string;
  stage: "completed" | "failed";
  durationMs: number;
  status: number;
  errorCode?: string;
  createdAt: string;
};

const MAX_RUNTIME_DIAGNOSTICS = 50;
const runtimeDiagnostics: LocalRuntimeDiagnostic[] = [];

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function routeCategory(input: string): string {
  try {
    const url = new URL(input, "http://localhost");
    return url.pathname.startsWith("/api/") ? url.pathname : "external";
  } catch {
    return "unknown";
  }
}

function appendRuntimeDiagnostic(entry: Omit<LocalRuntimeDiagnostic, "id" | "createdAt">): void {
  runtimeDiagnostics.push({
    ...entry,
    createdAt: new Date().toISOString(),
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${runtimeDiagnostics.length}`,
  });
  if (runtimeDiagnostics.length > MAX_RUNTIME_DIAGNOSTICS) {
    runtimeDiagnostics.splice(0, runtimeDiagnostics.length - MAX_RUNTIME_DIAGNOSTICS);
  }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    const payload = await response.clone().json() as { code?: unknown };
    return typeof payload.code === "string" ? payload.code.slice(0, 80) : undefined;
  } catch {
    return undefined;
  }
}

/** 返回诊断快照副本，调用方无法修改单例内的有界记录。 */
export function listLocalRuntimeDiagnostics(): LocalRuntimeDiagnostic[] {
  return runtimeDiagnostics.map((entry) => ({ ...entry }));
}

/** 仅供测试和用户主动清理诊断时使用。 */
export function clearLocalRuntimeDiagnostics(): void {
  runtimeDiagnostics.splice(0, runtimeDiagnostics.length);
}

/**
 * 包装同源 API 请求并记录阶段、耗时、状态码和错误类别。
 * 请求参数与响应正文不会进入诊断快照。
 */
export async function fetchLocalApi(input: string, init?: RequestInit): Promise<Response> {
  const startedAt = nowMs();
  const route = routeCategory(input);
  try {
    const response = await fetch(input, init);
    appendRuntimeDiagnostic({
      durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
      errorCode: response.ok ? undefined : await readErrorCode(response),
      route,
      stage: response.ok ? "completed" : "failed",
      status: response.status,
    });
    return response;
  } catch (error) {
    appendRuntimeDiagnostic({
      durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
      errorCode: error instanceof DOMException && error.name === "AbortError" ? "request_timeout" : "network_error",
      route,
      stage: "failed",
      status: 0,
    });
    throw error;
  }
}
