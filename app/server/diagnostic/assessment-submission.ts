import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { adaptVerifiedAssessment } from "../../services/learning-kernel/verified-assessment-adapter.ts";
import { deriveEvidence } from "../../services/learning-kernel/derive-evidence.ts";
import { initializeDiagnosticRuntime } from "./runtime.ts";
import type { DiagnosticRuntime } from "./runtime-core.ts";

/** Capture 已封存后才 admission/派生；后续失败不回滚 capture，不授权整流程重试。 */
export function commitDiagnosticSubmission(input: unknown) {
  return continueDiagnosticSubmission(input, initializeDiagnosticRuntime());
}

/** 内部故障测试 seam；production facade 固定 runtime/admission，不接受 caller dependencies。 */
export function continueDiagnosticSubmission(input: unknown, runtime: DiagnosticRuntime,
  admit: typeof admitVerifiedAssessment = admitVerifiedAssessment) {
  const captured = runtime.capture(input);
  if (captured.kind !== "captured") return captured;
  const attempt = captured.attempt;
  const durable = runtime.append(attempt);
  if (durable.kind !== "committed" && durable.kind !== "confirmed")
    return { kind: "captured_not_durable", attempt, failure: durable } as const;
  const admitted = admit({ sourceOwnerId: attempt.sourceOwnerId,
    specId: attempt.specId, specRevision: attempt.specRevision, attemptId: attempt.id });
  if (admitted.kind !== "admitted") return { kind: "durable_not_admitted", attempt, failure: admitted } as const;
  const adapted = adaptVerifiedAssessment(admitted.spec, admitted.attempt);
  const derived = deriveEvidence(adapted.events);
  if (adapted.diagnostics.length || derived.diagnostics.length || derived.evidence.length !== 1)
    return { kind: "durable_without_evidence", attempt } as const;
  if (!runtime.allowReveal(captured.sessionId, attempt.id)) return { kind: "durable_without_evidence", attempt } as const;
  return { kind: "submitted", attempt, admitted, evidence: derived.evidence } as const;
}
