import type { EvidencePolicyDiagnostic, LearningEventV1 } from "../../types/domains/learning-kernel.ts";
import { isLegacyRecordId, legacyLearningEventId, legacyLearningEventTime, MAX_LEARNING_EVENT_ID_LENGTH } from "./learning-event.ts";

export const EVIDENCE_POLICY_VERSION = "evidence-policy/v1";
export const MAX_EVIDENCE_ID_LENGTH = 16384;

export function isEvidenceSourceEventId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && value.length <= MAX_LEARNING_EVENT_ID_LENGTH && value.isWellFormed();
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function score(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

/** 校验 Phase B 的可观察 revision，拒绝 payload 与给定 key/选择/题目身份矛盾的投影。 */
function validMicroRevision(event: LearningEventV1<"assessment.submitted">): boolean {
  try {
    const ref = event.source.records[0];
    const revision: unknown = JSON.parse(ref.revision!);
    if (!Array.isArray(revision) || revision.length !== 3) return false;
    const [index, questionId, measurement] = revision;
    if (!integer(index, 0) || !isLegacyRecordId(questionId) || !Array.isArray(measurement) || measurement.length !== 3) return false;
    const [time, questions, total] = measurement;
    const payload = event.payload;
    if (time !== event.occurredAt || total !== payload.submittedCorrectCount || !Array.isArray(questions)
      || questions.length !== payload.assessmentQuestionCount || index + 1 !== payload.questionOrdinal) return false;
    const ids = new Set<string>();
    let matches = 0;
    for (const question of questions) {
      if (!Array.isArray(question) || question.length !== 4) return false;
      const [id, selected, key, optionCount] = question;
      if (!isLegacyRecordId(id) || ids.has(id) || !integer(optionCount, 1)
        || !integer(selected, 0) || !integer(key, 0) || selected >= optionCount || key >= optionCount) return false;
      ids.add(id);
      matches += Number(selected === key);
    }
    const question = questions[index];
    return matches === total && question?.[0] === questionId
      && question[1] === payload.selectedOptionIndex && question[2] === payload.suppliedCorrectOptionIndex
      && event.target.id === `${encodeURIComponent(ref.recordId)}:${encodeURIComponent(questionId)}`
      && ref.revision === JSON.stringify(revision);
  } catch {
    return false;
  }
}

/** 类型声明不授予权限；只接受已知 legacy adapter 的完整、相容事实。 */
export function validateEvidenceEvent(input: unknown): EvidencePolicyDiagnostic["code"] | null {
  if (!object(input) || input.schemaVersion !== 1 || !isEvidenceSourceEventId(input.id)
    || !object(input.target) || !object(input.source) || !object(input.provenance) || !object(input.payload)) return "invalid_event";
  const kinds = ["review.completed", "knowledge_review.completed", "assessment.submitted", "interview.completed", "interview.evaluated"];
  if (!kinds.includes(input.kind as string)) return "invalid_event";
  const event = input as LearningEventV1;
  const { provenance, target, source } = event;
  const review = event.kind === "review.completed" || event.kind === "knowledge_review.completed";
  const micro = event.kind === "assessment.submitted";
  const evaluated = event.kind === "interview.evaluated";
  const expected = review ? ["self_report", "unknown", "none", "self_report", "complete_record"]
    : micro ? ["selection", true, "model_authored", "option_key_comparison", "current_projection"]
    : evaluated ? ["model_assessment", true, "none", "model_rubric", "current_projection"]
    : ["unknown", "unknown", "none", "none", "current_projection"];
  if (source.adapterId !== "recall-legacy/v1" || provenance.normalizationVersion !== "legacy-events/v1"
    || [provenance.modality, provenance.modelAuthored, provenance.keySource, provenance.scoringMethod, provenance.history]
      .some((value, index) => value !== expected[index])) return "invalid_provenance";
  const time = legacyLearningEventTime(event.occurredAt);
  if (event.recordedAt !== null || time.occurredAt !== event.occurredAt || time.timePrecision !== provenance.timePrecision
    || (review && time.timePrecision === "instant") || (!review && time.timePrecision === "date")
    || ((micro || evaluated) && time.timePrecision !== "instant")) return "invalid_provenance";

  const category = event.kind === "review.completed" ? "mistake" : event.kind === "knowledge_review.completed" ? "knowledge" : "question";
  const namespace = review ? category : micro ? "tutoring_micro_question" : "interview_question";
  if (target.category !== category || target.namespace !== namespace
    || !(micro ? isEvidenceSourceEventId(target.id) : isLegacyRecordId(target.id))) return "invalid_lineage";
  if (!Array.isArray(source.records) || source.records.length !== (review || micro ? 1 : 2)) return "invalid_lineage";
  for (const ref of source.records) {
    if (!object(ref) || !isLegacyRecordId(ref.recordId)
      || (ref.revision !== undefined && (typeof ref.revision !== "string" || !ref.revision.isWellFormed() || ref.revision.length > 4096))) return "invalid_lineage";
  }
  const primary = source.records[0];
  const recordType = event.kind === "review.completed" ? "review_attempt" : event.kind === "knowledge_review.completed" ? "knowledge_attempt"
    : micro ? "tutoring_turn" : "interview_evaluation";
  if (primary.recordType !== recordType || (micro ? primary.revision === undefined : primary.revision !== undefined)
    || legacyLearningEventId(primary, event.kind) !== event.id) return "invalid_lineage";
  if (review ? event.attemptId !== primary.recordId || event.sessionId !== undefined
    : !isLegacyRecordId(event.sessionId) || event.attemptId !== undefined) return "invalid_lineage";
  if (!review && !micro && (source.records[1].recordType !== "interview_session"
    || source.records[1].recordId !== event.sessionId || source.records[1].revision !== undefined)) return "invalid_lineage";

  switch (event.kind) {
    case "review.completed":
    case "knowledge_review.completed":
      if (!["correct", "uncertain", "wrong"].includes(event.payload.reportedResult)
        || !score(event.payload.legacyMasteryAfter, 5) || event.payload.legacyMasteryAfter < 1) return "invalid_measurement";
      if (event.kind === "review.completed" && event.payload.durationSec !== undefined
        && !score(event.payload.durationSec, Number.MAX_VALUE)) return "invalid_measurement";
      break;
    case "assessment.submitted": {
      const p = event.payload;
      if (!integer(p.selectedOptionIndex, 0) || !integer(p.suppliedCorrectOptionIndex, 0)
        || p.matchesSuppliedKey !== (p.selectedOptionIndex === p.suppliedCorrectOptionIndex)
        || !integer(p.assessmentQuestionCount, 1) || !integer(p.submittedCorrectCount, 0)
        || p.submittedCorrectCount > p.assessmentQuestionCount || !integer(p.questionOrdinal, 1)
        || p.questionOrdinal > p.assessmentQuestionCount || !validMicroRevision(event)) return "invalid_measurement";
      break;
    }
    case "interview.completed":
      if (event.payload.workflowStatus !== "evaluated") return "invalid_measurement";
      break;
    case "interview.evaluated":
      if (!score(event.payload.totalScore, 100) || !["structured", "structured_group", "leaderless_group"].includes(event.payload.evaluationType)
        || !Array.isArray(event.payload.dimensions) || Array.from(event.payload.dimensions).some((dimension) => (
          !object(dimension) || !isLegacyRecordId(dimension.name) || typeof dimension.maxScore !== "number"
          || !Number.isFinite(dimension.maxScore) || dimension.maxScore <= 0 || !score(dimension.score, dimension.maxScore)
        ))) return "invalid_measurement";
  }
  return null;
}
