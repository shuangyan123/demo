import { submitDiagnostic } from "./assessment-store.ts";
import { admitVerifiedAssessment } from "../../services/verification-source/verification-source-admission.ts";
import { adaptVerifiedAssessment } from "../../services/learning-kernel/verified-assessment-adapter.ts";
import { deriveEvidence } from "../../services/learning-kernel/derive-evidence.ts";

/** Capture 已封存后才 admission/派生；后续失败不回滚 capture，不授权整流程重试。 */
export function commitDiagnosticSubmission(input: unknown) {
  const captured = submitDiagnostic(input);
  if (captured.kind !== "captured") return captured;
  const attempt = captured.attempt;
  const admitted = admitVerifiedAssessment({ sourceOwnerId: attempt.sourceOwnerId,
    specId: attempt.specId, specRevision: attempt.specRevision, attemptId: attempt.id });
  if (admitted.kind !== "admitted") return { kind: "captured_not_admitted", attemptId: attempt.id } as const;
  const adapted = adaptVerifiedAssessment(admitted.spec, admitted.attempt);
  const derived = deriveEvidence(adapted.events);
  if (adapted.diagnostics.length || derived.diagnostics.length || derived.evidence.length !== 1)
    return { kind: "captured_without_evidence", attemptId: attempt.id } as const;
  // 仅内存验收既有 Evidence semantics；不调用 learner state/policy，也不写 repository。
  return { kind: "submitted", attempt, admitted, evidence: derived.evidence } as const;
}
