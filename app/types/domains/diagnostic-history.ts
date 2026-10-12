import type { DiagnosticCapturedAttemptV1, IssuedDiagnosticCapturedAttemptV1 } from "./first-party-diagnostic-capture.ts";

export type DiagnosticHistorySnapshotV1 = Readonly<{
  formatVersion: 1;
  profileId: string;
  epochId: string;
  generation: number;
  captures: readonly DiagnosticCapturedAttemptV1[];
}>;

export type DiagnosticHistoryFailure =
  | Readonly<{ kind: "uninitialized" }>
  | Readonly<{ kind: "incomplete"; reason: string }>
  | Readonly<{ kind: "unavailable"; code: "storage_unavailable"; reason: string }>
  | Readonly<{ kind: "corrupt"; reason: string }>
  | Readonly<{ kind: "unsupported_version"; version: number }>
  | Readonly<{ kind: "conflict"; reason: "attempt_identity_conflict" }>
  | Readonly<{ kind: "rejected"; reason: "untrusted_capture" | "capacity_exceeded" | "invalid_attempt_id" }>
  | Readonly<{ kind: "closed" }>;

export type DiagnosticHistoryRead = Readonly<{ kind: "complete"; snapshot: DiagnosticHistorySnapshotV1 }> | DiagnosticHistoryFailure;
export type DiagnosticHistoryAppend = Readonly<{ kind: "committed" | "confirmed"; snapshot: DiagnosticHistorySnapshotV1 }> | DiagnosticHistoryFailure;
export type DiagnosticHistoryRepository = Readonly<{
  initialize: () => DiagnosticHistoryRead;
  appendCapturedAttempt: (attempt: IssuedDiagnosticCapturedAttemptV1) => DiagnosticHistoryAppend | Promise<DiagnosticHistoryAppend>;
  readCompleteSnapshot: () => DiagnosticHistoryRead;
  resolveCapturedAttempt: (attemptId: string) =>
    | Readonly<{ kind: "resolved"; attempt: DiagnosticCapturedAttemptV1; generation: number }>
    | Readonly<{ kind: "not_found"; generation: number }> | DiagnosticHistoryFailure;
  close: () => void;
}>;
export type DiagnosticHistoryOpen = Readonly<{ kind: "opened"; repository: DiagnosticHistoryRepository }> | DiagnosticHistoryFailure;
