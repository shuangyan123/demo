import type {
  LearnerStateDerivationV1, LearnerStatePromotionEligibilityV1, LearningTargetV1, VerificationDecisionV1,
} from "../../types/domains/learning-kernel.ts";
import { isLearningEventInstant } from "./learning-event.ts";

function ids(value: unknown): value is string[] {
  return Array.isArray(value) && Array.from(value).every((id) => typeof id === "string" && id.trim().length > 0)
    && new Set(value).size === value.length;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const other = new Set(right);
  return left.length === right.length && left.every((id) => other.has(id));
}

const QUALIFICATION_ID_FIELDS = [
  "candidateEvidenceIds", "candidateMeasurementGroupIds", "eligibleEvidenceIds",
  "eligibleSupportingEvidenceIds", "eligibleRefutingEvidenceIds", "effectiveEvidenceIds",
  "effectiveSupportingEvidenceIds", "effectiveRefutingEvidenceIds", "historicalQualifiedEvidenceIds",
] as const;

function complete(value: LearnerStatePromotionEligibilityV1 | undefined): value is LearnerStatePromotionEligibilityV1 {
  return Boolean(value && (value.status === "eligible" || value.status === "blocked")
    && QUALIFICATION_ID_FIELDS.every((field) => ids(value[field])) && ids(value.blockers));
}

function subset(child: readonly string[], parent: readonly string[]): boolean {
  const allowed = new Set(parent);
  return child.every((id) => allowed.has(id));
}

function partition(all: readonly string[], left: readonly string[], right: readonly string[]): boolean {
  return !left.some((id) => right.includes(id)) && sameIds(all, [...left, ...right]);
}

/** 仅校验 v3 摘要的集合关系；历史方向不参与当前 target 选择，也不凭 IDs 建立 Evidence authority。 */
function consistent(value: LearnerStatePromotionEligibilityV1): boolean {
  return partition(value.eligibleEvidenceIds, value.eligibleSupportingEvidenceIds, value.eligibleRefutingEvidenceIds)
    && partition(value.effectiveEvidenceIds, value.effectiveSupportingEvidenceIds, value.effectiveRefutingEvidenceIds)
    && partition(value.eligibleEvidenceIds, value.effectiveEvidenceIds, value.historicalQualifiedEvidenceIds)
    && subset(value.effectiveSupportingEvidenceIds, value.eligibleSupportingEvidenceIds)
    && subset(value.effectiveRefutingEvidenceIds, value.eligibleRefutingEvidenceIds)
    && subset(value.eligibleEvidenceIds, value.candidateEvidenceIds);
}

function sameCandidates(left: LearnerStatePromotionEligibilityV1, right: LearnerStatePromotionEligibilityV1): boolean {
  return sameIds(left.candidateEvidenceIds, right.candidateEvidenceIds)
    && sameIds(left.candidateMeasurementGroupIds, right.candidateMeasurementGroupIds);
}

function sharedQualification(left: LearnerStatePromotionEligibilityV1, right: LearnerStatePromotionEligibilityV1): boolean {
  return QUALIFICATION_ID_FIELDS.every((field) => sameIds(left[field], right[field]))
    && sameIds(left.blockers, right.blockers) && left.status === right.status;
}

function qualifiedEmpty(value: LearnerStatePromotionEligibilityV1): boolean {
  // consistent 已保证 eligible 是 effective/historical 及正反证的完备分区。
  return value.eligibleEvidenceIds.length === 0;
}

/** 消费完整 state derivation 的受信输出；不重新评分、授权或解释历史 Evidence，不调度或执行。 */
export function decideNextVerification(
  derivation: LearnerStateDerivationV1,
  learningTarget: LearningTargetV1,
): VerificationDecisionV1 {
  const none = (reason: Extract<VerificationDecisionV1, { kind: "none" }>["reason"]): VerificationDecisionV1 => ({ kind: "none", reason });
  if (!Array.isArray(derivation?.states) || !Array.isArray(derivation?.diagnostics) || !learningTarget)
    return none("incomplete_effective_state");
  // future Evidence 已由 asOf 排除；其余诊断不能被挑选单个正常 state 隐藏。
  if (derivation.diagnostics.some((item) => item?.code !== "evidence_after_as_of"))
    return none("ambiguous_evidence_qualification");
  const matches = derivation.states.filter((state) => state?.target?.category === learningTarget.category
    && state.target.namespace === learningTarget.namespace && state.target.id === learningTarget.id);
  if (!matches.length) return none("incomplete_effective_state");
  if (matches.length !== 1) return none("ambiguous_evidence_qualification");
  const state = matches[0];
  if (state.schemaVersion !== 1 || state.policyVersion !== "learner-state-policy/v3")
    return none("unsupported_effective_state");
  const understanding = state.promotionEligibility?.understanding;
  const independence = state.promotionEligibility?.independence;
  const retention = state.promotionEligibility?.retention;
  const transfer = state.promotionEligibility?.transfer;
  const refs = state.evidenceReferences;
  if (!complete(understanding) || !complete(independence) || !complete(retention) || !complete(transfer) || !refs
    || !ids(refs.understanding) || !ids(refs.independence) || !ids(refs.retention) || !ids(refs.transfer)
    || !isLearningEventInstant(state.timeContext?.asOf) || state.understanding == null || state.independence == null
    || state.retention == null || state.transfer == null) return none("incomplete_effective_state");
  if (![understanding, independence, retention, transfer].every(consistent)
    || !sharedQualification(understanding, independence)
    || !sameCandidates(understanding, retention) || !sameCandidates(understanding, transfer)
    || !qualifiedEmpty(retention) || !qualifiedEmpty(transfer)) return none("ambiguous_evidence_qualification");
  if (!["unknown", "emerging"].includes(state.understanding)
    || !["unknown", "independent"].includes(state.independence)
    || state.retention !== "untested" || state.transfer !== "untested"
    || retention.status !== "blocked" || transfer.status !== "blocked"
    || retention.effectiveEvidenceIds.length || transfer.effectiveEvidenceIds.length
    || retention.effectiveSupportingEvidenceIds.length || retention.effectiveRefutingEvidenceIds.length
    || transfer.effectiveSupportingEvidenceIds.length || transfer.effectiveRefutingEvidenceIds.length
    || !retention.blockers.includes("missing_delayed_verification")
    || !transfer.blockers.includes("missing_transfer_context")) return none("unsupported_effective_state");
  if (!sameIds(refs.understanding, refs.independence) || refs.retention.length || refs.transfer.length)
    return none("ambiguous_evidence_qualification");
  const effective = understanding.effectiveEvidenceIds;
  const supports = understanding.effectiveSupportingEvidenceIds;
  const refutes = understanding.effectiveRefutingEvidenceIds;
  const unknown = state.understanding === "unknown" && state.independence === "unknown"
    && !refs.understanding.length && understanding.status === "blocked";
  if (!effective.length) {
    return none(unknown && state.lastVerifiedAt === null && understanding.blockers.includes("no_qualified_direct_evidence")
      ? "no_qualified_direct_evidence" : "ambiguous_evidence_qualification");
  }
  if (state.lastVerifiedAt?.precision !== "instant" || !isLearningEventInstant(state.lastVerifiedAt.value))
    return none("incomplete_effective_state");
  if (supports.length && refutes.length) return none("ambiguous_evidence_qualification");
  if (refutes.length) {
    // 当前反证同时使两维 unknown；现有模型没有可授权的规则区分下一次应验证哪一维。
    return none(unknown && sameIds(understanding.blockers, ["no_qualified_supporting_evidence"])
      ? "ambiguous_verification_target" : "ambiguous_evidence_qualification");
  }
  if (unknown && sameIds(understanding.blockers, ["assistance_present"]))
    return { kind: "verify", target: "independence", reason: "assistance_present" };
  if (state.understanding === "emerging" && state.independence === "independent"
    && understanding.status === "eligible" && !understanding.blockers.length && refs.understanding.length
    && refs.understanding.every((id) => supports.includes(id))) {
    // 有限单题事实已满足；untested 本身不授权缺少 delayed/transfer context 的验证目标。
    return none("no_authorized_verification_target");
  }
  return none("ambiguous_evidence_qualification");
}
