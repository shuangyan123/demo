/**
 * 学习者状态只由可观察的本地学习证据派生，不持久化模型推测。
 */
export type LearnerEvidenceType =
  | "mistake"
  | "review_attempt"
  | "knowledge"
  | "knowledge_attempt"
  | "interview"
  | "interview_plan"
  | "tutoring"
  | "tutoring_plan";

/** 单条状态结论引用的最小本地证据。 */
export type LearnerEvidenceRef = {
  type: LearnerEvidenceType;
  id: string;
  label: string;
  observedAt: string;
};

/** 学习状态信号；score 越高表示越值得进入当前辅导上下文。 */
export type LearnerStateSignal = {
  id: string;
  kind: "goal" | "weakness" | "misconception" | "due_review" | "next_action" | "strength";
  title: string;
  summary: string;
  score: number;
  evidence: LearnerEvidenceRef[];
};

export type LearningActionKind =
  | "review_mistakes"
  | "review_knowledge"
  | "retry_tutoring"
  | "practice_interview";

export type LearningActionRecommendation = {
  id: string;
  kind: LearningActionKind;
  title: string;
  summary: string;
  priority: number;
  priorityReason: string;
  evidence: LearnerEvidenceRef[];
  destination: {
    module: "review" | "library" | "knowledgeTraining" | "tutoring" | "interview";
    targetIds?: string[];
  };
  state: "ready" | "insufficient-data" | "blocked" | "conflict";
};

/** 从错题、知识、面试和辅导记录实时计算的只读快照。 */
export type LearnerStateSnapshot = {
  generatedAt: string;
  currentGoal?: string;
  dueReviewCount: number;
  evidenceCount: number;
  insufficientEvidenceCount: number;
  sourceRecordCount: number;
  signals: LearnerStateSignal[];
  recommendations: LearningActionRecommendation[];
};

/** 辅导微测固定使用可确定评分的单选题，避免模型自信直接改变掌握度。 */
export type TutoringMicroQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
};

/** 微测提交前 selections 为空；提交后保存可审计的确定性结果。 */
export type TutoringMicroAssessment = {
  questions: TutoringMicroQuestion[];
  selections?: number[];
  correctCount?: number;
  completedAt?: string;
};

/** 浏览器和未来眼镜输入共用的结构化观察摘要；不包含原始帧。 */
export type TutoringObservation = {
  capturedAt: string;
  source: "camera" | "screen" | "upload" | "android_xr";
  summary?: string;
  confidence?: number;
  changed?: boolean;
};
