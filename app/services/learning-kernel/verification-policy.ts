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

function complete(value: LearnerStatePromotionEligibilityV1 | undefined): value is LearnerStatePromotionEligibilityV1 {
  return Boolean(value && (value.status === "eligible" || value.status === "blocked")
    && ids(value.effectiveEvidenceIds) && ids(value.effectiveSupportingEvidenceIds)
    && ids(value.effectiveRefutingEvidenceIds) && ids(value.blockers));
}

function partitioned(value: LearnerStatePromotionEligibilityV1): boolean {
  const support = value.effectiveSupportingEvidenceIds;
  const refute = value.effectiveRefutingEvidenceIds;
  return !support.some((id) => refute.includes(id))
    && sameIds(value.effectiveEvidenceIds, [...support, ...refute]);
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
  if (!["unknown", "emerging"].includes(state.understanding)
    || !["unknown", "independent"].includes(state.independence)
    || state.retention !== "untested" || state.transfer !== "untested"
    || retention.status !== "blocked" || transfer.status !== "blocked"
    || retention.effectiveEvidenceIds.length || transfer.effectiveEvidenceIds.length
    || retention.effectiveSupportingEvidenceIds.length || retention.effectiveRefutingEvidenceIds.length
    || transfer.effectiveSupportingEvidenceIds.length || transfer.effectiveRefutingEvidenceIds.length
    || !retention.blockers.includes("missing_delayed_verification")
    || !transfer.blockers.includes("missing_transfer_context")) return none("unsupported_effective_state");
  // v3 的两个直接维度共享 effective set；不一致的摘要不能暗中获得 target 优先级。
  if (!partitioned(understanding) || !partitioned(independence)
    || !sameIds(understanding.effectiveEvidenceIds, independence.effectiveEvidenceIds)
    || !sameIds(understanding.effectiveSupportingEvidenceIds, independence.effectiveSupportingEvidenceIds)
    || !sameIds(understanding.effectiveRefutingEvidenceIds, independence.effectiveRefutingEvidenceIds)
    || !sameIds(understanding.blockers, independence.blockers) || understanding.status !== independence.status
    || !sameIds(refs.understanding, refs.independence) || refs.retention.length || refs.transfer.length)
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
