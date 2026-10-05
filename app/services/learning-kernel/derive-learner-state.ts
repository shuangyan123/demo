import type {
  EvidenceRecordV1, LearnerStateDerivationV1, LearnerStateSourceTimeV1,
  LearnerStateTimeContextV1, LearnerTargetStateV1, LearningEventV1,
} from "../../types/domains/learning-kernel.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { MAX_EVIDENCE_ID_LENGTH } from "./evidence-policy.ts";
import { compareLearningEventText, isLearningEventInstant } from "./learning-event.ts";
import { evaluateLearnerStatePromotionEligibility, LEARNER_STATE_POLICY_VERSION } from "./learner-state-policy.ts";

export { LEARNER_STATE_POLICY_VERSION } from "./learner-state-policy.ts";

function isEvidenceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && value.length <= MAX_EVIDENCE_ID_LENGTH && value.isWellFormed();
}

/** 比较完整 JSON 事实，不按属性插入顺序选 winner；循环、非 JSON 或超深输入拒绝。 */
function sameValue(left: unknown, right: unknown, ancestors = new Set<object>(), depth = 0): boolean {
  if (depth > 32) return false;
  if (left === null || typeof left !== "object") {
    return (left === null || ["string", "boolean"].includes(typeof left)
      || (typeof left === "number" && Number.isFinite(left))) && Object.is(left, right);
  }
  if (right === null || typeof right !== "object" || ancestors.has(left) || ancestors.has(right)) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (!Array.isArray(left) && [left, right].some((value) => (
    Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
  ))) return false;
  ancestors.add(left);
  ancestors.add(right);
  try {
    const leftKeys = Object.keys(left).toSorted(compareLearningEventText);
    const rightKeys = Object.keys(right).toSorted(compareLearningEventText);
    if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => (
      key === rightKeys[index] && sameValue((left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key], ancestors, depth + 1)
    ));
  } finally {
    ancestors.delete(left);
    ancestors.delete(right);
  }
}

/** 只读经 canonical Evidence 验证的 Event occurrence；不读取 payload 或 recordedAt。 */
function latestSourceTime(records: readonly EvidenceRecordV1[], eventsById: ReadonlyMap<string, LearningEventV1>,
  diagnostics: LearnerStateDerivationV1["diagnostics"]): LearnerStateSourceTimeV1 | null {
  const times = records.flatMap((item) => item.sourceEventIds.flatMap((id) => {
    const event = eventsById.get(id)!;
    const precision = event.provenance.timePrecision;
    return event.occurredAt !== null && precision !== "unknown"
      ? [{ value: event.occurredAt, precision, evidenceId: item.id, eventId: id }] : [];
  }));
  if (new Set(times.map((time) => time.precision)).size > 1) {
    // civil date 没有时区，不能与 instant 补成同一时间轴。
    for (const time of times) diagnostics.push({ code: "ambiguous_evidence_time",
      sourceEvidenceId: time.evidenceId, sourceEventId: time.eventId });
    return null;
  }
  const latest = times.toSorted((left, right) => (
    (left.precision === "instant" ? Date.parse(right.value) - Date.parse(left.value)
      : compareLearningEventText(right.value, left.value)) || compareLearningEventText(left.value, right.value)
  ))[0];
  return latest ? { value: latest.value, precision: latest.precision } : null;
}

function result(states: LearnerTargetStateV1[], diagnostics: LearnerStateDerivationV1["diagnostics"]): LearnerStateDerivationV1 {
  const unique = new Map(diagnostics.map((item) => [JSON.stringify([item.sourceEventId, item.sourceEvidenceId, item.code]), item]));
  return { states, diagnostics: [...unique.values()].toSorted((left, right) => (
    compareLearningEventText(left.sourceEventId ?? "", right.sourceEventId ?? "")
    || compareLearningEventText(left.sourceEvidenceId ?? "", right.sourceEvidenceId ?? "") || compareLearningEventText(left.code, right.code)
  )) };
}

/** Phase E shadow API：完整 Evidence scope 与 asOf 是硬边界，仅执行明确授权的首次晋级，不调度。 */
export function deriveLearnerTargetStates(
  events: readonly LearningEventV1[],
  evidence: readonly EvidenceRecordV1[],
  timeContext: LearnerStateTimeContextV1,
): LearnerStateDerivationV1 {
  if (!isLearningEventInstant(timeContext?.asOf)) return { states: [], diagnostics: [
    { code: "invalid_time_context", sourceEventId: null, sourceEvidenceId: null },
  ] };

  // 复用唯一 Evidence policy；TypeScript shape 和来源自称的 strength 不授予权限。
  const canonical = deriveEvidence(events);
  const diagnostics: LearnerStateDerivationV1["diagnostics"] = canonical.diagnostics.map((item) => (
    { code: item.code, sourceEventId: item.sourceEventId, sourceEvidenceId: null }
  ));
  const canonicalById = new Map(canonical.evidence.map((item) => [item.id, item]));
  const acceptedEventIds = new Set(canonical.evidence.flatMap((item) => item.sourceEventIds));
  const eventsById = new Map(events.filter((event) => event && acceptedEventIds.has(event.id)).map((event) => [event.id, event]));
  const groups = new Map<string, EvidenceRecordV1[]>();
  let invalidScope = false;
  for (const item of evidence) {
    if (!isEvidenceId(item?.id)) {
      diagnostics.push({ code: "invalid_evidence", sourceEventId: null, sourceEvidenceId: null });
      invalidScope = true;
      continue;
    }
    const group = groups.get(item.id) ?? [];
    group.push(item);
    groups.set(item.id, group);
  }
  for (const [id, group] of [...groups].toSorted(([left], [right]) => compareLearningEventText(left, right))) {
    const item = group[0];
    const expected = canonicalById.get(id);
    const conflict = group.length > 1 && group.some((candidate) => !sameValue(item, candidate));
    const orphan = Array.isArray(item.sourceEventIds) && item.sourceEventIds.some((sourceId) => !eventsById.has(sourceId));
    const code = conflict ? "conflicting_evidence_identity" : orphan ? "orphan_evidence"
      : !expected || !sameValue(item, expected) ? "noncanonical_evidence" : null;
    if (code || !expected) {
      diagnostics.push({ code: code ?? "noncanonical_evidence", sourceEventId: null, sourceEvidenceId: id });
      invalidScope = true;
    }
  }
  // 即使遗漏的是 completion 或未来 Evidence，也必须先拒绝不完整输入，不能静默补齐。
  for (const item of canonical.evidence) {
    if (!groups.has(item.id)) {
      diagnostics.push({ code: "incomplete_evidence_scope", sourceEventId: null, sourceEvidenceId: item.id });
      invalidScope = true;
    }
  }
  if (invalidScope) return result([], diagnostics);

  const targets = new Map<string, EvidenceRecordV1[]>();
  const asOfInstant = Date.parse(timeContext.asOf);
  const asOfDate = timeContext.asOf.slice(0, 10);
  for (const expected of canonical.evidence) {
    let afterAsOf = false;
    for (const id of expected.sourceEventIds) {
      const event = eventsById.get(id)!;
      const time = event.occurredAt;
      const precision = event.provenance.timePrecision;
      // date-only 只与 asOf 的 civil date 比较，同日不能声称早于某个精确 instant。
      if (time !== null && (precision === "instant" ? Date.parse(time) > asOfInstant
        : precision === "date" && compareLearningEventText(time, asOfDate) > 0)) {
        diagnostics.push({ code: "evidence_after_as_of", sourceEventId: id, sourceEvidenceId: expected.id });
        afterAsOf = true;
      }
    }
    if (afterAsOf) continue;
    // 仅使用重算后的白名单对象；workflow-only target 不进入状态集合。
    if (expected.claim === "completion") continue;
    const target = expected.target;
    const key = JSON.stringify([target.category, target.namespace, target.id]);
    const records = targets.get(key) ?? [];
    records.push(expected);
    targets.set(key, records);
  }
  const states = [...targets.values()].map((records): LearnerTargetStateV1 => {
    const target = records[0].target;
    const sourceEvents = [...new Set(records.flatMap((item) => item.sourceEventIds))].map((id) => eventsById.get(id)!);
    const promotionEligibility = evaluateLearnerStatePromotionEligibility(records, sourceEvents);
    const supportingIds = promotionEligibility.understanding.eligibleSupportingEvidenceIds;
    const supporting = records.filter((item) => supportingIds.includes(item.id) && item.assistance === "none")
      .map((item) => item.id).toSorted(compareLearningEventText);
    const understandingEligible = promotionEligibility.understanding.status === "eligible";
    const independenceEligible = promotionEligibility.independence.status === "eligible";
    return {
      schemaVersion: 1, target: { category: target.category, namespace: target.namespace, id: target.id },
      // 只授权独立完成的正确单题测量；反证冲突保持默认，重复成功不推断更强状态。
      understanding: understandingEligible ? "emerging" : "unknown",
      independence: independenceEligible ? "independent" : "unknown", retention: "untested", transfer: "untested",
      evidenceReferences: { understanding: understandingEligible ? [...supporting] : [],
        independence: independenceEligible ? [...supporting] : [], retention: [], transfer: [] },
      sourceEvidenceIds: records.map((item) => item.id).toSorted(compareLearningEventText),
      promotionEligibility,
      lastEvidenceAt: latestSourceTime(records, eventsById, diagnostics),
      lastVerifiedAt: latestSourceTime(records.filter((item) => promotionEligibility.understanding.eligibleEvidenceIds.includes(item.id)),
        eventsById, diagnostics),
      nextVerificationAt: null,
      policyVersion: LEARNER_STATE_POLICY_VERSION, timeContext: { asOf: timeContext.asOf },
    };
  }).toSorted((left, right) => compareLearningEventText(left.target.category, right.target.category)
    || compareLearningEventText(left.target.namespace, right.target.namespace) || compareLearningEventText(left.target.id, right.target.id));
  return result(states, diagnostics);
}
