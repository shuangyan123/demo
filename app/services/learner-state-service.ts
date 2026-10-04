import { reviewDb } from "../db/review-db.ts";
import type { Attempt, Board, Mistake, ReviewResult } from "../types/domains/review.ts";
import type { InterviewEvaluation, InterviewPracticePlan, InterviewSession } from "../types/domains/interview.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../types/domains/knowledge.ts";
import type {
  LearnerEvidenceRef,
  LearnerStateSignal,
  LearnerStateSnapshot,
  LearningActionRecommendation,
} from "../types/domains/learner-state.ts";
import type { TutoringPlan, TutoringSession, TutoringTurn } from "../types/domains/tutoring.ts";
import { knowledgeRepository } from "./knowledge-repository.ts";
import { projectLegacyInterviewCompatibility, projectLegacyResultCompatibility, projectLegacyTutoringCompatibility,
  type CompletedTutoringCompatibility, type EvaluatedInterviewCompatibility, type LegacyResultCompatibility } from "./learning-kernel/compatibility-snapshot.ts";
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
const GENERIC_MISCONCEPTION_LABELS = new Set(["待归因", "其他", "其它", "未知", "不清楚", "未分类"]);

/** 持久化掌握度固定为 1..5；百分分数只用于只读排序，绝不写回领域记录。 */
export function masteryLevelToScore(value: number): number {
  const level = Math.max(1, Math.min(5, Number.isFinite(value) ? value : 1));
  return Math.round(((level - 1) / 4) * 100);
}

/** 把派生排序分限制在稳定区间，避免异常导入数据支配上下文排序。 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function dateKey(value: string | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return value.slice(0, 10);
}

function todayKey(today: Date): string {
  return today.toISOString().slice(0, 10);
}

function isDue(value: string | undefined, today: Date): boolean {
  const key = dateKey(value);
  return key !== null && key <= todayKey(today);
}

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

function knowledgeAttemptEvidence(attempt: ResultEvidence): LearnerEvidenceRef {
  return { type: "knowledge_attempt", id: attempt.id, label: `最近训练：${attempt.result}`, observedAt: attempt.observedAt };
}

/** 仅消费 Kernel 校验后的 legacy 自报兼容视图；不回退原始 Attempt.result。 */
function latestCompatibilityResults(
  results: LegacyResultCompatibility[],
  recordType: LegacyResultCompatibility["source"]["recordType"],
): Map<string, ResultEvidence> {
  const latest = new Map<string, ResultEvidence>();
  const sorted = results.filter((item) => item.source.recordType === recordType).toSorted((left, right) => (
    (right.observedAt ?? "").localeCompare(left.observedAt ?? "") || left.source.recordId.localeCompare(right.source.recordId)
  ));
  for (const item of sorted) {
    // 未知时间在旧 UI 引用中保持空值，不补造日期或访问原始记录。
    if (!latest.has(item.target.id)) latest.set(item.target.id, { id: item.source.recordId, result: item.reportedResult, observedAt: item.observedAt ?? "" });
  }
  return latest;
}

/** 按旧 1..5 heuristic 和最近自报复盘聚合兼容薄弱信号，不代表独立正确性。 */
function boardWeaknessSignals(mistakes: Mistake[], latestAttempts: Map<string, ResultEvidence>): LearnerStateSignal[] {
  const groups = new Map<Board, Mistake[]>();
  for (const mistake of mistakes) {
    const attempt = latestAttempts.get(mistake.id);
    if (mistake.mastery > 2 && attempt?.result !== "wrong" && attempt?.result !== "uncertain") continue;
    groups.set(mistake.board, [...(groups.get(mistake.board) ?? []), mistake]);
  }
  return [...groups.entries()].map(([board, items]) => {
    const sorted = items.toSorted((left, right) => left.mastery - right.mastery || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
    const averageMasteryScore = sorted.reduce((sum, item) => sum + masteryLevelToScore(item.mastery), 0) / sorted.length;
    const wrongCount = sorted.filter((item) => latestAttempts.get(item.id)?.result === "wrong").length;
    return {
      id: signalId("weakness", board),
      kind: "weakness",
      title: `${board}仍需巩固`,
      summary: `${sorted.length} 道题有低掌握度或最近未通过，派生掌握分 ${Math.round(averageMasteryScore)}/100${wrongCount ? `，其中 ${wrongCount} 道最近答错` : ""}。`,
      score: clampScore(90 - averageMasteryScore + Math.min(20, wrongCount * 4)),
      evidence: dedupeEvidence(sorted.slice(0, 3).flatMap((item) => [mistakeEvidence(item), ...(latestAttempts.get(item.id) ? [reviewAttemptEvidence(latestAttempts.get(item.id)!)] : [])])),
    } satisfies LearnerStateSignal;
  });
}

/** 只有当前仍薄弱、最近未通过或已经到期的错题，才构成可执行的未解决错因证据。 */
function isMistakeCurrentlyUnresolved(
  mistake: Mistake,
  latestAttempt: ResultEvidence | undefined,
  today: Date,
): boolean {
  return mistake.mastery <= 2
    || latestAttempt?.result === "wrong"
    || latestAttempt?.result === "uncertain"
    || isDue(mistake.nextReviewAt, today);
}

function misconceptionSignals(
  mistakes: Mistake[],
  latestAttempts: Map<string, ResultEvidence>,
  today: Date,
): LearnerStateSignal[] {
  const groups = new Map<string, { label: string; mistakes: Map<string, Mistake> }>();
  for (const mistake of mistakes) {
    if (!isMistakeCurrentlyUnresolved(mistake, latestAttempts.get(mistake.id), today)) continue;
    for (const reason of new Set(mistake.reasons)) {
      const label = reason.trim().slice(0, 80);
      const key = label.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
      if (!key || GENERIC_MISCONCEPTION_LABELS.has(label)) continue;
      const current = groups.get(key) ?? { label, mistakes: new Map<string, Mistake>() };
      current.mistakes.set(mistake.id, mistake);
      groups.set(key, current);
    }
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const items = [...group.mistakes.values()];
    if (items.length < 2) return [];
    return [{
      id: signalId("misconception", key),
      kind: "misconception" as const,
      title: `反复错因：${group.label}`,
      summary: `该错因已在 ${items.length} 道不同题目中出现，应先解释判断依据再继续训练。`,
      score: clampScore(56 + items.length * 7),
      evidence: items.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)).slice(0, 3).map(mistakeEvidence),
    }];
  });
}

function knowledgeSignals(entries: KnowledgeEntry[], latestAttempts: Map<string, ResultEvidence>): LearnerStateSignal[] {
  return entries
    .filter((entry) => entry.mastery <= 2 || ["wrong", "uncertain"].includes(latestAttempts.get(entry.id)?.result ?? ""))
    .toSorted((left, right) => left.mastery - right.mastery || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, 5)
    .map((entry) => {
      const attempt = latestAttempts.get(entry.id);
      const masteryScore = masteryLevelToScore(entry.mastery);
      return {
        id: signalId("weakness", `knowledge-${entry.id}`),
        kind: "weakness" as const,
        title: `知识点待巩固：${entry.title}`,
        summary: `${entry.category}知识掌握度 ${entry.mastery}/5（派生分 ${masteryScore}/100）${attempt ? `，最近训练结果为 ${attempt.result}` : ""}。`,
        score: clampScore(85 - masteryScore + (attempt?.result === "wrong" ? 12 : attempt?.result === "uncertain" ? 6 : 0)),
        evidence: dedupeEvidence([knowledgeEvidence(entry), ...(attempt ? [knowledgeAttemptEvidence(attempt)] : [])]),
      };
    });
}

/** weakness 保留旧模型评价展示契约；inconclusive rubric 不代表 canonical learner weakness。 */
function interviewSignals(evaluations: EvaluatedInterviewCompatibility[]): LearnerStateSignal[] {
  return evaluations.toSorted((left, right) => right.compatibilityUpdatedAt.localeCompare(left.compatibilityUpdatedAt)
    || left.evaluationId.localeCompare(right.evaluationId)).slice(0, 4).flatMap((evaluation) => evaluation.dimensions
    .filter((dimension) => dimension.maxScore > 0 && dimension.score / dimension.maxScore < 0.7)
    .slice(0, 2)
    .map((dimension) => ({
      id: signalId("weakness", `interview-${dimension.name}`),
      kind: "weakness" as const,
      title: `面试表达待提升：${dimension.name}`,
      summary: `${dimension.score}/${dimension.maxScore}。${dimension.compatibilityComment}`.slice(0, 180),
      score: clampScore(80 - (dimension.score / dimension.maxScore) * 50),
      evidence: [{ type: "interview" as const, id: evaluation.evaluationId, label: `${dimension.name} ${dimension.score}/${dimension.maxScore}`, observedAt: evaluation.compatibilityUpdatedAt }],
    })));
}

/** 仅消费完整 model-key 兼容测量，不把比较结果提升为独立掌握证据。 */
function latestCompletedTutoringTurns(assessments: CompletedTutoringCompatibility[]): Map<string, CompletedTutoringCompatibility> {
  const latest = new Map<string, CompletedTutoringCompatibility>();
  const completed = assessments.toSorted((left, right) => (
    right.completedAt.localeCompare(left.completedAt)
    || right.compatibilitySourceCreatedAt.localeCompare(left.compatibilitySourceCreatedAt)
    || left.sourceTurnId.localeCompare(right.sourceTurnId)
  ));
  for (const turn of completed) {
    if (!latest.has(turn.sessionId)) latest.set(turn.sessionId, turn);
  }
  return latest;
}

function failedCompletedAssessment(assessment: CompletedTutoringCompatibility | undefined): boolean {
  return Boolean(assessment && assessment.correctCount < assessment.questionCount);
}

function tutoringSignals(latestTurns: Map<string, CompletedTutoringCompatibility>): LearnerStateSignal[] {
  return [...latestTurns.values()].flatMap((assessment) => {
    const ratio = assessment.correctCount / assessment.questionCount;
    if (ratio >= 1) return [];
    return [{
      id: signalId("weakness", `tutoring-${assessment.sourceTurnId}`),
      kind: "weakness" as const,
      title: "辅导微测仍需复练",
      summary: `微测答对 ${assessment.correctCount}/${assessment.questionCount}，需要按间隔计划复练。`,
      score: 82,
      evidence: [{ type: "tutoring" as const, id: assessment.sourceTurnId, label: `微测 ${assessment.correctCount}/${assessment.questionCount}`, observedAt: assessment.completedAt }],
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

function dueKnowledgeAction(items: KnowledgeEntry[], latest: Map<string, ResultEvidence>): LearningActionRecommendation | null {
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

function failedTutoringAssessmentAction(assessment: CompletedTutoringCompatibility): LearningActionRecommendation {
  const planId = `auto:${assessment.sessionId}`;
  return {
    id: actionId("failed-tutoring-assessment", [planId]),
    semanticKey: `tutoring:auto:${assessment.sessionId}`,
    kind: "retry_tutoring",
    title: "重试未通过的辅导微测",
    summary: `最近微测答对 ${assessment.correctCount}/${assessment.questionCount}，需要换一种例子再练习。`,
    completionHint: "提交新的确定性微测后，系统按最新结果更新复练建议。",
    priority: 200,
    priorityReason: "已提交的辅导微测未全部通过。",
    evidence: [{ type: "tutoring", id: assessment.sourceTurnId, label: `微测 ${assessment.correctCount}/${assessment.questionCount}`, observedAt: assessment.completedAt }],
    destination: { module: "tutoring", targetIds: [planId] },
    state: "ready",
  };
}

/** 同一 auto plan/session 按 P1 > P2 > P4 只派生一个下一步。 */
function tutoringActions(plans: TutoringPlan[], latestTurns: Map<string, CompletedTutoringCompatibility>, today: Date): LearningActionRecommendation[] {
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
  for (const assessment of latestTurns.values()) {
    if (!failedCompletedAssessment(assessment)) continue;
    if (consumedSessionIds.has(assessment.sessionId)) continue;
    actions.push(failedTutoringAssessmentAction(assessment));
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
  const compatibilityResults = projectLegacyResultCompatibility({ reviewAttempts: facts.attempts, knowledgeAttempts: facts.knowledgeAttempts });
  const latestAttempts = latestCompatibilityResults(compatibilityResults, "review_attempt");
  const latestKnowledge = latestCompatibilityResults(compatibilityResults, "knowledge_attempt");
  const latestTutoringTurns = latestCompletedTutoringTurns(projectLegacyTutoringCompatibility({ tutoringTurns: facts.tutoringTurns }));
  const interviewCompatibility = projectLegacyInterviewCompatibility({ interviewEvaluations: facts.interviewEvaluations, interviewSessions: facts.interviewSessions });
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
  const misconception = misconceptionSignals(facts.mistakes, latestAttempts, today);
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
    ...boardWeaknessSignals(facts.mistakes, latestAttempts),
    ...misconception,
    ...knowledgeSignals(facts.knowledgeEntries, latestKnowledge),
    ...interviewSignals(interviewCompatibility),
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
  const sourceRecordCount = Object.values(facts).reduce((count, records) => count + records.length, 0);
  const evaluatedSessionIds = new Set(interviewCompatibility.map((evaluation) => evaluation.sessionId));
  // 未提交项只计工作流/数据可用性，不能提供 learner correctness 权限。
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

/** 读取既有 v16 表并构造只读学习者状态；不写回推荐、模型推测或掌握分。 */
export async function loadLearnerStateSnapshotFromNormalizedFacts(
  coreFacts: NormalizedLearnerStateCoreFacts,
  today = new Date(),
  scope: WorkspaceDataScope = PERSONAL_WORKSPACE_DATA_SCOPE,
): Promise<LearnerStateSnapshot> {
  const [interviewEvaluations, interviewPracticePlans, interviewSessions, tutoringSessions, tutoringTurns, tutoringPlans] = await Promise.all([
    reviewDb.interviewEvaluations.toArray(),
    reviewDb.interviewPracticePlans.toArray(),
    reviewDb.interviewSessions.toArray(),
    reviewDb.tutoringSessions.toArray(),
    reviewDb.tutoringTurns.toArray(),
    reviewDb.tutoringPlans.toArray(),
  ]);
  return deriveLearnerStateSnapshot({
    mistakes: filterWorkspaceRecords(coreFacts.mistakes, scope),
    attempts: filterWorkspaceRecords(coreFacts.attempts, scope),
    knowledgeEntries: filterWorkspaceRecords(coreFacts.knowledgeEntries, scope),
    knowledgeAttempts: filterWorkspaceRecords(coreFacts.knowledgeAttempts, scope),
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
