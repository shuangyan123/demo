import type {
  EvidenceClaimV1, EvidenceClassV1, EvidenceDerivationV1, EvidenceLimitationV1,
  EvidencePolicyDiagnostic, LearningEventKindV1, LearningEventV1,
} from "../../types/domains/learning-kernel.ts";
import { EVIDENCE_POLICY_VERSION } from "./evidence-policy.ts";

export type EvidenceShadowReportV1 = {
  schemaVersion: 1;
  policyVersion: typeof EVIDENCE_POLICY_VERSION;
  /** 输入行数包含重复与拒绝项；evidenceCount 是去重且校验后的记录数。 */
  eventCount: number;
  evidenceCount: number;
  measurementGroupCount: number;
  countsByEventKind: Record<LearningEventKindV1, number>;
  countsByEvidenceClass: Record<EvidenceClassV1, number>;
  countsByClaim: Record<EvidenceClaimV1, number>;
  diagnosticsByCode: Record<EvidencePolicyDiagnostic["code"], number>;
  authorityLimitationCounts: Record<EvidenceLimitationV1, number>;
};

/** 只返回固定词表的计数；不包含 target、rubric 标签、来源正文或运行时行为。 */
export function buildEvidenceShadowReport(events: readonly LearningEventV1[], derivation: EvidenceDerivationV1): EvidenceShadowReportV1 {
  const report: EvidenceShadowReportV1 = {
    schemaVersion: 1, policyVersion: EVIDENCE_POLICY_VERSION,
    eventCount: events.length, evidenceCount: derivation.evidence.length,
    measurementGroupCount: new Set(derivation.evidence.map((item) => item.measurementGroupId)).size,
    countsByEventKind: { "review.completed": 0, "knowledge_review.completed": 0, "assessment.submitted": 0,
      "interview.completed": 0, "interview.evaluated": 0 },
    countsByEvidenceClass: { workflow_fact: 0, self_report: 0, scored_performance: 0, human_assessment: 0, model_assessment: 0, sensor_observation: 0 },
    countsByClaim: { completion: 0, correctness: 0, performance: 0, understanding: 0, independence: 0, retention: 0, transfer: 0, misconception: 0 },
    diagnosticsByCode: { invalid_event: 0, invalid_provenance: 0, invalid_lineage: 0, invalid_measurement: 0,
      conflicting_event_identity: 0, identity_out_of_bounds: 0 },
    authorityLimitationCounts: { self_report_only: 0, no_independent_grader: 0, model_authored_key: 0,
      model_assessment_only: 0, assistance_unknown: 0, current_projection: 0, history_incomplete: 0 },
  };
  for (const event of events) {
    if (event && Object.hasOwn(report.countsByEventKind, event.kind)) report.countsByEventKind[event.kind]++;
  }
  for (const item of derivation.evidence) {
    report.countsByEvidenceClass[item.evidenceClass]++;
    report.countsByClaim[item.claim]++;
    for (const limitation of item.provenance.limitations) report.authorityLimitationCounts[limitation]++;
  }
  for (const diagnostic of derivation.diagnostics) report.diagnosticsByCode[diagnostic.code]++;
  return report;
}
