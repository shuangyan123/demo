import { diagnosticOwnerAttempt, initializeDiagnosticRuntime } from "./runtime.ts";

/** 固定 server surface 的 session 生命周期；历史 authority 只来自 durable owner index。 */
export function issueDiagnostic() { return initializeDiagnosticRuntime().issue(); }
export function submitDiagnostic(input: unknown) { return initializeDiagnosticRuntime().capture(input); }
export function readDiagnostic(sessionId: string) { return initializeDiagnosticRuntime().read(sessionId); }
export const resolveDiagnosticAttempt = diagnosticOwnerAttempt;
