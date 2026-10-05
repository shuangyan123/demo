import type {
  EvidenceLimitationV1, EvidenceRecordV1, LearnerStateDimensionV1,
  LearnerStatePromotionBlockerV1, LearnerStatePromotionEligibilityV1, LearningEventV1,
} from "../../types/domains/learning-kernel.ts";
import { compareLearningEventText } from "./learning-event.ts";
import { deriveEvidence, sameCanonicalEvidence } from "./derive-evidence.ts";
import { VERIFIED_EVIDENCE_POLICY_VERSION } from "./evidence-policy.ts";

export const LEARNER_STATE_POLICY_VERSION = "learner-state-policy/v3";

const LIMITATIONS: readonly EvidenceLimitationV1[] = [
  "self_report_only", "no_independent_grader", "model_authored_key", "model_assessment_only",
  "assistance_unknown", "current_projection", "history_incomplete",
];

/** 直接测量资格独立于正向晋级；受辅助或 refuting 的真实验证仍可刷新验证时间。 */
function qualifiedVerifiedAssessmentEvidence(
  evidence: readonly EvidenceRecordV1[], events: readonly LearningEventV1[],
): EvidenceRecordV1[] {
  // 完整 Event 校验包含 kind、adapter、provenance、双 lineage 与 comparison；shape 本身不授权。
  const canonical = new Map(deriveEvidence(events).evidence
    .filter((item) => item.policyVersion === VERIFIED_EVIDENCE_POLICY_VERSION).map((item) => [item.id, item]));
  const measurements = new Map<string, EvidenceRecordV1>();
  for (const item of evidence) {
    const expected = canonical.get(item.id);
    if (expected && sameCanonicalEvidence(item, expected)) measurements.set(expected.measurementGroupId, expected);
  }
  return [...measurements.values()].toSorted((left, right) => compareLearningEventText(left.id, right.id));
}

/** 由状态派生器先校验完整 canonical scope 与 asOf；本函数只解释每个 target 的晋级权限。 */
export function evaluateLearnerStatePromotionEligibility(
  evidence: readonly EvidenceRecordV1[],
  events: readonly LearningEventV1[] = [],
): Record<LearnerStateDimensionV1, LearnerStatePromotionEligibilityV1> {
  const measurements = new Map<string, Set<string>>();
  const legacyBlockers = new Set<LearnerStatePromotionBlockerV1>();
  for (const item of evidence) {
    if (item.claim === "completion" || item.evidenceClass === "workflow_fact") continue;
    const records = measurements.get(item.measurementGroupId) ?? new Set<string>();
    records.add(item.id);
    measurements.set(item.measurementGroupId, records);
    // 只投影封闭词表，不能把来源附加文案或私有字段作为 blocker 输出。
    for (const limitation of LIMITATIONS) {
      if (item.provenance.limitations.includes(limitation)) legacyBlockers.add(limitation);
    }
    if (item.assistance === "unknown") legacyBlockers.add("assistance_unknown");
  }
  const candidateMeasurementGroupIds = [...measurements.keys()].toSorted(compareLearningEventText);
  const candidateEvidenceIds = [...new Set(candidateMeasurementGroupIds.flatMap((id) => [...measurements.get(id)!]))]
    .toSorted(compareLearningEventText);
  const qualified = qualifiedVerifiedAssessmentEvidence(evidence, events);
  const supporting = qualified.filter((item) => item.outcome.direction === "supports");
  const refuting = qualified.filter((item) => item.outcome.direction === "refutes");
  // qualified 的单 Event 血缘与 offset-aware instant 已经 canonical 校验；不按字符串或插入顺序选测量。
  const eventsById = new Map(events.filter((event) => event?.kind === "verification.assessed").map((event) => [event.id, event]));
  const timed = qualified.map((item) => ({ item, instant: Date.parse(eventsById.get(item.sourceEventIds[0])!.occurredAt!) }));
  const effectiveInstant = timed.reduce((latest, measurement) => Math.max(latest, measurement.instant), -Infinity);
  // 等实际时刻的所有测量共同决定当前状态；历史合格 Evidence 不删除，也不永久制造当前冲突。
  const effective = timed.filter((measurement) => measurement.instant === effectiveInstant).map(({ item }) => item);
  const historical = timed.filter((measurement) => measurement.instant < effectiveInstant).map(({ item }) => item);
  const effectiveSupporting = effective.filter((item) => item.outcome.direction === "supports");
  const effectiveRefuting = effective.filter((item) => item.outcome.direction === "refutes");
  const blockers: LearnerStatePromotionBlockerV1[] = [];
  if (!qualified.length) blockers.push("no_qualified_direct_evidence", ...legacyBlockers);
  else {
    if (!effectiveSupporting.length) blockers.push("no_qualified_supporting_evidence");
    if (effectiveSupporting.length && effectiveRefuting.length) blockers.push("conflicting_qualified_evidence");
    if (effectiveSupporting.length && !effectiveSupporting.some((item) => item.assistance === "none")) blockers.push("assistance_present");
  }
  const eligibility = (extra: LearnerStatePromotionBlockerV1[] = []): LearnerStatePromotionEligibilityV1 => ({
    status: blockers.length || extra.length ? "blocked" : "eligible",
    candidateEvidenceIds: [...candidateEvidenceIds], candidateMeasurementGroupIds: [...candidateMeasurementGroupIds],
    // retention / transfer 尚无授权 context，不能借单题 correctness 获得这些维度的资格。
    eligibleEvidenceIds: extra.length ? [] : qualified.map((item) => item.id),
    eligibleSupportingEvidenceIds: extra.length ? [] : supporting.map((item) => item.id),
    eligibleRefutingEvidenceIds: extra.length ? [] : refuting.map((item) => item.id),
    effectiveEvidenceIds: extra.length ? [] : effective.map((item) => item.id),
    effectiveSupportingEvidenceIds: extra.length ? [] : effectiveSupporting.map((item) => item.id),
    effectiveRefutingEvidenceIds: extra.length ? [] : effectiveRefuting.map((item) => item.id),
    historicalQualifiedEvidenceIds: extra.length ? [] : historical.map((item) => item.id),
    blockers: [...new Set([...blockers, ...extra])].toSorted(compareLearningEventText),
  });
  // 当前只授权 emerging / independent；重复测量与时间间隔不增加 authority。
  return {
    understanding: eligibility(), independence: eligibility(),
    retention: eligibility(["missing_delayed_verification"]),
    transfer: eligibility(["missing_transfer_context"]),
  };
}
