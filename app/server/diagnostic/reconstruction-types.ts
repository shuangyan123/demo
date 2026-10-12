import type { EvidenceRecordV1, LearnerStateDerivationV1, LearnerTargetStateV1, LearningEventV1,
  LearningTargetV1, VerificationDecisionV1 } from "../../types/domains/learning-kernel.ts";

/** complete 仅表示当前 profile/epoch/source 的这个完整 durable generation，不代表 lifetime 或其他 source。 */
export type DiagnosticHistoryScope = Readonly<{
  completeness: "all_durable_captures_in_source_epoch";
  sourceOwnerId: "recall-diagnostic";
  profileId: string;
  epochId: string;
  generation: number;
  captureCount: number;
}>;
export type DiagnosticReconstructionFailure =
  | Readonly<{ kind: "unavailable"; code: "storage_config_unavailable" | "storage_unavailable" }>
  | Readonly<{ kind: "incomplete"; code: "history_uninitialized" | "history_incomplete" }>
  | Readonly<{ kind: "corrupt"; code: "history_corrupt" | "profile_mismatch" | "epoch_mismatch" }>
  | Readonly<{ kind: "unsupported"; code: "history_unsupported" }>
  | Readonly<{ kind: "authority_failure"; code: "invalid_request" | "spec_resolution_failure" | "admission_failure"
    | "event_derivation_failure" | "evidence_derivation_failure" | "state_derivation_failure" }>;
export type DiagnosticTargetHistory = Readonly<{
  target: LearningTargetV1;
  events: readonly LearningEventV1[];
  evidence: readonly EvidenceRecordV1[];
}>;
export type CompleteDiagnosticLearningHistory = Readonly<{
  kind: "complete";
  scope: DiagnosticHistoryScope;
  events: readonly LearningEventV1[];
  evidence: readonly EvidenceRecordV1[];
  targets: readonly DiagnosticTargetHistory[];
}>;
export type DiagnosticLearningHistory = CompleteDiagnosticLearningHistory | DiagnosticReconstructionFailure;
export type DiagnosticStateReconstruction = Readonly<{
  kind: "complete";
  scope: DiagnosticHistoryScope;
  target: LearningTargetV1;
  targetCaptureCount: number;
  events: readonly LearningEventV1[];
  evidence: readonly EvidenceRecordV1[];
  measurement: "measured" | "unmeasured";
  state: LearnerTargetStateV1 | null;
  derivation: LearnerStateDerivationV1;
  decision: VerificationDecisionV1;
}> | DiagnosticReconstructionFailure;
