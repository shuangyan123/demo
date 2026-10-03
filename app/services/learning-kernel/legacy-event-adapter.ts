import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import type { KnowledgeAttempt } from "../../types/domains/knowledge.ts";
import type {
  LearningEventProvenanceV1,
  LearningEventV1,
  LearningSourceRecordRefV1,
  LearningSourceRecordTypeV1,
  LegacyEventAdapterDiagnostic,
  LegacyEventAdapterResult,
} from "../../types/domains/learning-kernel.ts";
import type { Attempt } from "../../types/domains/review.ts";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import {
  compareLearningEvents,
  compareLearningEventText,
  isLearningEventInstant,
  isLegacyRecordId,
  legacyLearningEventId,
  legacyLearningEventTime,
  LEGACY_EVENT_ADAPTER_ID,
  LEGACY_EVENT_NORMALIZATION_VERSION,
} from "./learning-event.ts";

function diagnostic(code: LegacyEventAdapterDiagnostic["code"], recordType: LearningSourceRecordTypeV1, recordId: unknown): LegacyEventAdapterDiagnostic {
  return { code, source: { recordType, recordId: isLegacyRecordId(recordId) ? recordId : null } };
}

function rejected(code: LegacyEventAdapterDiagnostic["code"], recordType: LearningSourceRecordTypeV1, recordId: unknown): LegacyEventAdapterResult {
  return { events: [], diagnostics: [diagnostic(code, recordType, recordId)] };
}

function selfReportProvenance(timePrecision: LearningEventProvenanceV1["timePrecision"]): LearningEventProvenanceV1 {
  return {
    normalizationVersion: LEGACY_EVENT_NORMALIZATION_VERSION,
    modality: "self_report",
    modelAuthored: "unknown",
    keySource: "none",
    scoringMethod: "self_report",
    timePrecision,
    history: "complete_record",
  };
}

function projectReviewFact(attempt: Attempt | KnowledgeAttempt, targetId: string, recordType: "review_attempt" | "knowledge_attempt"): LegacyEventAdapterResult {
  if (!isLegacyRecordId(targetId)) return rejected("missing_target", recordType, attempt.id);
  if (!isLegacyRecordId(attempt.id)) return rejected("unsupported_source", recordType, attempt.id);
  const time = legacyLearningEventTime(attempt.reviewedAt);
  if (!["correct", "uncertain", "wrong"].includes(attempt.result)
    || !Number.isFinite(attempt.confidence) || attempt.confidence < 1 || attempt.confidence > 5
    || (attempt.reviewedAt && time.timePrecision !== "date")) return rejected("inconsistent_source", recordType, attempt.id);
  const kind = recordType === "review_attempt" ? "review.completed" : "knowledge_review.completed";
  const ref: LearningSourceRecordRefV1 = { recordType, recordId: attempt.id };
  const id = legacyLearningEventId(ref, kind);
  if (!id) return rejected("unsupported_source", recordType, attempt.id);
  const base = {
    schemaVersion: 1 as const,
    id,
    occurredAt: time.occurredAt,
    recordedAt: null,
    attemptId: attempt.id,
    source: { adapterId: LEGACY_EVENT_ADAPTER_ID, records: [ref] } satisfies LearningEventV1["source"],
    provenance: selfReportProvenance(time.timePrecision),
  };
  const payload = { reportedResult: attempt.result, legacyMasteryAfter: attempt.confidence };
  if (kind === "knowledge_review.completed") {
    return { events: [{ ...base, kind, target: { category: "knowledge", namespace: "knowledge", id: targetId }, payload }], diagnostics: [] };
  }
  const durationSec = "durationSec" in attempt ? attempt.durationSec : undefined;
  if (durationSec !== undefined && (!Number.isFinite(durationSec) || durationSec < 0)) return rejected("inconsistent_source", recordType, attempt.id);
  return {
    events: [{ ...base, kind, target: { category: "mistake", namespace: "mistake", id: targetId },
      payload: { ...payload, ...(durationSec === undefined ? {} : { durationSec }) } }],
    diagnostics: [],
  };
}

/** 只投影用户确认的复盘结果，不反推新答案、辅助程度或客观正确性。 */
export function adaptReviewAttempt(attempt: Attempt): LegacyEventAdapterResult {
  return projectReviewFact(attempt, attempt.mistakeId, "review_attempt");
}

export function adaptKnowledgeAttempt(attempt: KnowledgeAttempt): LegacyEventAdapterResult {
  return projectReviewFact(attempt, attempt.knowledgeId, "knowledge_attempt");
}

/** 微测历史已被 writer 覆盖；这里只投影调用方提供的当前完整提交。 */
export function adaptTutoringMicroAssessment(turn: TutoringTurn): LegacyEventAdapterResult {
  const recordType = "tutoring_turn";
  const assessment = turn.microAssessment;
  if (!assessment || !Array.isArray(assessment.questions) || !assessment.questions.length
    || !Array.isArray(assessment.selections) || assessment.correctCount === undefined || !assessment.completedAt) {
    return rejected("incomplete_submission", recordType, turn.id);
  }
  if (!isLegacyRecordId(turn.id)) return rejected("missing_target", recordType, turn.id);
  if (!isLegacyRecordId(turn.sessionId) || turn.speaker !== "ai_tutor") return rejected("unsupported_source", recordType, turn.id);
  const { questions, selections, completedAt, correctCount } = assessment;
  if (!isLearningEventInstant(completedAt) || selections.length !== questions.length
    || !Number.isInteger(correctCount) || correctCount < 0 || correctCount > questions.length) {
    return rejected("inconsistent_source", recordType, turn.id);
  }
  if (Array.from(questions).some((question) => !question || typeof question !== "object")) return rejected("inconsistent_source", recordType, turn.id);
  if (questions.some((question) => !isLegacyRecordId(question.id))) return rejected("missing_target", recordType, turn.id);
  if (new Set(questions.map((question) => question.id)).size !== questions.length) return rejected("inconsistent_source", recordType, turn.id);
  const invalidChoice = questions.some((question, index) => {
    const optionCount = Array.isArray(question.options) ? question.options.length : 0;
    return optionCount === 0 || Array.from(question.options).some((option) => typeof option !== "string") || !Number.isInteger(question.correctOptionIndex)
      || question.correctOptionIndex < 0 || question.correctOptionIndex >= optionCount
      || !Number.isInteger(selections[index]) || selections[index] < 0 || selections[index] >= optionCount;
  });
  const computedCorrectCount = questions.reduce((count, question, index) => count + Number(selections[index] === question.correctOptionIndex), 0);
  if (invalidChoice || computedCorrectCount !== correctCount) return rejected("inconsistent_source", recordType, turn.id);

  // 时间、题目身份、给定 key 和当前选择共同标识可观察修订；不复制题目文本。
  const revision = [completedAt, questions.map((question, index) => [question.id, selections[index], question.correctOptionIndex, question.options.length]), correctCount];
  const events: LearningEventV1[] = [];
  for (const [index, question] of questions.entries()) {
    const ref: LearningSourceRecordRefV1 = { recordType, recordId: turn.id, revision: JSON.stringify([index, question.id, revision]) };
    const id = legacyLearningEventId(ref, "assessment.submitted");
    if (!id) return rejected("unsupported_source", recordType, turn.id);
    events.push({
      schemaVersion: 1,
      id,
      kind: "assessment.submitted",
      occurredAt: completedAt,
      recordedAt: null,
      sessionId: turn.sessionId,
      target: { category: "question", namespace: "tutoring_micro_question", id: `${encodeURIComponent(turn.id)}:${encodeURIComponent(question.id)}` },
      source: { adapterId: LEGACY_EVENT_ADAPTER_ID, records: [ref] },
      provenance: {
        normalizationVersion: LEGACY_EVENT_NORMALIZATION_VERSION,
        modality: "selection",
        modelAuthored: true,
        keySource: "model_authored",
        scoringMethod: "option_key_comparison",
        timePrecision: "instant",
        history: "current_projection",
      },
      payload: {
        selectedOptionIndex: selections[index],
        suppliedCorrectOptionIndex: question.correctOptionIndex,
        matchesSuppliedKey: selections[index] === question.correctOptionIndex,
        assessmentQuestionCount: questions.length,
        submittedCorrectCount: correctCount,
        questionOrdinal: index + 1,
      },
    });
  }
  return { events, diagnostics: [diagnostic("history_not_recoverable", recordType, turn.id)] };
}

/** 调用方提供当前 persisted evaluation；纯 adapter 不查询仓储或验证外部存储。 */
export function adaptInterviewEvaluation(evaluation: InterviewEvaluation, session?: InterviewSession): LegacyEventAdapterResult {
  const recordType = "interview_evaluation";
  if (!session) return rejected("unsupported_source", recordType, evaluation.id);
  if (!isLegacyRecordId(session.questionId)) return rejected("missing_target", recordType, evaluation.id);
  if (!isLegacyRecordId(evaluation.id) || !isLegacyRecordId(session.id)) return rejected("unsupported_source", recordType, evaluation.id);
  if (evaluation.sessionId !== session.id || session.status !== "evaluated" || evaluation.type !== session.type
    || !["structured", "structured_group", "leaderless_group"].includes(evaluation.type)
    || !isLearningEventInstant(evaluation.createdAt)
    || (session.completedAt !== undefined && (!isLearningEventInstant(session.completedAt)
      || Date.parse(session.completedAt) !== Date.parse(evaluation.createdAt)))
    || !Number.isFinite(evaluation.totalScore) || evaluation.totalScore < 0 || evaluation.totalScore > 100
    || !Array.isArray(evaluation.dimensions) || Array.from(evaluation.dimensions).some((dimension) => (
      !dimension || !isLegacyRecordId(dimension.name) || !Number.isFinite(dimension.score) || !Number.isFinite(dimension.maxScore)
      || dimension.maxScore <= 0 || dimension.score < 0 || dimension.score > dimension.maxScore
    ))) return rejected("inconsistent_source", recordType, evaluation.id);

  const evaluationRef: LearningSourceRecordRefV1 = { recordType, recordId: evaluation.id };
  const completionId = legacyLearningEventId(evaluationRef, "interview.completed");
  const evaluationId = legacyLearningEventId(evaluationRef, "interview.evaluated");
  if (!completionId || !evaluationId) return rejected("unsupported_source", recordType, evaluation.id);
  const completionTime = legacyLearningEventTime(session.completedAt);
  const base = {
    schemaVersion: 1 as const,
    recordedAt: null,
    sessionId: session.id,
    target: { category: "question" as const, namespace: "interview_question", id: session.questionId },
    source: { adapterId: LEGACY_EVENT_ADAPTER_ID, records: [evaluationRef, { recordType: "interview_session" as const, recordId: session.id }] } satisfies LearningEventV1["source"],
  };
  return {
    events: [
      {
        ...base,
        id: completionId,
        kind: "interview.completed",
        occurredAt: completionTime.occurredAt,
        provenance: {
          normalizationVersion: LEGACY_EVENT_NORMALIZATION_VERSION,
          modality: "unknown",
          modelAuthored: "unknown",
          keySource: "none",
          scoringMethod: "none",
          timePrecision: completionTime.timePrecision,
          history: "current_projection",
        },
        payload: { workflowStatus: "evaluated" },
      },
      {
        ...base,
        id: evaluationId,
        kind: "interview.evaluated",
        occurredAt: evaluation.createdAt,
        provenance: {
          normalizationVersion: LEGACY_EVENT_NORMALIZATION_VERSION,
          modality: "model_assessment",
          modelAuthored: true,
          keySource: "none",
          scoringMethod: "model_rubric",
          timePrecision: "instant",
          history: "current_projection",
        },
        payload: { totalScore: evaluation.totalScore, evaluationType: evaluation.type,
          dimensions: evaluation.dimensions.map(({ name, score }) => ({ name, score })) },
      },
    ],
    diagnostics: [diagnostic("history_not_recoverable", recordType, evaluation.id)],
  };
}

export type LegacyLearningEventFacts = {
  reviewAttempts?: readonly Attempt[];
  knowledgeAttempts?: readonly KnowledgeAttempt[];
  tutoringTurns?: readonly TutoringTurn[];
  interviewEvaluations?: readonly InterviewEvaluation[];
  interviewSessions?: readonly InterviewSession[];
};

/** 显式输入、稳定排序；重复来源不会变成额外测量，冲突来源不任选一个。 */
export function projectLegacyLearningEvents(facts: LegacyLearningEventFacts): LegacyEventAdapterResult {
  const sessions = new Map<string, InterviewSession[]>();
  for (const session of facts.interviewSessions ?? []) sessions.set(session.id, [...(sessions.get(session.id) ?? []), session]);
  const evaluationIdsBySession = new Map<string, Set<string>>();
  for (const evaluation of facts.interviewEvaluations ?? []) {
    const ids = evaluationIdsBySession.get(evaluation.sessionId) ?? new Set<string>();
    ids.add(evaluation.id);
    evaluationIdsBySession.set(evaluation.sessionId, ids);
  }
  const results = [
    ...(facts.reviewAttempts ?? []).map(adaptReviewAttempt),
    ...(facts.knowledgeAttempts ?? []).map(adaptKnowledgeAttempt),
    ...(facts.tutoringTurns ?? []).map(adaptTutoringMicroAssessment),
    ...(facts.interviewEvaluations ?? []).map((evaluation) => {
      const matches = sessions.get(evaluation.sessionId) ?? [];
      // writer 重评时删除旧评价；同 session 多个不同评价身份不属于可信 current projection。
      return matches.length > 1 || (evaluationIdsBySession.get(evaluation.sessionId)?.size ?? 0) > 1
        ? rejected("inconsistent_source", "interview_evaluation", evaluation.id)
        : adaptInterviewEvaluation(evaluation, matches[0]);
    }),
  ];
  const diagnostics = results.flatMap((result) => result.diagnostics);
  const bySource = new Map<string, LegacyEventAdapterResult[]>();
  for (const result of results) {
    const ref = result.events[0]?.source.records[0] ?? result.diagnostics[0]?.source;
    if (!ref) continue;
    const key = JSON.stringify([ref.recordType, ref.recordId]);
    bySource.set(key, [...(bySource.get(key) ?? []), result]);
  }
  const consistentEvents: LearningEventV1[] = [];
  for (const group of bySource.values()) {
    const result = group[0];
    // 同一 current record 的不同快照不能伪装成恢复出的多次历史提交。
    if (new Set(group.map((item) => JSON.stringify(item))).size > 1) {
      const ref = result.events[0]?.source.records[0] ?? result.diagnostics[0].source;
      diagnostics.push(diagnostic("inconsistent_source", ref.recordType, ref.recordId));
    } else consistentEvents.push(...result.events);
  }
  const byId = new Map<string, LearningEventV1[]>();
  for (const event of consistentEvents) byId.set(event.id, [...(byId.get(event.id) ?? []), event]);
  const events: LearningEventV1[] = [];
  for (const group of byId.values()) {
    const event = group[0];
    if (new Set(group.map((item) => JSON.stringify(item))).size > 1) {
      diagnostics.push(diagnostic("inconsistent_source", event.source.records[0].recordType, event.source.records[0].recordId));
    } else events.push(event);
  }
  return {
    events: events.toSorted(compareLearningEvents),
    diagnostics: [...new Map(diagnostics.map((item) => [JSON.stringify(item), item])).values()].toSorted((left, right) => (
      compareLearningEventText(left.source.recordType, right.source.recordType)
      || compareLearningEventText(left.source.recordId ?? "", right.source.recordId ?? "")
      || compareLearningEventText(left.code, right.code)
    )),
  };
}
