import { studyDay, isStudyDayDue } from "../lib/study-day.ts";
import { reviewDb } from "../db/review-db.ts";
import { deriveWeaknessIntelligence, masteryLevelToScore, type WeaknessIntelligence, type WeaknessSubjectAssessment } from "../lib/weakness-intelligence.ts";
import type { Attempt, Board, Mistake, ReviewResult } from "../types/domains/review.ts";
import type { InterviewEvaluation, InterviewPracticePlan, InterviewSession } from "../types/domains/interview.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../types/domains/knowledge.ts";
import { enrichCanonicalLearningEvent, learningEventCoreMatches, learningEventFromKnowledgeAttempt, learningEventFromReviewAttempt, type LearningEvent } from "../types/domains/learning-event.ts";
import type {
  LearnerEvidenceRef,
  LearnerStateSignal,
  LearnerStateSnapshot,
  LearningActionRecommendation,
} from "../types/domains/learner-state.ts";
import type { TutoringPlan, TutoringSession, TutoringTurn } from "../types/domains/tutoring.ts";
import { knowledgeRepository } from "./knowledge-repository.ts";
import { learningEventRepository } from "./learning-event-repository.ts";
import { reviewRepository } from "./review-repository.ts";
import { filterWorkspaceRecords, PERSONAL_WORKSPACE_DATA_SCOPE, type WorkspaceDataScope } from "./workspace-data-scope.ts";

type ResultEvidence = {
  id: string;
  result: ReviewResult;
  observedAt: string;
};

export type LearnerStateFacts = {
  mistakes: Mistake[];
  attempts: Attempt[];
  knowledgeEntries: KnowledgeEntry[];
  knowledgeAttempts: KnowledgeAttempt[];
  learningEvents: LearningEvent[];
  interviewEvaluations: InterviewEvaluation[];
  interviewPracticePlans: InterviewPracticePlan[];
  interviewSessions: InterviewSession[];
  tutoringSessions: TutoringSession[];
  tutoringTurns: TutoringTurn[];
  tutoringPlans: TutoringPlan[];
};

export type NormalizedLearnerStateCoreFacts = Pick<
  LearnerStateFacts,
  "mistakes" | "attempts" | "knowledgeEntries" | "knowledgeAttempts"
>;

const SIGNAL_LIMIT = 18;
const ACTION_LIMIT = 12;

export { masteryLevelToScore };

/** 把派生排序分限制在稳定区间，避免异常导入数据支配上下文排序。 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

const dateKey = studyDay;
const isDue = isStudyDayDue;

/** 使用稳定字段构造派生 ID，便于刷新重建、测试和 UI 对照。 */
function derivedId(prefix: string, key: string): string {
  return `${prefix}:${key.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "-").slice(0, 120)}`;
}

function signalId(kind: LearnerStateSignal["kind"], key: string): string {
  return derivedId(kind, key);
}

function actionId(rule: string, targetIds: string[]): string {
  const input = targetIds.toSorted().join("\u001f");
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return derivedId("learning-action", `${rule}-${(hash >>> 0).toString(36)}`);
}

function dedupeEvidence(evidence: LearnerEvidenceRef[]): LearnerEvidenceRef[] {
  const unique = new Map<string, LearnerEvidenceRef>();
  for (const item of evidence) unique.set(`${item.type}:${item.id}`, item);
  return [...unique.values()].toSorted((left, right) => (
    right.observedAt.localeCompare(left.observedAt)
    || left.type.localeCompare(right.type)
    || left.id.localeCompare(right.id)
  ));
}

function mistakeEvidence(item: Mistake): LearnerEvidenceRef {
  return { type: "mistake", id: item.id, label: `${item.board}错题`, observedAt: item.updatedAt };
}

function reviewAttemptEvidence(attempt: ResultEvidence): LearnerEvidenceRef {
  return { type: "review_attempt", id: attempt.id, label: `最近复盘：${attempt.result}`, observedAt: attempt.observedAt };
}

function knowledgeEvidence(item: KnowledgeEntry): LearnerEvidenceRef {
  return { type: "knowledge", id: item.id, label: `${item.category} · ${item.title.slice(0, 48)}`, observedAt: item.updatedAt };
}

function knowledgeAttemptEvidence(attempt: KnowledgeAttempt): LearnerEvidenceRef {
  return { type: "knowledge_attempt", id: attempt.id, label: `最近训练：${attempt.result}`, observedAt: attempt.reviewedAt };
}

function latestReviewAttempts(attempts: Attempt[]): Map<string, ResultEvidence> {
  const latest = new Map<string, ResultEvidence>();
  for (const attempt of attempts.toSorted((left, right) => right.reviewedAt.localeCompare(left.reviewedAt) || left.id.localeCompare(right.id))) {
    if (!latest.has(attempt.mistakeId)) latest.set(attempt.mistakeId, { id: attempt.id, result: attempt.result, observedAt: attempt.reviewedAt });
  }
  return latest;
}

function latestKnowledgeAttempts(attempts: KnowledgeAttempt[]): Map<string, KnowledgeAttempt> {
  const latest = new Map<string, KnowledgeAttempt>();
  for (const attempt of attempts.toSorted((left, right) => right.reviewedAt.localeCompare(left.reviewedAt) || left.id.localeCompare(right.id))) {
    if (!latest.has(attempt.knowledgeId)) latest.set(attempt.knowledgeId, attempt);
  }
  return latest;
}

function learningEventSourceKey(event: LearningEvent): string {
  return `${event.sourceType}:${event.sourceId}`;
}

function learningEventSignature(event: LearningEvent): string {
  return [
    event.id,
    event.sourceType,
    event.sourceId,
    event.subjectType,
    event.subjectId,
    event.outcome,
    event.observedAt,
    event.masteryAfter ?? "",
    event.durationSec ?? "",
    event.selfConfidence ?? "",
    event.hintCount ?? "",
    event.errorCause ?? "",
    event.attemptOrdinal ?? "",
    event.practiceKind ?? "",
  ].join("\u001f");
}

function compareLearningEvents(left: LearningEvent, right: LearningEvent): number {
  return right.observedAt.localeCompare(left.observedAt)
    || left.sourceType.localeCompare(right.sourceType)
    || left.sourceId.localeCompare(right.sourceId)
    || left.id.localeCompare(right.id)
    || learningEventSignature(left).localeCompare(learningEventSignature(right));
}

/** 来源记录建立核心事实；冲突或悬空投影只读忽略，不修改历史表。 */
export function effectiveLearningEvents(facts: Pick<LearnerStateFacts, "attempts" | "knowledgeAttempts" | "learningEvents">): LearningEvent[] {
  const supplied = new Map<string, LearningEvent[]>();
  for (const event of facts.learningEvents ?? []) {
    const key = learningEventSourceKey(event);
    supplied.set(key, [...(supplied.get(key) ?? []), event]);
  }
  return [
    ...facts.attempts.map(learningEventFromReviewAttempt),
    ...facts.knowledgeAttempts.map(learningEventFromKnowledgeAttempt),
  ].map((canonical) => {
    const matches = (supplied.get(learningEventSourceKey(canonical)) ?? [])
      .filter((event) => learningEventCoreMatches(event, canonical))
      .toSorted((left, right) => learningEventSignature(left).localeCompare(learningEventSignature(right)));
    return enrichCanonicalLearningEvent(canonical, matches[0]);
  }).toSorted(compareLearningEvents);
}

function assessmentKey(subjectType: "mistake" | "knowledge", subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function learningEventEvidence(event: LearningEvent): LearnerEvidenceRef {
  const label = event.sourceType === "review_attempt" ? `复盘记录：${event.outcome}` : `知识训练：${event.outcome}`;
  return { type: event.sourceType, id: event.sourceId, label, observedAt: event.observedAt };
}

/** 每个学习日取一条代表事件，保留 bounded history 的可审计性而不重复堆叠同日重试。 */
function assessmentEventEvidence(assessment: WeaknessSubjectAssessment): LearnerEvidenceRef[] {
  return assessment.studyDays.map((day) => {
    const representative = day.events.find((event) => event.outcome === day.outcome) ?? day.events[0];
    return learningEventEvidence(representative);
  });
}

function assessmentMap(intelligence: WeaknessIntelligence): Map<string, WeaknessSubjectAssessment> {
  return new Map(intelligence.subjects.map((assessment) => [assessmentKey(assessment.subjectType, assessment.subjectId), assessment]));
}

/** 按板块聚合当前 eligible 错题，并以 top 3 subject risk 形成单一薄弱信号。 */
function boardWeaknessSignals(mistakes: Mistake[], intelligence: WeaknessIntelligence): LearnerStateSignal[] {
  const assessments = assessmentMap(intelligence);
  const groups = new Map<Board, Array<{ mistake: Mistake; assessment: WeaknessSubjectAssessment }>>();
  for (const mistake of mistakes) {
    const assessment = assessments.get(assessmentKey("mistake", mistake.id));
    if (!assessment?.currentlyWeak) continue;
    groups.set(mistake.board, [...(groups.get(mistake.board) ?? []), { mistake, assessment }]);
  }
  return [...groups.entries()].map(([board, items]) => {
    const sorted = items.toSorted((left, right) => (
      right.assessment.riskScore - left.assessment.riskScore
        || right.mistake.updatedAt.localeCompare(left.mistake.updatedAt)
        || left.mistake.id.localeCompare(right.mistake.id)
    ));
    const topScores = sorted.slice(0, 3).map((item) => item.assessment.riskScore);
    const score = topScores.length ? Math.round(topScores.reduce((sum, value) => sum + value, 0) / topScores.length) : 0;
    const crossDayWrongCount = sorted.filter((item) => item.assessment.wrongDays >= 2).length;
    return {
      id: signalId("weakness", board),
      kind: "weakness" as const,
      title: `${board}仍需巩固`,
      summary: `${sorted.length} 道题仍处于薄弱状态${crossDayWrongCount ? `，其中 ${crossDayWrongCount} 道最近有跨日错误` : ""}。`,
      score: clampScore(score),
      evidence: dedupeEvidence(sorted.slice(0, 3).flatMap(({ mistake, assessment }) => [mistakeEvidence(mistake), ...assessmentEventEvidence(assessment)])),
    } satisfies LearnerStateSignal;
  }).toSorted((left, right) => left.id.localeCompare(right.id));
}

function misconceptionSignals(mistakes: Mistake[], intelligence: WeaknessIntelligence): LearnerStateSignal[] {
  const mistakesById = new Map(mistakes.map((mistake) => [mistake.id, mistake]));
  const repeatedReasonSignals = intelligence.repeatedReasonClusters.map((cluster) => {
    const evidence = cluster.subjects
      .map((subject) => mistakesById.get(subject.subjectId))
      .filter((mistake): mistake is Mistake => Boolean(mistake))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map(mistakeEvidence);
    return {
      id: signalId("misconception", cluster.key),
      kind: "misconception" as const,
      title: `反复错因：${cluster.label}`,
      summary: `该错因已在 ${cluster.subjects.length} 道不同题目中出现，应先解释判断依据再继续训练。`,
      score: clampScore(cluster.score),
      evidence: dedupeEvidence(evidence),
    } satisfies LearnerStateSignal;
  });
  const errorCauseSignals = intelligence.errorCauseClusters.map((cluster) => ({
    id: signalId("misconception", `error-cause-${cluster.cause}`),
    kind: "misconception" as const,
    title: `反复错误模式：${cluster.label}`,
    summary: `该错误模式出现在 ${cluster.subjects.length} 个不同学习对象的 ${cluster.recentFailureDays} 个学习日。`,
    score: clampScore(cluster.score),
    evidence: dedupeEvidence(cluster.evidenceEvents.map(learningEventEvidence)),
  } satisfies LearnerStateSignal));
  return [...repeatedReasonSignals, ...errorCauseSignals].toSorted((left, right) => left.id.localeCompare(right.id));
}

function knowledgeSignals(entries: KnowledgeEntry[], intelligence: WeaknessIntelligence): LearnerStateSignal[] {
  const assessments = assessmentMap(intelligence);
  return entries
    .map((entry) => ({ entry, assessment: assessments.get(assessmentKey("knowledge", entry.id)) }))
    .filter((item): item is { entry: KnowledgeEntry; assessment: WeaknessSubjectAssessment } => Boolean(item.assessment?.currentlyWeak))
    .toSorted((left, right) => (
      right.assessment.riskScore - left.assessment.riskScore
        || right.entry.updatedAt.localeCompare(left.entry.updatedAt)
        || left.entry.id.localeCompare(right.entry.id)
    ))
    .slice(0, 5)
    .map(({ entry, assessment }) => {
      const recentResults = [
        assessment.wrongDays ? `${assessment.wrongDays} 个答错日` : "",
        assessment.uncertainDays ? `${assessment.uncertainDays} 个不确定日` : "",
      ].filter(Boolean).join("、");
      const latest = assessment.latestOutcome ? `，最近结果为 ${assessment.latestOutcome}` : "";
      return {
        id: signalId("weakness", `knowledge-${entry.id}`),
        kind: "weakness" as const,
        title: `知识点待巩固：${entry.title}`,
        summary: `${entry.category}知识掌握度 ${entry.mastery}/5${recentResults ? `，近期有 ${recentResults}` : ""}${latest}。`,
        score: clampScore(assessment.riskScore),
        evidence: dedupeEvidence([knowledgeEvidence(entry), ...assessmentEventEvidence(assessment)]),
      };
    });
}

function interviewSignals(evaluations: InterviewEvaluation[]): LearnerStateSignal[] {
  return evaluations.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).slice(0, 4).flatMap((evaluation) => evaluation.dimensions
    .filter((dimension) => dimension.maxScore > 0 && dimension.score / dimension.maxScore < 0.7)
    .slice(0, 2)
    .map((dimension) => ({
      id: signalId("weakness", `interview-${dimension.name}`),
      kind: "weakness" as const,
      title: `面试表达待提升：${dimension.name}`,
      summary: `${dimension.score}/${dimension.maxScore}。${dimension.comment}`.slice(0, 180),
      score: clampScore(80 - (dimension.score / dimension.maxScore) * 50),
      evidence: [{ type: "interview" as const, id: evaluation.id, label: `${dimension.name} ${dimension.score}/${dimension.maxScore}`, observedAt: evaluation.updatedAt }],
    })));
}

/** 只有已提交的确定性微测才形成辅导学习信号；模型定位或置信度本身不是掌握证据。 */
function latestCompletedTutoringTurns(turns: TutoringTurn[]): Map<string, TutoringTurn> {
  const latest = new Map<string, TutoringTurn>();
  const completed = turns.filter((turn) => {
    const assessment = turn.microAssessment;
    return Boolean(assessment?.completedAt && assessment.questions.length && assessment.correctCount !== undefined);
  }).toSorted((left, right) => (
    right.microAssessment!.completedAt!.localeCompare(left.microAssessment!.completedAt!)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id)
  ));
  for (const turn of completed) {
    if (!latest.has(turn.sessionId)) latest.set(turn.sessionId, turn);
  }
  return latest;
}

function failedCompletedAssessment(turn: TutoringTurn | undefined): boolean {
  const assessment = turn?.microAssessment;
  return Boolean(assessment?.completedAt && assessment.questions.length && assessment.correctCount !== undefined
    && assessment.correctCount < assessment.questions.length);
}

function tutoringSignals(latestTurns: Map<string, TutoringTurn>): LearnerStateSignal[] {
  return [...latestTurns.values()].flatMap((turn) => {
    const assessment = turn.microAssessment;
    if (!assessment?.completedAt || !assessment.questions.length || assessment.correctCount === undefined) return [];
    const ratio = assessment.correctCount / assessment.questions.length;
    if (ratio >= 1) return [];
    return [{
      id: signalId("weakness", `tutoring-${turn.id}`),
      kind: "weakness" as const,
      title: "辅导微测仍需复练",
      summary: `微测答对 ${assessment.correctCount}/${assessment.questions.length}，需要按间隔计划复练。`,
      score: 82,
      evidence: [{ type: "tutoring" as const, id: turn.id, label: `微测 ${assessment.correctCount}/${assessment.questions.length}`, observedAt: assessment.completedAt }],
    }];
  }).slice(0, 5);
}

function goalAndActionSignals(plans: TutoringPlan[], sessions: TutoringSession[]): LearnerStateSignal[] {
  const signals: LearnerStateSignal[] = [];
  const activePlan = plans.filter((plan) => plan.status === "active" && dateKey(plan.nextPracticeAt) !== null).toSorted((left, right) => left.nextPracticeAt.localeCompare(right.nextPracticeAt) || left.id.localeCompare(right.id))[0];
  const activeSession = sessions.filter((session) => session.status === "active" || session.status === "paused").toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0];
  if (activePlan) {
    const evidence = [{ type: "tutoring_plan" as const, id: activePlan.id, label: activePlan.title, observedAt: activePlan.updatedAt }];
    signals.push({ id: signalId("goal", activePlan.id), kind: "goal", title: activePlan.title, summary: activePlan.objective, score: 88, evidence });
    signals.push({ id: signalId("next_action", activePlan.id), kind: "next_action", title: "下一次辅导任务", summary: `${activePlan.nextTask}（计划时间：${dateKey(activePlan.nextPracticeAt)}）`, score: 78, evidence });
  } else if (activeSession?.goal) {
    signals.push({
      id: signalId("goal", activeSession.id),
      kind: "goal",
      title: activeSession.topic,
      summary: activeSession.goal,
      score: 82,
      evidence: [{ type: "tutoring", id: activeSession.id, label: activeSession.topic, observedAt: activeSession.updatedAt }],
    });
  }
  return signals;
}

function dueMistakeAction(items: Mistake[], latest: Map<string, ResultEvidence>): LearningActionRecommendation | null {
  if (!items.length) return null;
  const sorted = items.toSorted((left, right) => {
    const resultRank = (item: Mistake) => latest.get(item.id)?.result === "wrong" ? 0 : latest.get(item.id)?.result === "uncertain" ? 1 : 2;
    return resultRank(left) - resultRank(right) || left.mastery - right.mastery || left.nextReviewAt.localeCompare(right.nextReviewAt) || left.id.localeCompare(right.id);
  });
  const targetIds = sorted.map((item) => item.id);
  const wrongCount = sorted.filter((item) => latest.get(item.id)?.result === "wrong").length;
  const uncertainCount = sorted.filter((item) => latest.get(item.id)?.result === "uncertain").length;
  return {
    id: actionId("due-mistakes", targetIds),
    semanticKey: "review:due",
    kind: "review_mistakes",
    title: `复盘 ${items.length} 道到期错题`,
    summary: `${wrongCount ? `${wrongCount} 道最近答错，` : ""}${uncertainCount ? `${uncertainCount} 道最近不确定，` : ""}最早复盘日期已到。`,
    completionHint: "提交复盘结果后，系统按新的复盘日期重新计算剩余到期错题。",
    priority: 100 - Math.min(20, wrongCount * 4 + uncertainCount * 2),
    priorityReason: "到期错题复盘；最近答错或不确定会在同级中提前。",
    evidence: dedupeEvidence(sorted.flatMap((item) => [mistakeEvidence(item), ...(latest.get(item.id) ? [reviewAttemptEvidence(latest.get(item.id)!)] : [])])).slice(0, 12),
    destination: { module: "review", targetIds },
    state: "ready",
  };
}

function dueKnowledgeAction(items: KnowledgeEntry[], latest: Map<string, KnowledgeAttempt>): LearningActionRecommendation | null {
  if (!items.length) return null;
  const sorted = items.toSorted((left, right) => {
    const resultRank = (item: KnowledgeEntry) => latest.get(item.id)?.result === "wrong" ? 0 : latest.get(item.id)?.result === "uncertain" ? 1 : 2;
    return resultRank(left) - resultRank(right) || left.mastery - right.mastery || left.nextReviewAt.localeCompare(right.nextReviewAt) || left.id.localeCompare(right.id);
  });
  const targetIds = sorted.map((item) => item.id);
  const wrongCount = sorted.filter((item) => latest.get(item.id)?.result === "wrong").length;
  return {
    id: actionId("due-knowledge", targetIds),
    semanticKey: "knowledge:due",
    kind: "review_knowledge",
    title: `训练 ${items.length} 个到期知识点`,
    summary: `${wrongCount ? `${wrongCount} 个最近训练未通过，` : ""}最早训练日期已到。`,
    completionHint: "提交训练结果后，系统按新的训练日期重新计算剩余到期知识点。",
    priority: 110 - Math.min(16, wrongCount * 4),
    priorityReason: "到期知识训练；最近错误会在同级中提前。",
    evidence: dedupeEvidence(sorted.flatMap((item) => [knowledgeEvidence(item), ...(latest.get(item.id) ? [knowledgeAttemptEvidence(latest.get(item.id)!)] : [])])).slice(0, 12),
    destination: { module: "knowledgeTraining", targetIds },
    state: "ready",
  };
}

function failedTutoringAssessmentAction(turn: TutoringTurn): LearningActionRecommendation {
  const assessment = turn.microAssessment!;
  const planId = `auto:${turn.sessionId}`;
  return {
    id: actionId("failed-tutoring-assessment", [planId]),
    semanticKey: `tutoring:auto:${turn.sessionId}`,
    kind: "retry_tutoring",
    title: "重试未通过的辅导微测",
    summary: `最近微测答对 ${assessment.correctCount}/${assessment.questions.length}，需要换一种例子再练习。`,
    completionHint: "提交新的确定性微测后，系统按最新结果更新复练建议。",
    priority: 200,
    priorityReason: "已提交的辅导微测未全部通过。",
    evidence: [{ type: "tutoring", id: turn.id, label: `微测 ${assessment.correctCount}/${assessment.questions.length}`, observedAt: assessment.completedAt! }],
    destination: { module: "tutoring", targetIds: [planId] },
    state: "ready",
  };
}

/** 同一 auto plan/session 按 P1 > P2 > P4 只派生一个下一步。 */
function tutoringActions(plans: TutoringPlan[], latestTurns: Map<string, TutoringTurn>, today: Date): LearningActionRecommendation[] {
  const consumedSessionIds = new Set<string>();
  const actions: LearningActionRecommendation[] = plans
    .filter((plan) => plan.status === "active" && dateKey(plan.nextPracticeAt) !== null)
    .map((plan) => {
      const sessionId = plan.id.startsWith("auto:") ? plan.id.slice("auto:".length) : null;
      const latestTurn = sessionId ? latestTurns.get(sessionId) : undefined;
      if (sessionId) consumedSessionIds.add(sessionId);
      if (!isDue(plan.nextPracticeAt, today) && failedCompletedAssessment(latestTurn)) {
        return failedTutoringAssessmentAction(latestTurn!);
      }
      return {
        id: actionId(isDue(plan.nextPracticeAt, today) ? "due-tutoring" : "active-tutoring", [plan.id]),
        semanticKey: plan.id.startsWith("auto:") ? `tutoring:${plan.id}` : `tutoring-plan:${plan.id}`,
        kind: "retry_tutoring" as const,
        title: isDue(plan.nextPracticeAt, today) ? "完成到期辅导复练" : "继续辅导计划",
        summary: `${plan.nextTask}（${isDue(plan.nextPracticeAt, today) ? "已到期" : `计划 ${dateKey(plan.nextPracticeAt)}`}）`,
        completionHint: "提交新的确定性微测后，系统按结果更新下一次复练。",
        priority: isDue(plan.nextPracticeAt, today) ? 120 : 400,
        priorityReason: isDue(plan.nextPracticeAt, today) ? "明确的辅导计划已经到期。" : "已确认的辅导计划仍在进行中。",
        evidence: [{ type: "tutoring_plan" as const, id: plan.id, label: plan.title, observedAt: plan.updatedAt }],
        destination: { module: "tutoring" as const, targetIds: [plan.id] },
        state: "ready" as const,
      };
    });
  for (const turn of latestTurns.values()) {
    const assessment = turn.microAssessment;
    if (!assessment?.completedAt || !assessment.questions.length || assessment.correctCount === undefined || assessment.correctCount === assessment.questions.length) continue;
    if (consumedSessionIds.has(turn.sessionId)) continue;
    actions.push(failedTutoringAssessmentAction(turn));
  }
  return actions;
}

function interviewActions(plans: InterviewPracticePlan[], today: Date): LearningActionRecommendation[] {
  return plans.filter((plan) => plan.status === "active" && dateKey(plan.nextPracticeAt) !== null).map((plan) => ({
    id: actionId(isDue(plan.nextPracticeAt, today) ? "due-interview" : "active-interview", [plan.id]),
    semanticKey: `interview-plan:${plan.id}`,
    kind: "practice_interview" as const,
    title: isDue(plan.nextPracticeAt, today) ? "完成到期面试训练" : "继续面试训练计划",
    summary: `${plan.title} · 已完成 ${plan.completedSessionCount}/${plan.targetSessionCount}${isDue(plan.nextPracticeAt, today) ? "，计划日期已到" : `，下次 ${dateKey(plan.nextPracticeAt)}`}。`,
    completionHint: "完成本场并保存评分后才推进训练计划；中止或未评分不会计数。",
    priority: isDue(plan.nextPracticeAt, today) ? 130 : 410,
    priorityReason: isDue(plan.nextPracticeAt, today) ? "明确的面试训练计划已经到期。" : "已确认的面试训练计划仍在进行中。",
    evidence: [{ type: "interview_plan" as const, id: plan.id, label: plan.title, observedAt: plan.updatedAt }],
    destination: { module: "interview" as const, targetIds: [plan.id] },
    state: "ready" as const,
  }));
}

function misconceptionActions(signals: LearnerStateSignal[]): LearningActionRecommendation[] {
  return signals.filter((signal) => signal.kind === "misconception" && signal.evidence.every((item) => item.type === "mistake")).map((signal) => {
    const targetIds = signal.evidence.map((item) => item.id).toSorted();
    return {
      id: actionId("repeated-misconception", targetIds),
      semanticKey: signal.id,
      kind: "review_mistakes" as const,
      title: signal.title,
      summary: signal.summary,
      completionHint: "当同类错因少于两道题仍处于未解决状态时，此建议会消失。",
      priority: 300,
      priorityReason: "至少两道独立错题呈现同一明确错因。",
      evidence: signal.evidence,
      destination: { module: "library" as const, targetIds },
      state: "ready" as const,
    };
  });
}

/** 从显式本地事实纯派生学习状态与行动队列；相同 facts + today 必须产生相同 ID 和顺序。 */
export function deriveLearnerStateSnapshot(facts: LearnerStateFacts, today = new Date()): LearnerStateSnapshot {
  const latestAttempts = latestReviewAttempts(facts.attempts);
  const latestKnowledge = latestKnowledgeAttempts(facts.knowledgeAttempts);
  const latestTutoringTurns = latestCompletedTutoringTurns(facts.tutoringTurns);
  const intelligence = deriveWeaknessIntelligence({
    subjects: [
      ...facts.mistakes.map((mistake) => ({
        subjectType: "mistake" as const,
        subjectId: mistake.id,
        mastery: mistake.mastery,
        nextReviewAt: mistake.nextReviewAt,
        updatedAt: mistake.updatedAt,
        reasons: mistake.reasons,
      })),
      ...facts.knowledgeEntries.map((entry) => ({
        subjectType: "knowledge" as const,
        subjectId: entry.id,
        mastery: entry.mastery,
        nextReviewAt: entry.nextReviewAt,
        updatedAt: entry.updatedAt,
      })),
    ],
    learningEvents: effectiveLearningEvents(facts),
    today,
  });
  const dueMistakes = facts.mistakes.filter((item) => isDue(item.nextReviewAt, today));
  const dueKnowledge = facts.knowledgeEntries.filter((item) => isDue(item.nextReviewAt, today));
  const dueTutoringPlans = facts.tutoringPlans.filter((item) => item.status === "active" && isDue(item.nextPracticeAt, today));
  const dueInterviewPlans = facts.interviewPracticePlans.filter((item) => item.status === "active" && isDue(item.nextPracticeAt, today));
  const dueEvidence = dedupeEvidence([
    ...dueMistakes.slice(0, 2).map(mistakeEvidence),
    ...dueKnowledge.slice(0, 2).map(knowledgeEvidence),
    ...dueTutoringPlans.slice(0, 2).map((plan) => ({ type: "tutoring_plan" as const, id: plan.id, label: plan.title, observedAt: plan.updatedAt })),
    ...dueInterviewPlans.slice(0, 2).map((plan) => ({ type: "interview_plan" as const, id: plan.id, label: plan.title, observedAt: plan.updatedAt })),
  ]);
  const misconception = misconceptionSignals(facts.mistakes, intelligence);
  const signals = [
    ...goalAndActionSignals(facts.tutoringPlans, facts.tutoringSessions),
    ...(dueEvidence.length ? [{
      id: signalId("due_review", "current"),
      kind: "due_review" as const,
      title: "存在到期学习任务",
      summary: `当前有 ${dueMistakes.length} 道错题、${dueKnowledge.length} 个知识点、${dueTutoringPlans.length} 个辅导任务和 ${dueInterviewPlans.length} 个面试计划到期。`,
      score: 92,
      evidence: dueEvidence,
    }] : []),
    ...boardWeaknessSignals(facts.mistakes, intelligence),
    ...misconception,
    ...knowledgeSignals(facts.knowledgeEntries, intelligence),
    ...interviewSignals(facts.interviewEvaluations),
    ...tutoringSignals(latestTutoringTurns),
  ].toSorted((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, SIGNAL_LIMIT);
  const recommendations = [
    dueMistakeAction(dueMistakes, latestAttempts),
    dueKnowledgeAction(dueKnowledge, latestKnowledge),
    ...tutoringActions(facts.tutoringPlans, latestTutoringTurns, today),
    ...interviewActions(facts.interviewPracticePlans, today),
    ...misconceptionActions(misconception),
  ].filter((item): item is LearningActionRecommendation => Boolean(item))
    .map((item) => ({ ...item, evidence: dedupeEvidence(item.evidence) }))
    .filter((item) => item.evidence.length > 0)
    .toSorted((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .slice(0, ACTION_LIMIT);
  const evidenceCount = new Set(signals.flatMap((signal) => signal.evidence.map((item) => `${item.type}:${item.id}`))).size;
  const sourceRecordCount = [
    facts.mistakes,
    facts.attempts,
    facts.knowledgeEntries,
    facts.knowledgeAttempts,
    facts.interviewEvaluations,
    facts.interviewPracticePlans,
    facts.interviewSessions,
    facts.tutoringSessions,
    facts.tutoringTurns,
    facts.tutoringPlans,
  ].reduce((count, records) => count + records.length, 0);
  const evaluatedSessionIds = new Set(facts.interviewEvaluations.map((evaluation) => evaluation.sessionId));
  const insufficientEvidenceCount = facts.tutoringTurns.filter((turn) => turn.microAssessment?.questions.length && !turn.microAssessment.completedAt).length
    + facts.interviewSessions.filter((session) => session.status !== "evaluated" && session.status !== "cancelled" && !evaluatedSessionIds.has(session.id)).length;
  return {
    generatedAt: today.toISOString(),
    currentGoal: signals.find((signal) => signal.kind === "goal")?.summary,
    dueReviewCount: dueMistakes.length + dueKnowledge.length + dueTutoringPlans.length + dueInterviewPlans.length,
    evidenceCount,
    insufficientEvidenceCount,
    sourceRecordCount,
    signals,
    recommendations,
  };
}

/** 读取既有学习表并构造只读学习者状态；不写回推荐、模型推测或掌握分。 */
export async function loadLearnerStateSnapshotFromNormalizedFacts(
  coreFacts: NormalizedLearnerStateCoreFacts,
  today = new Date(),
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): Promise<LearnerStateSnapshot> {
  const scopedMistakes = filterWorkspaceRecords(coreFacts.mistakes, scope);
  const scopedAttempts = filterWorkspaceRecords(coreFacts.attempts, scope);
  const scopedKnowledgeEntries = filterWorkspaceRecords(coreFacts.knowledgeEntries, scope);
  const scopedKnowledgeAttempts = filterWorkspaceRecords(coreFacts.knowledgeAttempts, scope);
  const subjects = [
    ...scopedMistakes.map((mistake) => ({ subjectType: "mistake" as const, subjectId: mistake.id })),
    ...scopedKnowledgeEntries.map((entry) => ({ subjectType: "knowledge" as const, subjectId: entry.id })),
  ];
  const [
    [interviewEvaluations, interviewPracticePlans, interviewSessions, tutoringSessions, tutoringTurns, tutoringPlans],
    learningEventLists,
  ] = await Promise.all([
    Promise.all([
      reviewDb.interviewEvaluations.toArray(),
      reviewDb.interviewPracticePlans.toArray(),
      reviewDb.interviewSessions.toArray(),
      reviewDb.tutoringSessions.toArray(),
      reviewDb.tutoringTurns.toArray(),
      reviewDb.tutoringPlans.toArray(),
    ]),
    Promise.all(subjects.map((subject) => learningEventRepository.listForSubject(subject.subjectType, subject.subjectId))),
  ]);
  return deriveLearnerStateSnapshot({
    mistakes: scopedMistakes,
    attempts: scopedAttempts,
    knowledgeEntries: scopedKnowledgeEntries,
    knowledgeAttempts: scopedKnowledgeAttempts,
    learningEvents: learningEventLists.flat(),
    interviewEvaluations: filterWorkspaceRecords(interviewEvaluations, scope),
    interviewPracticePlans: filterWorkspaceRecords(interviewPracticePlans, scope),
    interviewSessions: filterWorkspaceRecords(interviewSessions, scope),
    tutoringSessions: filterWorkspaceRecords(tutoringSessions, scope),
    tutoringTurns: filterWorkspaceRecords(tutoringTurns, scope),
    tutoringPlans: filterWorkspaceRecords(tutoringPlans, scope),
  }, today);
}

/** 公共加载路径必须先经过既有 Repository normalization owner，再派生只读 Learner State。 */
export async function loadLearnerStateSnapshot(today = new Date(), scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE): Promise<LearnerStateSnapshot> {
  const [reviewSnapshot, knowledgeSnapshot] = await Promise.all([
    reviewRepository.loadSnapshot(today),
    knowledgeRepository.loadTrainingSnapshot(today),
  ]);
  return loadLearnerStateSnapshotFromNormalizedFacts({
    mistakes: reviewSnapshot.mistakes,
    attempts: reviewSnapshot.attempts,
    knowledgeEntries: knowledgeSnapshot.entries,
    knowledgeAttempts: knowledgeSnapshot.attempts,
  }, today, scope);
}
