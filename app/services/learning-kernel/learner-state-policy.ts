import type {
  EvidenceLimitationV1, EvidenceRecordV1, LearnerStateDimensionV1,
  LearnerStatePromotionBlockerV1, LearnerStatePromotionEligibilityV1,
} from "../../types/domains/learning-kernel.ts";
import { compareLearningEventText } from "./learning-event.ts";

export const LEARNER_STATE_POLICY_VERSION = "learner-state-policy/v1";

const LIMITATIONS: readonly EvidenceLimitationV1[] = [
  "self_report_only", "no_independent_grader", "model_authored_key", "model_assessment_only",
  "assistance_unknown", "current_projection", "history_incomplete",
];

/**
 * 由派生器先校验完整 canonical scope 与 asOf，再检查候选的权限。
 * 当前没有可证明独立评分/内容有效性的来源；human_assessment 等类型形状也不授予权限。
 */
export function evaluateLearnerStatePromotionEligibility(
  evidence: readonly EvidenceRecordV1[],
): Record<LearnerStateDimensionV1, LearnerStatePromotionEligibilityV1> {
  const measurements = new Map<string, Set<string>>();
  const blockers = new Set<LearnerStatePromotionBlockerV1>(["no_qualified_direct_evidence"]);
  for (const item of evidence) {
    if (item.claim === "completion" || item.evidenceClass === "workflow_fact") continue;
    const records = measurements.get(item.measurementGroupId) ?? new Set<string>();
    records.add(item.id);
    measurements.set(item.measurementGroupId, records);
    // 只投影封闭词表，不能把来源附加文案或私有字段作为 blocker 输出。
    for (const limitation of LIMITATIONS) {
      if (item.provenance.limitations.includes(limitation)) blockers.add(limitation);
    }
    if (item.assistance === "unknown") blockers.add("assistance_unknown");
  }
  const candidateMeasurementGroupIds = [...measurements.keys()].toSorted(compareLearningEventText);
  const candidateEvidenceIds = [...new Set(candidateMeasurementGroupIds.flatMap((id) => [...measurements.get(id)!]))]
    .toSorted(compareLearningEventText);
  const blocked = (extra: LearnerStatePromotionBlockerV1[] = []): LearnerStatePromotionEligibilityV1 => ({
    status: "blocked", candidateEvidenceIds: [...candidateEvidenceIds],
    candidateMeasurementGroupIds: [...candidateMeasurementGroupIds], eligibleEvidenceIds: [],
    blockers: [...new Set([...blockers, ...extra])].toSorted(compareLearningEventText),
  });
  // 有利结果、测量数量、elapsed time 或相似题名都不能补造缺失的权限语义。
  return {
    understanding: blocked(), independence: blocked(),
    retention: blocked(["missing_delayed_verification"]),
    transfer: blocked(["missing_transfer_context"]),
  };
}
