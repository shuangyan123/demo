import type { EvidenceRecordV1, LearningTargetV1 } from "../../types/domains/learning-kernel.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { projectLegacyLearningEvents, type LegacyLearningEventFacts } from "./legacy-event-adapter.ts";

type SelfReportResultEvidence = EvidenceRecordV1 & {
  outcome: Extract<EvidenceRecordV1["outcome"], { kind: "self_reported_result" }>;
};

export type LegacyResultCompatibility = {
  source: { recordType: "review_attempt" | "knowledge_attempt"; recordId: string };
  target: LearningTargetV1;
  reportedResult: SelfReportResultEvidence["outcome"]["result"];
  observedAt: string | null;
  authority: {
    kind: "legacy_self_report_compatibility";
    evidenceClass: "self_report";
    limitation: "self_report_only";
  };
};

/** 只允许有限自报结果；completion 的强度不能授予正确性权限。 */
export function isLegacySelfReportResultEvidence(evidence: EvidenceRecordV1): evidence is SelfReportResultEvidence {
  return evidence.claim === "correctness"
    && evidence.evidenceClass === "self_report"
    && evidence.outcome.kind === "self_reported_result"
    && evidence.provenance.limitations.includes("self_report_only");
}

/**
 * Phase D 仅保留 legacy UI 的自报结果语义，不创建独立正确性或掌握结论。
 * 输入仍由既有 Repository 负责 normalization；桥接不修复或写回来源。
 */
export function projectLegacyResultCompatibility(
  facts: Pick<LegacyLearningEventFacts, "reviewAttempts" | "knowledgeAttempts">,
): LegacyResultCompatibility[] {
  const { events } = projectLegacyLearningEvents({
    reviewAttempts: facts.reviewAttempts,
    knowledgeAttempts: facts.knowledgeAttempts,
  });
  // deriveEvidence 负责 Event 有效性与 policy；不在桥接中复制这些规则。
  const { evidence } = deriveEvidence(events);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const reviewTargets = new Map((facts.reviewAttempts ?? []).map((attempt) => [attempt.id, attempt.mistakeId]));
  const knowledgeTargets = new Map((facts.knowledgeAttempts ?? []).map((attempt) => [attempt.id, attempt.knowledgeId]));

  return evidence.flatMap((item): LegacyResultCompatibility[] => {
    if (!isLegacySelfReportResultEvidence(item) || item.sourceEventIds.length !== 1 || item.sourceRecordRefs.length !== 1) return [];
    const event = eventById.get(item.sourceEventIds[0]);
    const ref = item.sourceRecordRefs[0];
    if (!event || (event.kind !== "review.completed" && event.kind !== "knowledge_review.completed")) return [];
    const recordType = event.kind === "review.completed" ? "review_attempt" : "knowledge_attempt";
    const targetId = (recordType === "review_attempt" ? reviewTargets : knowledgeTargets).get(ref.recordId);
    const eventRef = event.source.records[0];
    if (ref.recordType !== recordType || ref.recordId !== event.attemptId
      || eventRef.recordType !== ref.recordType || eventRef.recordId !== ref.recordId || eventRef.revision !== ref.revision
      || targetId === undefined || item.target.id !== targetId
      || item.target.id !== event.target.id || item.target.category !== event.target.category || item.target.namespace !== event.target.namespace) return [];

    // 明确字段白名单，避免把 legacy mastery、用户正文或完整 provenance 传给 consumer。
    return [{
      source: { recordType, recordId: ref.recordId },
      target: { category: item.target.category, namespace: item.target.namespace, id: item.target.id },
      reportedResult: item.outcome.result,
      observedAt: event.occurredAt,
      authority: { kind: "legacy_self_report_compatibility", evidenceClass: "self_report", limitation: "self_report_only" },
    }];
  });
}
