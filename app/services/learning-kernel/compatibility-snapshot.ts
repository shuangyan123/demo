import type { EvidenceRecordV1, LearningEventV1, LearningTargetV1 } from "../../types/domains/learning-kernel.ts";
import type { TutoringTurn } from "../../types/domains/tutoring.ts";
import type { InterviewEvaluation, InterviewSession } from "../../types/domains/interview.ts";
import { deriveEvidence } from "./derive-evidence.ts";
import { validateEvidenceEvent } from "./evidence-policy.ts";
import { compareLearningEventText, isLegacyRecordId, legacyLearningEventTime } from "./learning-event.ts";
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

type SuppliedKeyEvidence = EvidenceRecordV1 & {
  outcome: Extract<EvidenceRecordV1["outcome"], { kind: "supplied_key_comparison" }>;
};

export type CompletedTutoringCompatibility = {
  sourceTurnId: string;
  sessionId: string;
  completedAt: string;
  questionCount: number;
  correctCount: number;
  /** 仅保留旧 UI 的稳定排序，不参与 Evidence 权限或测量校验。 */
  compatibilitySourceCreatedAt: string;
  authority: {
    kind: "legacy_model_key_compatibility";
    evidenceClass: "scored_performance";
    limitations: ["model_authored_key", "no_independent_grader"];
  };
};

/** 给定模型 key 的确定性比较不等于独立正确性；completion 不能通过此门。 */
export function isTutoringSuppliedKeyEvidence(evidence: EvidenceRecordV1): evidence is SuppliedKeyEvidence {
  return evidence.claim === "correctness"
    && evidence.evidenceClass === "scored_performance"
    && evidence.outcome.kind === "supplied_key_comparison"
    && evidence.provenance.keySource === "model_authored"
    && evidence.provenance.scoringMethod === "option_key_comparison"
    && evidence.provenance.limitations.includes("model_authored_key")
    && evidence.provenance.limitations.includes("no_independent_grader");
}

function tutoringEvidenceMatchesEvent(item: EvidenceRecordV1, event: LearningEventV1<"assessment.submitted">): item is SuppliedKeyEvidence {
  const ref = item.sourceRecordRefs[0];
  const eventRef = event.source.records[0];
  return isTutoringSuppliedKeyEvidence(item) && item.schemaVersion === 1 && item.policyVersion === "evidence-policy/v1"
    && item.sourceEventIds.length === 1 && item.sourceEventIds[0] === event.id && item.measurementGroupId === event.id
    && item.sourceRecordRefs.length === 1 && ref.recordType === "tutoring_turn"
    && ref.recordId === eventRef.recordId && ref.revision === eventRef.revision
    && item.target.category === event.target.category && item.target.namespace === event.target.namespace && item.target.id === event.target.id
    && item.provenance.adapterId === event.source.adapterId
    && Object.entries(event.provenance).every(([key, value]) => item.provenance[key as keyof typeof event.provenance] === value)
    && item.outcome.matchesSuppliedKey === event.payload.matchesSuppliedKey
    && item.outcome.direction === (event.payload.matchesSuppliedKey ? "supports" : "refutes");
}

/** 白名单身份用于 Evidence 去重，不复制附加私有字段，对象属性顺序不影响比较。 */
function tutoringEvidenceIdentity(item: SuppliedKeyEvidence): string {
  const ref = item.sourceRecordRefs[0];
  return JSON.stringify([item.id, item.outcome.matchesSuppliedKey, item.assistance, item.strength,
    item.target.category, item.target.namespace, item.target.id, ref.recordType, ref.recordId, ref.revision,
    item.provenance.limitations.toSorted(compareLearningEventText)]);
}

/**
 * 汇总已经过 Kernel policy 校验的完整测量；显式 Event/Evidence 输入便于验证缺片与 lineage。
 * 来源这里只提供 identity 和非权限排序 metadata，绝不读取 raw assessment 分数或题目。
 */
export function projectCompletedTutoringCompatibility(
  events: readonly LearningEventV1[],
  evidence: readonly EvidenceRecordV1[],
  sources: readonly Pick<TutoringTurn, "id" | "sessionId" | "createdAt">[],
): CompletedTutoringCompatibility[] {
  const eventsByTurn = new Map<string, LearningEventV1<"assessment.submitted">[]>();
  for (const event of events) {
    if (event.kind !== "assessment.submitted") continue;
    for (const ref of event.source.records) {
      if (ref.recordType === "tutoring_turn") eventsByTurn.set(ref.recordId, [...(eventsByTurn.get(ref.recordId) ?? []), event]);
    }
  }
  const evidenceByEvent = new Map<string, EvidenceRecordV1[]>();
  for (const item of evidence) {
    if (item.claim !== "correctness") continue;
    for (const id of item.sourceEventIds) evidenceByEvent.set(id, [...(evidenceByEvent.get(id) ?? []), item]);
  }
  const sourcesById = new Map<string, typeof sources[number][]>();
  for (const source of sources) sourcesById.set(source.id, [...(sourcesById.get(source.id) ?? []), source]);

  return [...sourcesById].toSorted(([left], [right]) => compareLearningEventText(left, right)).flatMap(([id, sourceGroup]): CompletedTutoringCompatibility[] => {
    const source = sourceGroup[0];
    const group = eventsByTurn.get(id) ?? [];
    const first = group[0];
    if (!isLegacyRecordId(id) || !isLegacyRecordId(source.sessionId) || typeof source.createdAt !== "string"
      || sourceGroup.some((item) => item.sessionId !== source.sessionId || item.createdAt !== source.createdAt)
      || !first || validateEvidenceEvent(first)) return [];
    const { assessmentQuestionCount: questionCount, submittedCorrectCount: correctCount } = first.payload;
    // policy 已校验 revision 结构；整份测量也须一致，不能拼接不同 key/选择修订。
    const measurement = JSON.stringify(JSON.parse(first.source.records[0].revision!)[2]);
    const ordinals = new Map<number, LearningEventV1<"assessment.submitted">>();
    for (const event of group) {
      if (validateEvidenceEvent(event) || event.sessionId !== source.sessionId || event.occurredAt !== first.occurredAt
        || event.payload.assessmentQuestionCount !== questionCount || event.payload.submittedCorrectCount !== correctCount
        || JSON.stringify(JSON.parse(event.source.records[0].revision!)[2]) !== measurement) return [];
      const previous = ordinals.get(event.payload.questionOrdinal);
      if (previous && previous.id !== event.id) return [];
      ordinals.set(event.payload.questionOrdinal, event);
    }
    if (ordinals.size !== questionCount) return [];
    let matches = 0;
    for (let ordinal = 1; ordinal <= questionCount; ordinal++) {
      const event = ordinals.get(ordinal);
      if (!event) return [];
      const candidates = evidenceByEvent.get(event.id) ?? [];
      const measurements = candidates.filter((item): item is SuppliedKeyEvidence => tutoringEvidenceMatchesEvent(item, event));
      if (!measurements.length || measurements.length !== candidates.length) return [];
      if (new Set(measurements.map(tutoringEvidenceIdentity)).size !== 1) return [];
      matches += Number(measurements[0].outcome.matchesSuppliedKey);
    }
    if (matches !== correctCount) return [];
    // 完整校验之后才跨桥携带 createdAt；它只服务旧 completedAt/createdAt/id tie-break。
    return [{ sourceTurnId: id, sessionId: source.sessionId, completedAt: first.occurredAt!, questionCount, correctCount: matches,
      compatibilitySourceCreatedAt: source.createdAt,
      authority: { kind: "legacy_model_key_compatibility", evidenceClass: "scored_performance",
        limitations: ["model_authored_key", "no_independent_grader"] } }];
  });
}

/** Phase D completed-only 路径；无效或不完整测量省略，绝不回退 raw correctCount。 */
export function projectLegacyTutoringCompatibility(facts: Pick<LegacyLearningEventFacts, "tutoringTurns">): CompletedTutoringCompatibility[] {
  const { events } = projectLegacyLearningEvents({ tutoringTurns: facts.tutoringTurns });
  const { evidence } = deriveEvidence(events);
  const turnsById = new Map<string, TutoringTurn[]>();
  for (const turn of facts.tutoringTurns ?? []) turnsById.set(turn.id, [...(turnsById.get(turn.id) ?? []), turn]);
  // 无 assessment 的 adapter 投影没有 diagnostics；同 ID 的空投影也不能洗白完整提交。
  const conflictingIds = new Set([...turnsById].filter(([, turns]) => turns.length > 1
    && new Set(turns.map((turn) => JSON.stringify(projectLegacyLearningEvents({ tutoringTurns: [turn] }).events.map((event) => event.id)))).size > 1)
    .map(([id]) => id));
  return projectCompletedTutoringCompatibility(events, evidence,
    (facts.tutoringTurns ?? []).filter((turn) => !conflictingIds.has(turn.id)).map(({ id, sessionId, createdAt }) => ({ id, sessionId, createdAt })));
}

export type EvaluatedInterviewCompatibility = {
  evaluationId: string;
  sessionId: string;
  evaluatedAt: string;
  /** 仅供旧 UI 排序与 observedAt 展示，不参与模型评分权限。 */
  compatibilityUpdatedAt: string;
  dimensions: Array<{
    dimensionIndex: number;
    /** 测量标签，不是 canonical skill identity。 */
    name: string;
    score: number;
    maxScore: number;
    /** 唯一允许携带的旧展示文案；不是 Evidence 或学习结论。 */
    compatibilityComment: string;
  }>;
  authority: {
    kind: "legacy_model_assessment_compatibility";
    evidenceClass: "model_assessment";
    direction: "inconclusive";
    limitations: ["model_assessment_only", "no_independent_grader"];
  };
  workflow: { kind: "evaluated"; evidenceClass: "workflow_fact" };
};

type ModelRubricEvidence = EvidenceRecordV1 & {
  outcome: Extract<EvidenceRecordV1["outcome"], { kind: "model_rubric_score" }>;
};

/** 模型 rubric 永远只代表模型评价；高低分都不能授予独立学习事实权限。 */
export function isInterviewModelRubricEvidence(item: EvidenceRecordV1): item is ModelRubricEvidence {
  return item.claim === "performance" && item.evidenceClass === "model_assessment"
    && item.outcome.kind === "model_rubric_score" && item.outcome.direction === "inconclusive"
    && item.provenance.modality === "model_assessment" && item.provenance.modelAuthored === true
    && item.provenance.scoringMethod === "model_rubric" && item.provenance.keySource === "none"
    && item.provenance.limitations.includes("model_assessment_only")
    && item.provenance.limitations.includes("no_independent_grader");
}

/** 固定白名单与属性顺序用于校验/去重，不把附加正文或私有字段复制到输出。 */
function interviewEvidenceIdentity(item: EvidenceRecordV1): string {
  const outcome = item.outcome;
  const p = item.provenance;
  return JSON.stringify([item.schemaVersion, item.id, item.claim, item.evidenceClass,
    outcome.kind, outcome.direction, outcome.kind === "model_rubric_score"
      ? [outcome.scope, outcome.score, outcome.maxScore,
        outcome.scope === "dimension" ? [outcome.dimensionIndex, outcome.dimension] : null] : null,
    item.target.category, item.target.namespace, item.target.id, item.assistance, item.strength,
    item.sourceEventIds, item.sourceRecordRefs.map((ref) => [ref.recordType, ref.recordId, ref.revision]),
    item.measurementGroupId, item.policyVersion, p.adapterId, p.normalizationVersion, p.modality,
    p.modelAuthored, p.keySource, p.scoringMethod, p.timePrecision, p.history,
    p.limitations.toSorted(compareLearningEventText)]);
}

type InterviewCompatibilitySource = Pick<InterviewEvaluation, "id" | "sessionId" | "updatedAt" | "dimensions">;

/** 语义 Event 不含这些 metadata；同 ID 的展示冲突也必须拒绝，不能任选 input-order winner。 */
function interviewSourceIdentity(source: InterviewCompatibilitySource): string | null {
  if (!isLegacyRecordId(source.id) || !isLegacyRecordId(source.sessionId) || typeof source.updatedAt !== "string"
    || !Array.isArray(source.dimensions) || Array.from(source.dimensions).some((dimension) => (
      !dimension || typeof dimension.comment !== "string"
    ))) return null;
  return JSON.stringify([source.sessionId, source.updatedAt,
    source.dimensions.map(({ name, score, maxScore, comment }) => [name, score, maxScore, comment])]);
}

/**
 * 完整 model measurement + 独立 workflow pairing 才能进入旧展示。
 * 不暴露 workflow-only 结果；缺片时不制造维度信号，session.status 仍可独立用于工作流计数。
 */
export function projectEvaluatedInterviewCompatibility(
  events: readonly LearningEventV1[],
  evidence: readonly EvidenceRecordV1[],
  sources: readonly InterviewCompatibilitySource[],
  sessions: readonly Pick<InterviewSession, "id" | "questionId" | "status" | "type" | "completedAt">[],
): EvaluatedInterviewCompatibility[] {
  // 复用现有 policy 和 Event 冲突检测，不在桥中维护第二套评分/权限规则。
  const canonical = deriveEvidence(events);
  const rejectedEvents = new Set(canonical.diagnostics.map((item) => item.sourceEventId));
  const sourcesById = new Map<string, InterviewCompatibilitySource[]>();
  for (const source of sources) sourcesById.set(source.id, [...(sourcesById.get(source.id) ?? []), source]);
  const eventsByEvaluation = new Map<string, LearningEventV1[]>();
  for (const event of events) {
    if (event.kind !== "interview.completed" && event.kind !== "interview.evaluated") continue;
    if (validateEvidenceEvent(event)) continue;
    for (const ref of event.source.records) {
      if (ref.recordType === "interview_evaluation") {
        eventsByEvaluation.set(ref.recordId, [...(eventsByEvaluation.get(ref.recordId) ?? []), event]);
      }
    }
  }
  const evidenceByEvent = new Map<string, EvidenceRecordV1[]>();
  const evidenceById = new Map<string, Set<string>>();
  for (const item of evidence) {
    const identity = interviewEvidenceIdentity(item);
    const signatures = evidenceById.get(item.id) ?? new Set<string>();
    signatures.add(identity);
    evidenceById.set(item.id, signatures);
    for (const id of new Set([...item.sourceEventIds, item.measurementGroupId])) {
      evidenceByEvent.set(id, [...(evidenceByEvent.get(id) ?? []), item]);
    }
  }
  const canonicalByEvent = new Map<string, EvidenceRecordV1[]>();
  for (const item of canonical.evidence) {
    const id = item.measurementGroupId;
    canonicalByEvent.set(id, [...(canonicalByEvent.get(id) ?? []), item]);
  }
  function completeMeasurement(event: LearningEventV1): boolean {
    const expected = canonicalByEvent.get(event.id) ?? [];
    const actual = evidenceByEvent.get(event.id) ?? [];
    if (!expected.length || !actual.length || actual.some((item) => evidenceById.get(item.id)?.size !== 1)) return false;
    const signatures = new Set(actual.map(interviewEvidenceIdentity));
    return signatures.size === expected.length && expected.every((item) => signatures.has(interviewEvidenceIdentity(item)));
  }

  return [...sourcesById].toSorted(([left], [right]) => compareLearningEventText(left, right))
    .flatMap(([evaluationId, group]): EvaluatedInterviewCompatibility[] => {
      const source = group[0];
      const identity = interviewSourceIdentity(source);
      if (identity === null || group.some((item) => interviewSourceIdentity(item) !== identity)) return [];
      const eventGroup = eventsByEvaluation.get(evaluationId) ?? [];
      if (eventGroup.some((event) => rejectedEvents.has(event.id) || validateEvidenceEvent(event))) return [];
      const uniqueEvents = [...new Map(eventGroup.map((event) => [event.id, event])).values()];
      const evaluated = uniqueEvents.find((event) => event.kind === "interview.evaluated");
      const completed = uniqueEvents.find((event) => event.kind === "interview.completed");
      const matchingSessions = sessions.filter((session) => session.id === source.sessionId);
      const session = matchingSessions[0];
      if (uniqueEvents.length !== 2 || !evaluated || !completed || matchingSessions.length !== 1
        || session.status !== "evaluated" || session.type !== evaluated.payload.evaluationType
        || completed.occurredAt !== legacyLearningEventTime(session.completedAt).occurredAt
        || (completed.occurredAt !== null && Date.parse(completed.occurredAt) !== Date.parse(evaluated.occurredAt!))
        || [evaluated, completed].some((event) => event.sessionId !== source.sessionId
          || event.target.id !== session.questionId || event.source.records[0].recordId !== evaluationId)
        || !completeMeasurement(evaluated) || !completeMeasurement(completed)) return [];

      const slices = (evidenceByEvent.get(evaluated.id) ?? []).filter(isInterviewModelRubricEvidence);
      // canonical 比较已经要求 overall + 每个 0..N-1 slice；只从已校验 Evidence 读取分数。
      const dimensions = [...new Map(slices.filter((item) => item.outcome.scope === "dimension")
        .map((item) => [item.id, item])).values()].toSorted((left, right) => (
        (left.outcome.scope === "dimension" ? left.outcome.dimensionIndex : -1)
        - (right.outcome.scope === "dimension" ? right.outcome.dimensionIndex : -1)
      )).flatMap((item): EvaluatedInterviewCompatibility["dimensions"] => {
        if (item.outcome.scope !== "dimension") return [];
        const { dimensionIndex, dimension: name, score, maxScore } = item.outcome;
        const raw = source.dimensions[dimensionIndex];
        if (!raw || raw.name !== name || raw.score !== score || raw.maxScore !== maxScore) return [];
        // 匹配后才附加唯一允许的旧 UI comment；它不参与 Evidence 分数校验。
        return [{ dimensionIndex, name, score, maxScore, compatibilityComment: raw.comment }];
      });
      if (dimensions.length !== evaluated.payload.dimensions.length || source.dimensions.length !== dimensions.length) return [];
      return [{ evaluationId, sessionId: source.sessionId, evaluatedAt: evaluated.occurredAt!,
        compatibilityUpdatedAt: source.updatedAt, dimensions,
        authority: { kind: "legacy_model_assessment_compatibility", evidenceClass: "model_assessment",
          direction: "inconclusive", limitations: ["model_assessment_only", "no_independent_grader"] },
        workflow: { kind: "evaluated", evidenceClass: "workflow_fact" } }];
    });
}

export function projectLegacyInterviewCompatibility(
  facts: Pick<LegacyLearningEventFacts, "interviewEvaluations" | "interviewSessions">,
): EvaluatedInterviewCompatibility[] {
  const { events } = projectLegacyLearningEvents(facts);
  const { evidence } = deriveEvidence(events);
  return projectEvaluatedInterviewCompatibility(events, evidence, facts.interviewEvaluations ?? [], facts.interviewSessions ?? []);
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
