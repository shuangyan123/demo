import { reconstructDiagnosticLearnerState } from "./state-reconstruction.ts";
import type { DiagnosticReconstructionFailure, DiagnosticStateReconstruction } from "./reconstruction-types.ts";

type Complete = Extract<DiagnosticStateReconstruction, { kind: "complete" }>;
type State = NonNullable<Complete["state"]>;
function capturedAttemptId(boundId: string | undefined): string | null {
  // admission ID 的固定 source tuple 包装原 UUID；只取原身份，不生成或重写 attempt。
  try {
    const parts: unknown = JSON.parse(boundId ?? "");
    return Array.isArray(parts) && parts.length === 3 && parts[0] === "source-admission/v1" && parts[1] === "recall-diagnostic"
      && typeof parts[2] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[2])
      ? parts[2] : null;
  } catch { return null; }
}
export type DiagnosticResumeView = DiagnosticReconstructionFailure | Readonly<{
  kind: "complete";
  history: "complete-empty" | "resumed";
  asOf: string;
  scope: Readonly<{ completeness: Complete["scope"]["completeness"]; sourceOwnerId: "recall-diagnostic";
    sourceCaptureCount: number; generation: number }>;
  attemptCount: number;
  evidenceCount: number;
  measurement: Complete["measurement"];
  attempts: readonly Readonly<{ attemptId: string; occurredAt: string; direction: "supports" | "refutes";
    assistance: Complete["evidence"][number]["assistance"];
    provenance: Readonly<{ modelAuthored: boolean; keySource: "verified_assessment"; scoringMethod: "verified_key_comparison" }> }> [];
  state: Readonly<Pick<State, "understanding" | "independence" | "retention" | "transfer" | "nextVerificationAt">
    & { lastEvidenceAt: State["lastEvidenceAt"]; lastVerifiedAt: State["lastVerifiedAt"] }> | null;
  decision: Complete["decision"];
}>;

/** 纯展示投影，不授予 authority；只有专用 contracts 可直接提供重建结果。 */
export function projectDiagnosticResumeView(result: DiagnosticStateReconstruction, asOf: string): DiagnosticResumeView {
  // 失败保持原 discriminant/code，不 spread 可能附带的内部诊断或来源正文。
  switch (result.kind) {
    case "unavailable": return { kind: result.kind, code: result.code };
    case "incomplete": return { kind: result.kind, code: result.code };
    case "corrupt": return { kind: result.kind, code: result.code };
    case "unsupported": return { kind: result.kind, code: result.code };
    case "authority_failure": return { kind: result.kind, code: result.code };
  }
  const evidenceByEvent = new Map(result.evidence.map(item => [item.sourceEventIds[0], item]));
  const attempts: Extract<DiagnosticResumeView, { kind: "complete" }>["attempts"][number][] = [];
  for (const event of result.events) {
    const evidence = evidenceByEvent.get(event.id);
    const attemptId = capturedAttemptId(event.attemptId);
    // 生产 capture 使用随机 UUID；其他 opaque/answer-bound 身份不能直接出现在浏览器中。
    if (!attemptId
      || event.occurredAt === null || evidence?.outcome.kind !== "verified_key_comparison"
      || evidence.provenance.modelAuthored !== false || evidence.provenance.keySource !== "verified_assessment"
      || evidence.provenance.scoringMethod !== "verified_key_comparison")
      return { kind: "authority_failure", code: "evidence_derivation_failure" };
    attempts.push({ attemptId, occurredAt: event.occurredAt, direction: evidence.outcome.direction,
      assistance: evidence.assistance,
      provenance: { modelAuthored: evidence.provenance.modelAuthored, keySource: evidence.provenance.keySource,
        scoringMethod: evidence.provenance.scoringMethod } });
  }
  const state = result.state;
  return {
    kind: "complete", history: result.targetCaptureCount === 0 ? "complete-empty" : "resumed", asOf,
    scope: { completeness: result.scope.completeness, sourceOwnerId: result.scope.sourceOwnerId,
      sourceCaptureCount: result.scope.captureCount, generation: result.scope.generation },
    attemptCount: result.targetCaptureCount, evidenceCount: result.evidence.length, measurement: result.measurement, attempts,
    state: state ? { understanding: state.understanding, independence: state.independence, retention: state.retention,
      transfer: state.transfer, nextVerificationAt: state.nextVerificationAt,
      lastEvidenceAt: state.lastEvidenceAt ? { value: state.lastEvidenceAt.value, precision: state.lastEvidenceAt.precision } : null,
      lastVerifiedAt: state.lastVerifiedAt ? { value: state.lastVerifiedAt.value, precision: state.lastVerifiedAt.precision } : null } : null,
    decision: result.decision.kind === "verify"
      ? { kind: "verify", target: result.decision.target, reason: result.decision.reason }
      : { kind: "none", reason: result.decision.reason },
  };
}

/** 固定生产只读入口；不接 caller target/history、Host config、clock 或 dependencies，不初始化存储。 */
export function loadDiagnosticResumeView(): DiagnosticResumeView {
  const asOf = new Date().toISOString();
  return projectDiagnosticResumeView(reconstructDiagnosticLearnerState({ specId: "int-add-2-3", specRevision: "r1", asOf }), asOf);
}
