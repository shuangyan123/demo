import type {
  VerificationSourceAdmissionRequestV1, VerificationSourceAdmissionResultV1,
  VerificationSourceAdmissionRejectionV1, VerificationSourceSpecV1,
} from "../../types/domains/verification-source.ts";
import type { VerifiedAssessmentAssistanceV1, VerifiedAssessmentAttemptV1, VerifiedAssessmentSpecV1 } from "../../types/domains/learning-kernel.ts";
import { isLearningEventInstant, isLegacyRecordId } from "../learning-kernel/learning-event.ts";
import { adaptVerifiedAssessment } from "../learning-kernel/verified-assessment-adapter.ts";

const POLICY_VERSION = "source-admission/v1";

/** 内部受信能力，不能由公共 request 或其他 runtime 模块注册；测试仅证明条件性契约。 */
export type AuthorizedVerificationSourceOwner = {
  readonly id: string;
  /** Spec 核验与 capture 可靠性是批准 owner 的外层前提，shape 校验无法证明。 */
  readonly resolveSpec: (specId: string, revision: string) => unknown;
  readonly resolveAttempt: (attemptId: string) => unknown;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validRequest(value: unknown): value is VerificationSourceAdmissionRequestV1 {
  return object(value) && [value.sourceOwnerId, value.specId, value.specRevision, value.attemptId].every(isLegacyRecordId);
}

function optionIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && Array.from(value).every(isLegacyRecordId)
    && new Set(value).size === value.length;
}

function validSpec(value: unknown): value is VerificationSourceSpecV1 {
  return object(value) && value.schemaVersion === 1 && isLegacyRecordId(value.id) && isLegacyRecordId(value.revision)
    && isLegacyRecordId(value.contentRevision) && optionIds(value.optionIds)
    && isLegacyRecordId(value.verifiedCorrectOptionId) && value.optionIds.includes(value.verifiedCorrectOptionId);
}

function assistance(value: unknown): value is VerifiedAssessmentAssistanceV1 {
  return value === "none" || value === "hint" || value === "guided" || value === "solution";
}

function rejected(reason: VerificationSourceAdmissionRejectionV1): VerificationSourceAdmissionResultV1 {
  return { kind: "rejected", reason, policyVersion: POLICY_VERSION };
}

/** 仅公共 admission facade 与专用契约测试可调用；resolver 本身必须由该边界控制。 */
export function admitFromAuthorizedSource(
  request: unknown,
  resolveOwner: (id: string) => AuthorizedVerificationSourceOwner | undefined,
): VerificationSourceAdmissionResultV1 {
  try {
    if (!validRequest(request)) return rejected("invalid_request");
    const owner = resolveOwner(request.sourceOwnerId);
    if (!owner) return rejected("unknown_source_owner");
    if (owner.id !== request.sourceOwnerId || typeof owner.resolveSpec !== "function" || typeof owner.resolveAttempt !== "function")
      return rejected("invalid_source_facts");
    // 请求只定位事实；调用方附加 key、target、assistance 或 timestamp 均不参与准入。
    const canonical = owner.resolveSpec(request.specId, request.specRevision);
    if (canonical == null) return rejected("unknown_spec");
    if (!validSpec(canonical)) return rejected("invalid_spec");
    if (canonical.id !== request.specId) return rejected("spec_binding_mismatch");
    if (canonical.revision !== request.specRevision) return rejected("spec_revision_mismatch");
    const captured = owner.resolveAttempt(request.attemptId);
    if (!object(captured) || captured.schemaVersion !== 1 || captured.id !== request.attemptId
      || !isLegacyRecordId(captured.specId) || !isLegacyRecordId(captured.specRevision)
      || !isLegacyRecordId(captured.contentRevision) || !optionIds(captured.optionIds)
      || !isLegacyRecordId(captured.selectedOptionId) || !captured.optionIds.includes(captured.selectedOptionId))
      return rejected("invalid_attempt");
    if (captured.specRevision !== canonical.revision) return rejected("spec_revision_mismatch");
    if (captured.specId !== canonical.id || captured.contentRevision !== canonical.contentRevision
      || captured.optionIds.length !== canonical.optionIds.length
      || captured.optionIds.some((id, index) => id !== canonical.optionIds[index])) return rejected("spec_binding_mismatch");
    if (captured.assistance == null) return rejected("missing_assistance");
    if (!assistance(captured.assistance)) return rejected("invalid_attempt");
    if (!isLearningEventInstant(captured.occurredAt)) return rejected("invalid_occurrence_time");

    // 在现有 ID 字段中绑定完整 source revision；内容、顺序或 key 改变不能继续成为同一 Kernel target。
    const spec: VerifiedAssessmentSpecV1 = { schemaVersion: 1,
      id: JSON.stringify([POLICY_VERSION, owner.id, canonical.id, canonical.revision,
        canonical.contentRevision, canonical.optionIds, canonical.verifiedCorrectOptionId]),
      optionCount: canonical.optionIds.length, verifiedCorrectOptionIndex: canonical.optionIds.indexOf(canonical.verifiedCorrectOptionId) };
    const attempt: VerifiedAssessmentAttemptV1 = { schemaVersion: 1,
      id: JSON.stringify([POLICY_VERSION, owner.id, captured.id]), specId: spec.id,
      selectedOptionIndex: canonical.optionIds.indexOf(captured.selectedOptionId),
      assistance: captured.assistance, occurredAt: captured.occurredAt };
    // 复用既有 Kernel bounds / identity 契约；不截断过长身份，不输出临时 Event，也不改变 adapter。
    const normalized = adaptVerifiedAssessment(spec, attempt);
    if (normalized.diagnostics.length) return rejected(normalized.diagnostics[0].code === "invalid_spec" ? "invalid_spec" : "invalid_attempt");
    return { kind: "admitted", spec, attempt, policyVersion: POLICY_VERSION };
  } catch {
    // Owner 错误不能把 Provider/正文/凭据带入拒绝结果，也不能回退 caller 的自由对象。
    return rejected("invalid_source_facts");
  }
}
