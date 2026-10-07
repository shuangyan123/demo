import { randomUUID } from "node:crypto";
import type { ManagedStorageHostConfig } from "../../platform/managed-storage.js";
import type { DiagnosticHistoryFailure, DiagnosticHistorySnapshotV1 } from "../../types/domains/diagnostic-history.ts";
import type { DiagnosticCaptureSessionV1, DiagnosticCapturedAttemptV1, IssuedDiagnosticCapturedAttemptV1 } from "../../types/domains/first-party-diagnostic-capture.ts";
import { createControlledDiagnosticCapture } from "../../services/first-party-diagnostic/capture-authority.ts";
import { openDiagnosticHistoryRepository } from "./history/repository.ts";

export type DiagnosticReadiness = { kind: "ready" } | { kind: "storage_config_unavailable" | "storage_unavailable"
  | "history_incomplete" | "history_corrupt" | "unsupported_history" | "initialization_failed" };
const LIFETIME_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 256;
type Entry = { session: DiagnosticCaptureSessionV1; expiresAt: number; attempt?: IssuedDiagnosticCapturedAttemptV1; revealed: boolean };

function failureState(failure: DiagnosticHistoryFailure): DiagnosticReadiness {
  if (failure.kind === "incomplete" || failure.kind === "uninitialized") return { kind: "history_incomplete" };
  if (failure.kind === "corrupt" || failure.kind === "conflict") return { kind: "history_corrupt" };
  if (failure.kind === "unsupported_version") return { kind: "unsupported_history" };
  return { kind: "storage_unavailable" };
}

/** 内部 composition seam；生产只由 runtime.ts 构造，测试可注入有真实 IO 的 repository opener。
 * capture 与 repository 闭包属于同一 runtime，跨 Next bundles 仍共享同一 issuer 能力。
 */
export function createDiagnosticRuntime(config: ManagedStorageHostConfig | undefined,
  open: typeof openDiagnosticHistoryRepository = openDiagnosticHistoryRepository) {
  let readiness: DiagnosticReadiness = { kind: "storage_config_unavailable" };
  let index = new Map<string, DiagnosticCapturedAttemptV1>();
  const entries = new Map<string, Entry>();
  const opened = config ? open(config) : undefined;
  const repository = opened?.kind === "opened" ? opened.repository : undefined;
  function load(snapshot: DiagnosticHistorySnapshotV1) {
    index = new Map(snapshot.captures.map((attempt) => [attempt.id, attempt]));
    readiness = { kind: "ready" };
  }
  if (repository) {
    let read = repository.readCompleteSnapshot();
    if (read.kind === "uninitialized") {
      read = repository.initialize(); // 仅新 domain，其他失败绝不 initialize-empty。
      if (read.kind !== "complete") readiness = { kind: "initialization_failed" };
    } else if (read.kind !== "complete") readiness = failureState(read);
    if (read.kind === "complete") load(read.snapshot);
  } else if (opened && opened.kind !== "opened") readiness = failureState(opened);

  function sessions() {
    for (const [id, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(id);
    return entries;
  }
  return Object.freeze({
    readiness: () => readiness,
    issue() {
      if (readiness.kind !== "ready" || sessions().size >= MAX_SESSIONS) return { kind: "unavailable" } as const;
      const mechanism = createControlledDiagnosticCapture();
      const started = mechanism.begin({ specId: "int-add-2-3", specRevision: "r1" });
      if (started.kind !== "started") return { kind: "unavailable" } as const;
      const sessionId = randomUUID();
      if (entries.has(sessionId)) return { kind: "unavailable" } as const;
      entries.set(sessionId, { session: started.session, expiresAt: Date.now() + LIFETIME_MS, revealed: false });
      return { kind: "issued", sessionId, presentation: started.session.presentation } as const;
    },
    capture(input: unknown) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return { kind: "rejected", reason: "invalid_request" } as const;
      const fields = Object.getOwnPropertyDescriptors(input);
      if (Reflect.ownKeys(fields).length !== 2 || !["sessionId", "selectedOptionId"].every((key) => Object.hasOwn(fields, key)
        && "value" in fields[key] && typeof fields[key].value === "string")) return { kind: "rejected", reason: "invalid_request" } as const;
      const sessionId = fields.sessionId.value as string;
      const entry = sessions().get(sessionId);
      if (!entry) return { kind: "rejected", reason: "unknown_session" } as const;
      if (entry.revealed) return { kind: "rejected", reason: "already_submitted" } as const;
      if (entry.attempt) return entry.attempt.selectedOptionId === fields.selectedOptionId.value
        ? { kind: "captured", attempt: entry.attempt, sessionId } as const
        : { kind: "rejected", reason: "sealed_response_conflict" } as const;
      if (readiness.kind !== "ready") return { kind: "runtime_unavailable", readiness } as const;
      const result = entry.session.submit({ selectedOptionId: fields.selectedOptionId.value });
      if (result.kind !== "captured") return result;
      entry.attempt = result.attempt;
      return { ...result, sessionId } as const;
    },
    append(attempt: IssuedDiagnosticCapturedAttemptV1) {
      if (!repository) return { kind: "unavailable", code: "storage_unavailable", reason: "runtime_unavailable" } as const;
      const result = repository.appendCapturedAttempt(attempt);
      if ("snapshot" in result) load(result.snapshot);
      else { readiness = failureState(result); index.clear(); }
      return result;
    },
    allowReveal(sessionId: string, attemptId: string) {
      const entry = sessions().get(sessionId);
      if (!entry?.attempt || entry.attempt.id !== attemptId || !index.has(attemptId) || readiness.kind !== "ready") return false;
      entry.revealed = true;
      return true;
    },
    read(sessionId: string) {
      const entry = sessions().get(sessionId);
      if (!entry) return { kind: "unavailable" } as const;
      if (entry.attempt && !entry.revealed) return { kind: "pending", sessionId, presentation: entry.session.presentation,
        selectedOptionId: entry.attempt.selectedOptionId } as const;
      if (readiness.kind !== "ready") return { kind: "unavailable" } as const;
      if (!entry.attempt) return { kind: "issued", sessionId, presentation: entry.session.presentation } as const;
      const reveal = entry.session.reveal();
      if (reveal.kind !== "revealed") return { kind: "unavailable" } as const;
      return { kind: "revealed", presentation: entry.session.presentation, selectedOptionId: entry.attempt.selectedOptionId,
        correctOptionId: reveal.correctOptionId, explanation: reveal.explanation } as const;
    },
    resolveAttempt(attemptId: string) { return readiness.kind === "ready" ? index.get(attemptId) : undefined; },
    close() { repository?.close(); entries.clear(); index.clear(); readiness = { kind: "storage_unavailable" }; },
  });
}
export type DiagnosticRuntime = ReturnType<typeof createDiagnosticRuntime>;
