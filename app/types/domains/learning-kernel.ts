/** Phase B 只描述观察事实；不包含 Evidence、学习状态或持久化契约。 */
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
    dimensions: Array<{ name: string; score: number }>;
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
