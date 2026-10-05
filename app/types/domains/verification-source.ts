import type { VerifiedAssessmentAssistanceV1, VerifiedAssessmentAttemptV1, VerifiedAssessmentSpecV1 } from "./learning-kernel.ts";

/** Caller 只定位来源事实；key、辅助与时间不由请求授予 authority。 */
export type VerificationSourceAdmissionRequestV1 = {
  sourceOwnerId: string;
  specId: string;
  specRevision: string;
  attemptId: string;
};

/** 经独立批准的 spec owner 返回；contentRevision 绑定题目及选项内容，不携带正文。 */
export type VerificationSourceSpecV1 = {
  schemaVersion: 1;
  id: string;
  revision: string;
  contentRevision: string;
  optionIds: readonly string[];
  verifiedCorrectOptionId: string;
};

/** Capture owner 对展示版本、选项顺序、选择、辅助及发生时间负责；无提示日志不等于 none。 */
export type VerificationSourceAttemptV1 = {
  schemaVersion: 1;
  id: string;
  specId: string;
  specRevision: string;
  contentRevision: string;
  optionIds: readonly string[];
  selectedOptionId: string;
  assistance: VerifiedAssessmentAssistanceV1;
  occurredAt: string;
};

export type VerificationSourceAdmissionRejectionV1 =
  | "invalid_request" | "unknown_source_owner" | "unknown_spec" | "invalid_spec"
  | "spec_revision_mismatch" | "spec_binding_mismatch" | "invalid_attempt"
  | "missing_assistance" | "invalid_occurrence_time" | "invalid_source_facts";

/** Admitted 仅表示单次输入准入，不证明 repository history completeness 或 learner state。 */
export type VerificationSourceAdmissionResultV1 = (
  | { kind: "admitted"; spec: VerifiedAssessmentSpecV1; attempt: VerifiedAssessmentAttemptV1 }
  | { kind: "rejected"; reason: VerificationSourceAdmissionRejectionV1 }
) & { policyVersion: "source-admission/v1" };
