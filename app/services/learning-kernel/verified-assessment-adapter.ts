import type {
  EvidencePolicyDiagnostic, LearningEventV1, LearningEventProvenanceV1,
  VerifiedAssessmentAdapterResultV1, VerifiedAssessmentAssistanceV1,
  VerifiedAssessmentAttemptV1, VerifiedAssessmentSpecV1,
} from "../../types/domains/learning-kernel.ts";
import { isLearningEventInstant, isLegacyRecordId, MAX_LEARNING_EVENT_ID_LENGTH } from "./learning-event.ts";

export const VERIFIED_ASSESSMENT_ADAPTER_ID = "recall-verified-assessment/v1";
const PROVENANCE = Object.freeze({
  normalizationVersion: "verified-assessment/v1", modality: "selection", modelAuthored: false,
  keySource: "verified_assessment", scoringMethod: "verified_key_comparison",
  timePrecision: "instant", history: "complete_record",
} satisfies LearningEventProvenanceV1);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function index(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function assistance(value: unknown): value is VerifiedAssessmentAssistanceV1 {
  return value === "none" || value === "hint" || value === "guided" || value === "solution";
}
function validSpec(value: unknown): value is VerifiedAssessmentSpecV1 {
  return object(value) && value.schemaVersion === 1 && isLegacyRecordId(value.id)
    && index(value.optionCount) && value.optionCount > 0 && index(value.verifiedCorrectOptionIndex)
    && value.verifiedCorrectOptionIndex < value.optionCount;
}
function validAttempt(value: unknown): value is VerifiedAssessmentAttemptV1 {
  return object(value) && value.schemaVersion === 1 && isLegacyRecordId(value.id) && isLegacyRecordId(value.specId)
    && index(value.selectedOptionIndex) && assistance(value.assistance) && isLearningEventInstant(value.occurredAt);
}

/** 规格验证属于外层授权责任；本 adapter 锁定事实契约，不把来源的自称正确/verified 当评分。 */
export function adaptVerifiedAssessment(spec: unknown, attempt: unknown): VerifiedAssessmentAdapterResultV1 {
  const reject = (code: VerifiedAssessmentAdapterResultV1["diagnostics"][number]["code"],
    recordType: "verification_spec" | "verification_attempt", input: unknown): VerifiedAssessmentAdapterResultV1 => ({
    events: [], diagnostics: [{ code, source: { recordType,
      recordId: object(input) && isLegacyRecordId(input.id) ? input.id : null } }],
  });
  if (!validSpec(spec)) return reject("invalid_spec", "verification_spec", spec);
  if (!validAttempt(attempt) || attempt.selectedOptionIndex >= spec.optionCount)
    return reject("invalid_attempt", "verification_attempt", attempt);
  if (attempt.specId !== spec.id) return reject("spec_attempt_mismatch", "verification_attempt", attempt);
  const attemptRevision = JSON.stringify([spec.id, attempt.selectedOptionIndex, attempt.assistance, attempt.occurredAt]);
  const specRevision = JSON.stringify([spec.optionCount, spec.verifiedCorrectOptionIndex]);
  // 双 lineage 与 observable revision 都进入身份；任一事实变化都不能沿用旧 Event。
  const id = [VERIFIED_ASSESSMENT_ADAPTER_ID, "verification.assessed", attempt.id, attemptRevision, spec.id, specRevision]
    .map((part) => encodeURIComponent(part)).join("/");
  if (id.length > MAX_LEARNING_EVENT_ID_LENGTH) return reject("invalid_attempt", "verification_attempt", attempt);
  return { events: [{
    schemaVersion: 1, id, kind: "verification.assessed", occurredAt: attempt.occurredAt, recordedAt: null,
    attemptId: attempt.id, target: { category: "question", namespace: "verified_assessment_question", id: spec.id },
    source: { adapterId: VERIFIED_ASSESSMENT_ADAPTER_ID, records: [
      { recordType: "verification_attempt", recordId: attempt.id, revision: attemptRevision },
      { recordType: "verification_spec", recordId: spec.id, revision: specRevision },
    ] }, provenance: { ...PROVENANCE },
    payload: { selectedOptionIndex: attempt.selectedOptionIndex, verifiedCorrectOptionIndex: spec.verifiedCorrectOptionIndex,
      matchesVerifiedKey: attempt.selectedOptionIndex === spec.verifiedCorrectOptionIndex, assistance: attempt.assistance },
  }], diagnostics: [] };
}

/** 重建授权 adapter 的白名单事实，逐项核对，拒绝伪造 provenance、revision、target 或 comparison。 */
export function validateVerifiedAssessmentEvent(event: LearningEventV1<"verification.assessed">): EvidencePolicyDiagnostic["code"] | null {
  const p = event.provenance;
  if (event.source.adapterId !== VERIFIED_ASSESSMENT_ADAPTER_ID
    || Object.entries(PROVENANCE).some(([key, value]) => p[key as keyof LearningEventProvenanceV1] !== value)
    || !isLearningEventInstant(event.occurredAt) || event.recordedAt !== null || event.sessionId !== undefined)
    return "invalid_provenance";
  const refs = event.source.records;
  if (!Array.isArray(refs) || refs.length !== 2) return "invalid_lineage";
  const [attemptRef, specRef] = refs;
  if (!object(attemptRef) || !object(specRef) || attemptRef.recordType !== "verification_attempt"
    || specRef.recordType !== "verification_spec" || !isLegacyRecordId(attemptRef.recordId) || !isLegacyRecordId(specRef.recordId)
    || event.attemptId !== attemptRef.recordId || event.target.category !== "question"
    || event.target.namespace !== "verified_assessment_question" || event.target.id !== specRef.recordId)
    return "invalid_lineage";
  for (const ref of refs) {
    if (typeof ref.revision !== "string" || ref.revision.length > 4096 || !ref.revision.isWellFormed()) return "invalid_lineage";
  }
  try {
    const ar: unknown = JSON.parse(attemptRef.revision!);
    const sr: unknown = JSON.parse(specRef.revision!);
    if (!Array.isArray(ar) || ar.length !== 4 || !Array.isArray(sr) || sr.length !== 2) return "invalid_lineage";
    const normalized = adaptVerifiedAssessment({ schemaVersion: 1, id: specRef.recordId,
      optionCount: sr[0], verifiedCorrectOptionIndex: sr[1] }, { schemaVersion: 1, id: attemptRef.recordId,
      specId: ar[0], selectedOptionIndex: ar[1], assistance: ar[2], occurredAt: ar[3] }).events[0];
    if (!normalized || normalized.id !== event.id || normalized.occurredAt !== event.occurredAt
      || normalized.source.records.some((ref, i) => ref.revision !== refs[i].revision)) return "invalid_lineage";
    if (Object.entries(normalized.payload).some(([key, value]) => event.payload[key as keyof typeof normalized.payload] !== value))
      return "invalid_measurement";
    return null;
  } catch {
    return "invalid_lineage";
  }
}
