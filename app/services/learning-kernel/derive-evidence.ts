import type {
  EvidenceClaimV1, EvidenceDerivationV1, EvidenceLimitationV1, EvidenceOutcomeV1,
  EvidenceRecordV1, LearningEventV1,
} from "../../types/domains/learning-kernel.ts";
import { compareLearningEventText } from "./learning-event.ts";
import { EVIDENCE_POLICY_VERSION, isEvidenceSourceEventId, MAX_EVIDENCE_ID_LENGTH, validateEvidenceEvent } from "./evidence-policy.ts";

/** 仅用于内存中的冲突检测；不输出源内容。排序键避免对象属性顺序影响去重。 */
function fingerprint(value: unknown, ancestors = new Set<object>(), depth = 0): string {
  if (depth > 32) throw new Error("invalid_event");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("invalid_event");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${Array.from(value, (item) => fingerprint(item, ancestors, depth + 1)).join(",")}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("invalid_event");
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => compareLearningEventText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${fingerprint(item, ancestors, depth + 1)}`).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function record(event: LearningEventV1, claim: EvidenceClaimV1, outcome: EvidenceOutcomeV1,
  evidenceClass: EvidenceRecordV1["evidenceClass"], slice: string, extra: EvidenceLimitationV1[] = []): EvidenceRecordV1 | null {
  const id = [EVIDENCE_POLICY_VERSION, event.id, event.target.category, event.target.namespace, event.target.id, claim, slice]
    .map((part) => encodeURIComponent(part)).join("/");
  if (id.length > MAX_EVIDENCE_ID_LENGTH) return null;
  const p = event.provenance;
  const limitations: EvidenceLimitationV1[] = ["assistance_unknown", ...extra];
  if (p.history === "current_projection") limitations.push("current_projection", "history_incomplete");
  return {
    schemaVersion: 1, id,
    target: { category: event.target.category, namespace: event.target.namespace, id: event.target.id },
    claim, outcome, evidenceClass, assistance: "unknown", strength: claim === "completion" ? "strong" : "weak",
    sourceEventIds: [event.id],
    sourceRecordRefs: event.source.records.map((ref) => ({ recordType: ref.recordType, recordId: ref.recordId,
      ...(ref.revision === undefined ? {} : { revision: ref.revision }) })),
    measurementGroupId: event.id, policyVersion: EVIDENCE_POLICY_VERSION,
    // 显式白名单投影，绝不 spread 输入 provenance、target 或 source 的附加私有字段。
    provenance: { adapterId: "recall-legacy/v1", normalizationVersion: p.normalizationVersion,
      modality: p.modality, modelAuthored: p.modelAuthored, keySource: p.keySource,
      scoringMethod: p.scoringMethod, timePrecision: p.timePrecision, history: p.history,
      limitations: limitations.toSorted(compareLearningEventText) },
  };
}

function mapEvent(event: LearningEventV1): Array<EvidenceRecordV1 | null> {
  const completion = () => record(event, "completion", { kind: "workflow_completed", direction: "supports" }, "workflow_fact", "completion");
  switch (event.kind) {
    case "review.completed":
    case "knowledge_review.completed": {
      const result = event.payload.reportedResult;
      return [completion(), record(event, "correctness", { kind: "self_reported_result", result,
        direction: result === "correct" ? "supports" : result === "wrong" ? "refutes" : "inconclusive" },
      "self_report", "correctness", ["self_report_only", "no_independent_grader"])];
    }
    case "assessment.submitted":
      return [completion(), record(event, "correctness", { kind: "supplied_key_comparison",
        matchesSuppliedKey: event.payload.matchesSuppliedKey, direction: event.payload.matchesSuppliedKey ? "supports" : "refutes" },
      "scored_performance", "correctness", ["model_authored_key", "no_independent_grader"])];
    case "interview.completed": return [completion()];
    case "interview.evaluated":
      return [record(event, "performance", { kind: "model_rubric_score", scope: "overall", score: event.payload.totalScore,
        maxScore: 100, direction: "inconclusive" }, "model_assessment", "rubric:overall", ["model_assessment_only", "no_independent_grader"]),
      ...event.payload.dimensions.map((dimension, index) => record(event, "performance", {
        kind: "model_rubric_score", scope: "dimension", dimension: dimension.name, dimensionIndex: index,
        score: dimension.score, maxScore: dimension.maxScore, direction: "inconclusive",
      }, "model_assessment", `rubric:dimension:${index}:${dimension.name}`, ["model_assessment_only", "no_independent_grader"]))];
  }
}

/** Phase C 只产生有限 Evidence；冲突身份整组拒绝，不选择输入顺序 winner。 */
export function deriveEvidence(events: readonly LearningEventV1[]): EvidenceDerivationV1 {
  const groups = new Map<string, { event: LearningEventV1; fingerprint: string | null; conflict: boolean }>();
  const diagnostics: EvidenceDerivationV1["diagnostics"] = [];
  for (const event of events) {
    if (!event || !isEvidenceSourceEventId(event.id)) {
      diagnostics.push({ code: "invalid_event", sourceEventId: null });
      continue;
    }
    let signature: string | null = null;
    try { signature = fingerprint(event); } catch { /* 无法比较的输入也不能获得权限。 */ }
    const previous = groups.get(event.id);
    if (previous) previous.conflict ||= signature === null || previous.fingerprint !== signature;
    else groups.set(event.id, { event, fingerprint: signature, conflict: false });
  }
  const evidence: EvidenceRecordV1[] = [];
  for (const [id, group] of [...groups].toSorted(([left], [right]) => compareLearningEventText(left, right))) {
    const error = group.conflict ? "conflicting_event_identity"
      : group.fingerprint === null ? "invalid_event" : validateEvidenceEvent(group.event);
    if (error) {
      diagnostics.push({ code: error, sourceEventId: id });
      continue;
    }
    const records = mapEvent(group.event);
    // 一个 slice 身份超界时整次测量拒绝，防止 partial evidence 被误解为完整结果。
    if (records.some((item) => item === null)) diagnostics.push({ code: "identity_out_of_bounds", sourceEventId: id });
    else evidence.push(...records.filter((item): item is EvidenceRecordV1 => item !== null));
  }
  const uniqueDiagnostics = new Map(diagnostics.map((item) => [JSON.stringify([item.sourceEventId, item.code]), item]));
  return {
    evidence: evidence.toSorted((left, right) => compareLearningEventText(left.id, right.id)),
    diagnostics: [...uniqueDiagnostics.values()].toSorted((left, right) => (
      compareLearningEventText(left.sourceEventId ?? "", right.sourceEventId ?? "") || compareLearningEventText(left.code, right.code)
    )),
  };
}
