/** Kernel 描述观察事实、有限 Evidence 与纯派生状态；不包含持久化契约。 */
export type LearningTargetV1 = {
  category: "question" | "mistake" | "knowledge" | "concept" | "skill" | "interview_skill";
  namespace: string;
  id: string;
};

export type LearningSourceRecordTypeV1 =
  | "review_attempt"
  | "knowledge_attempt"
  | "tutoring_turn"
  | "interview_session"
  | "interview_evaluation";

export type LearningSourceRecordRefV1 = {
  recordType: LearningSourceRecordTypeV1;
  recordId: string;
  /** 仅标识当前可观察修订，不代表能够恢复被覆盖的历史。 */
  revision?: string;
};

export type LearningEventProvenanceV1 = {
  normalizationVersion: "legacy-events/v1";
  modality: "self_report" | "selection" | "model_assessment" | "unknown";
  /** false 也不代表内容经过独立验证；未知作者事实必须保持 unknown。 */
  modelAuthored: boolean | "unknown";
  keySource: "model_authored" | "none" | "unknown";
  scoringMethod: "self_report" | "option_key_comparison" | "model_rubric" | "none";
  timePrecision: "date" | "instant" | "unknown";
  history: "complete_record" | "current_projection";
};

type ReportedReviewPayloadV1 = {
  reportedResult: "correct" | "uncertain" | "wrong";
  /** 旧 confidence 实际保存 1..5 scheduling/mastery heuristic，不是置信概率。 */
  legacyMasteryAfter: number;
};

export type LearningEventPayloadsV1 = {
  "review.completed": ReportedReviewPayloadV1 & { durationSec?: number };
  "knowledge_review.completed": ReportedReviewPayloadV1;
  "assessment.submitted": {
    selectedOptionIndex: number;
    suppliedCorrectOptionIndex: number;
    matchesSuppliedKey: boolean;
    assessmentQuestionCount: number;
    submittedCorrectCount: number;
    questionOrdinal: number;
  };
  "interview.completed": { workflowStatus: "evaluated" };
  "interview.evaluated": {
    totalScore: number;
    evaluationType: "structured" | "structured_group" | "leaderless_group";
    /** 模型维度标签不是 canonical skill identity。 */
    dimensions: Array<{ name: string; score: number; maxScore: number }>;
  };
};

export type LearningEventKindV1 = keyof LearningEventPayloadsV1;

type LearningEventBaseV1 = {
  schemaVersion: 1;
  id: string;
  occurredAt: string | null;
  /** 缺少独立录入时间时为 null，不能用加载时间或 occurredAt 填充。 */
  recordedAt: string | null;
  sessionId?: string;
  attemptId?: string;
  target: LearningTargetV1;
  source: { adapterId: "recall-legacy/v1"; records: LearningSourceRecordRefV1[] };
  provenance: LearningEventProvenanceV1;
  /** 经外层授权保留的 opaque trace 引用；legacy adapters 不生成此字段。 */
  traceRef?: string;
};

/** kind 与 payload 关联，禁止用任意 state patch 冒充学习事件。 */
export type LearningEventV1<K extends LearningEventKindV1 = LearningEventKindV1> = {
  [Kind in K]: LearningEventBaseV1 & { kind: Kind; payload: LearningEventPayloadsV1[Kind] };
}[K];

export type LegacyEventAdapterDiagnostic = {
  code: "missing_target" | "incomplete_submission" | "inconsistent_source" | "history_not_recoverable" | "unsupported_source";
  source: { recordType: LearningSourceRecordTypeV1; recordId: string | null };
};

export type LegacyEventAdapterResult = {
  events: LearningEventV1[];
  diagnostics: LegacyEventAdapterDiagnostic[];
};

export type EvidenceClaimV1 = "completion" | "correctness" | "performance" | "understanding"
  | "independence" | "retention" | "transfer" | "misconception";
export type EvidenceClassV1 = "workflow_fact" | "self_report" | "scored_performance"
  | "human_assessment" | "model_assessment" | "sensor_observation";
export type EvidenceAssistanceV1 = "unknown" | "none" | "hint" | "guided" | "solution";
export type EvidenceStrengthV1 = "weak" | "moderate" | "strong";
export type EvidenceDirectionV1 = "supports" | "refutes" | "inconclusive";
export type EvidenceOutcomeV1 =
  | { kind: "workflow_completed"; direction: "supports" }
  | { kind: "self_reported_result"; result: "correct" | "uncertain" | "wrong"; direction: EvidenceDirectionV1 }
  | { kind: "supplied_key_comparison"; matchesSuppliedKey: boolean; direction: "supports" | "refutes" }
  | { kind: "model_rubric_score"; scope: "overall"; score: number; maxScore: number; direction: "inconclusive" }
  | { kind: "model_rubric_score"; scope: "dimension"; dimension: string; dimensionIndex: number;
      score: number; maxScore: number; direction: "inconclusive" };
export type EvidenceLimitationV1 = "self_report_only" | "no_independent_grader" | "model_authored_key"
  | "model_assessment_only" | "assistance_unknown" | "current_projection" | "history_incomplete";

/** strength 仅作用于该记录的 scoped claim；模型分数不产生权威学习状态。 */
export type EvidenceRecordV1 = {
  schemaVersion: 1;
  id: string;
  target: LearningTargetV1;
  claim: EvidenceClaimV1;
  outcome: EvidenceOutcomeV1;
  evidenceClass: EvidenceClassV1;
  assistance: EvidenceAssistanceV1;
  strength: EvidenceStrengthV1;
  sourceEventIds: [string, ...string[]];
  sourceRecordRefs: LearningSourceRecordRefV1[];
  /** 同一 Event 的多个 rubric slices 不是多个独立 attempt。 */
  measurementGroupId: string;
  policyVersion: "evidence-policy/v1";
  provenance: LearningEventProvenanceV1 & {
    adapterId: "recall-legacy/v1";
    limitations: EvidenceLimitationV1[];
  };
};

export type EvidencePolicyDiagnostic = {
  code: "invalid_event" | "invalid_provenance" | "invalid_lineage" | "invalid_measurement"
    | "conflicting_event_identity" | "identity_out_of_bounds";
  /** 只保留合法的 opaque event identity，不复制无效 payload 或错误正文。 */
  sourceEventId: string | null;
};
export type EvidenceDerivationV1 = {
  evidence: EvidenceRecordV1[];
  diagnostics: EvidencePolicyDiagnostic[];
};

export type LearnerStateTimeContextV1 = {
  /** 必须是带 timezone/offset 的有效 instant；派生不读取运行时钟。 */
  asOf: string;
};

export type LearnerStateSourceTimeV1 = {
  value: string;
  precision: "date" | "instant";
};

/** Phase E 首片的分类契约；枚举可表达未来状态，不代表当前 Evidence 获准晋级。 */
export type LearnerTargetStateV1 = {
  schemaVersion: 1;
  target: LearningTargetV1;
  understanding: "unknown" | "emerging" | "developing" | "supported";
  independence: "unknown" | "assisted" | "partial" | "independent";
  retention: "untested" | "at_risk" | "supported";
  transfer: "untested" | "weak" | "supported";
  /** 只引用实际支持该维度非默认状态的 Evidence；当前 policy 全部为空。 */
  evidenceReferences: {
    understanding: string[];
    independence: string[];
    retention: string[];
    transfer: string[];
  };
  /** 已校验的非 completion 来源，仅用于追溯，不表示支持任何维度晋级。 */
  sourceEvidenceIds: string[];
  lastEvidenceAt: LearnerStateSourceTimeV1 | null;
  lastVerifiedAt: LearnerStateSourceTimeV1 | null;
  nextVerificationAt: string | null;
  policyVersion: "learner-state-policy/v1";
  timeContext: LearnerStateTimeContextV1;
};

export type LearnerStateDerivationDiagnosticV1 = {
  code: EvidencePolicyDiagnostic["code"] | "invalid_time_context" | "invalid_evidence"
    | "conflicting_evidence_identity" | "orphan_evidence" | "noncanonical_evidence" | "ambiguous_evidence_time";
  /** 诊断只保留合法 opaque IDs 与 code，不复制输入正文或错误消息。 */
  sourceEventId: string | null;
  sourceEvidenceId: string | null;
};

export type LearnerStateDerivationV1 = {
  states: LearnerTargetStateV1[];
  diagnostics: LearnerStateDerivationDiagnosticV1[];
};
