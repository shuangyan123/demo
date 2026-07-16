import { reviewDb } from "../db/review-db.ts";
import type {
  Board,
  InterviewEvaluation,
  KnowledgeAttempt,
  KnowledgeEntry,
  LearnerEvidenceRef,
  LearnerStateSignal,
  LearnerStateSnapshot,
  Mistake,
  ReviewResult,
  TutoringPlan,
  TutoringSession,
  TutoringTurn,
} from "../types/review.ts";

type ResultEvidence = {
  id: string;
  result: ReviewResult;
  observedAt: string;
};

const SIGNAL_LIMIT = 18;

/** 把分数限制在稳定区间，避免异常导入数据支配上下文排序。 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

/** 使用稳定字段构造信号 ID，便于测试和 UI 对照。 */
function signalId(kind: LearnerStateSignal["kind"], key: string): string {
  return `${kind}:${key.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "-").slice(0, 80)}`;
}

function mistakeEvidence(item: Mistake): LearnerEvidenceRef {
  return { type: "mistake", id: item.id, label: `${item.board} · ${item.stem.slice(0, 48)}`, observedAt: item.updatedAt };
}

function knowledgeEvidence(item: KnowledgeEntry): LearnerEvidenceRef {
  return { type: "knowledge", id: item.id, label: `${item.category} · ${item.title}`, observedAt: item.updatedAt };
}

/** 按板块聚合低掌握度错题和最近错误复盘，形成可核验薄弱信号。 */
function boardWeaknessSignals(
  mistakes: Mistake[],
  latestAttempts: Map<string, ResultEvidence>,
): LearnerStateSignal[] {
  const groups = new Map<Board, Mistake[]>();
  for (const mistake of mistakes) {
    const attempt = latestAttempts.get(mistake.id);
    if (mistake.mastery >= 60 && attempt?.result !== "wrong" && attempt?.result !== "uncertain") continue;
    groups.set(mistake.board, [...(groups.get(mistake.board) ?? []), mistake]);
  }
  return [...groups.entries()].map(([board, items]) => {
    const sorted = items.toSorted((left, right) => left.mastery - right.mastery || right.updatedAt.localeCompare(left.updatedAt));
    const averageMastery = sorted.reduce((sum, item) => sum + clampScore(item.mastery), 0) / sorted.length;
    const wrongCount = sorted.filter((item) => latestAttempts.get(item.id)?.result === "wrong").length;
    return {
      id: signalId("weakness", board),
      kind: "weakness",
      title: `${board}仍是主要薄弱板块`,
      summary: `${sorted.length} 道题需要巩固，平均掌握度 ${Math.round(averageMastery)}${wrongCount ? `，其中 ${wrongCount} 道最近仍答错` : ""}。`,
      score: clampScore(90 - averageMastery + Math.min(20, wrongCount * 4)),
      evidence: sorted.slice(0, 3).map(mistakeEvidence),
    } satisfies LearnerStateSignal;
  });
}

/** 聚合同名错因；只有至少两条独立错题证据时才形成长期误区。 */
function misconceptionSignals(mistakes: Mistake[]): LearnerStateSignal[] {
  const groups = new Map<string, { label: string; mistakes: Mistake[] }>();
  for (const mistake of mistakes) {
    for (const reason of mistake.reasons) {
      const label = reason.trim().slice(0, 80);
      const key = label.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
      if (!key) continue;
      const current = groups.get(key) ?? { label, mistakes: [] };
      current.mistakes.push(mistake);
      groups.set(key, current);
    }
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const unique = new Map(group.mistakes.map((item) => [item.id, item]));
    const items = [...unique.values()];
    if (items.length < 2) return [];
    return [{
      id: signalId("misconception", key),
      kind: "misconception" as const,
      title: `反复错因：${group.label}`,
      summary: `该错因已在 ${items.length} 道不同题目中出现，应先让学生解释判断依据，再进入下一题。`,
      score: clampScore(56 + items.length * 7),
      evidence: items.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 3).map(mistakeEvidence),
    }];
  });
}

function knowledgeSignals(entries: KnowledgeEntry[], latestAttempts: Map<string, KnowledgeAttempt>): LearnerStateSignal[] {
  return entries
    .filter((entry) => entry.mastery < 60 || ["wrong", "uncertain"].includes(latestAttempts.get(entry.id)?.result ?? ""))
    .toSorted((left, right) => left.mastery - right.mastery || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5)
    .map((entry) => {
      const attempt = latestAttempts.get(entry.id);
      return {
        id: signalId("weakness", `knowledge-${entry.id}`),
        kind: "weakness" as const,
        title: `知识点待巩固：${entry.title}`,
        summary: `${entry.category}知识掌握度 ${Math.round(clampScore(entry.mastery))}${attempt ? `，最近复习结果为 ${attempt.result}` : ""}，应结合例题或反例重新检验。`,
        score: clampScore(85 - entry.mastery + (attempt?.result === "wrong" ? 12 : 0)),
        evidence: [
          knowledgeEvidence(entry),
          ...(attempt ? [{ type: "knowledge_attempt" as const, id: attempt.id, label: `复习结果 ${attempt.result}`, observedAt: attempt.reviewedAt }] : []),
        ],
      };
    });
}

function interviewSignals(evaluations: InterviewEvaluation[]): LearnerStateSignal[] {
  const latest = evaluations.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 4);
  return latest.flatMap((evaluation) => evaluation.dimensions
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

function tutoringSignals(turns: TutoringTurn[]): LearnerStateSignal[] {
  const seen = new Set<string>();
  return turns.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)).flatMap((turn) => {
    const problem = turn.detectedProblem?.trim();
    if (!problem) return [];
    const key = problem.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 100);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    const assessment = turn.microAssessment;
    const ratio = assessment?.completedAt && assessment.questions.length
      ? (assessment.correctCount ?? 0) / assessment.questions.length
      : undefined;
    return [{
      id: signalId("misconception", `tutoring-${key}`),
      kind: "misconception" as const,
      title: `辅导中已定位：${problem}`.slice(0, 100),
      summary: ratio === undefined
        ? "该问题已讲解但尚无微测证据，不能视为已经掌握。"
        : ratio < 1
          ? `微测正确率 ${Math.round(ratio * 100)}%，仍需换一种例子复练。`
          : "微测已全部答对，可在间隔复习中再次确认。",
      score: ratio === undefined ? 66 : ratio < 1 ? 82 : 42,
      evidence: [{ type: "tutoring" as const, id: turn.id, label: problem.slice(0, 64), observedAt: turn.createdAt }],
    }];
  }).slice(0, 5);
}

function goalAndActionSignals(plans: TutoringPlan[], sessions: TutoringSession[]): LearnerStateSignal[] {
  const signals: LearnerStateSignal[] = [];
  const activePlan = plans
    .filter((plan) => plan.status === "active")
    .toSorted((left, right) => left.nextPracticeAt.localeCompare(right.nextPracticeAt))[0];
  const activeSession = sessions
    .filter((session) => session.status === "active" || session.status === "paused")
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (activePlan) {
    signals.push({
      id: signalId("goal", activePlan.id),
      kind: "goal",
      title: activePlan.title,
      summary: activePlan.objective,
      score: 88,
      evidence: [{ type: "tutoring_plan", id: activePlan.id, label: activePlan.title, observedAt: activePlan.updatedAt }],
    });
    signals.push({
      id: signalId("next_action", activePlan.id),
      kind: "next_action",
      title: "下一次辅导任务",
      summary: `${activePlan.nextTask}（计划时间：${activePlan.nextPracticeAt.slice(0, 10)}）`,
      score: 78,
      evidence: [{ type: "tutoring_plan", id: activePlan.id, label: activePlan.nextTask, observedAt: activePlan.updatedAt }],
    });
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

/** 读取既有表并构造学习者状态；不创建新表，也不写回任何模型推测。 */
export async function loadLearnerStateSnapshot(today = new Date()): Promise<LearnerStateSnapshot> {
  const [mistakes, attempts, knowledgeEntries, knowledgeAttempts, interviewEvaluations, tutoringSessions, tutoringTurns, tutoringPlans] = await Promise.all([
    reviewDb.mistakes.toArray(),
    reviewDb.attempts.toArray(),
    reviewDb.knowledgeEntries.toArray(),
    reviewDb.knowledgeAttempts.toArray(),
    reviewDb.interviewEvaluations.toArray(),
    reviewDb.tutoringSessions.toArray(),
    reviewDb.tutoringTurns.toArray(),
    reviewDb.tutoringPlans.toArray(),
  ]);
  const latestAttempts = new Map<string, ResultEvidence>();
  for (const attempt of attempts.toSorted((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))) {
    if (!latestAttempts.has(attempt.mistakeId)) latestAttempts.set(attempt.mistakeId, { id: attempt.id, result: attempt.result, observedAt: attempt.reviewedAt });
  }
  const latestKnowledgeAttempts = new Map<string, KnowledgeAttempt>();
  for (const attempt of knowledgeAttempts.toSorted((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))) {
    if (!latestKnowledgeAttempts.has(attempt.knowledgeId)) latestKnowledgeAttempts.set(attempt.knowledgeId, attempt);
  }
  const now = today.getTime();
  const dueMistakes = mistakes.filter((item) => Date.parse(item.nextReviewAt) <= now);
  const dueKnowledge = knowledgeEntries.filter((item) => Date.parse(item.nextReviewAt) <= now);
  const duePlans = tutoringPlans.filter((item) => item.status === "active" && Date.parse(item.nextPracticeAt) <= now);
  const dueEvidence: LearnerEvidenceRef[] = [
    ...dueMistakes.slice(0, 2).map(mistakeEvidence),
    ...dueKnowledge.slice(0, 2).map(knowledgeEvidence),
    ...duePlans.slice(0, 2).map((plan) => ({ type: "tutoring_plan" as const, id: plan.id, label: plan.title, observedAt: plan.updatedAt })),
  ];
  const signals = [
    ...goalAndActionSignals(tutoringPlans, tutoringSessions),
    ...(dueEvidence.length ? [{
      id: signalId("due_review", "current"),
      kind: "due_review" as const,
      title: "存在到期复习",
      summary: `当前有 ${dueMistakes.length} 道错题、${dueKnowledge.length} 个知识点和 ${duePlans.length} 个辅导任务到期。`,
      score: 92,
      evidence: dueEvidence,
    }] : []),
    ...boardWeaknessSignals(mistakes, latestAttempts),
    ...misconceptionSignals(mistakes),
    ...knowledgeSignals(knowledgeEntries, latestKnowledgeAttempts),
    ...interviewSignals(interviewEvaluations),
    ...tutoringSignals(tutoringTurns),
  ].toSorted((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, SIGNAL_LIMIT);
  const evidenceCount = new Set(signals.flatMap((signal) => signal.evidence.map((item) => `${item.type}:${item.id}`))).size;
  return {
    generatedAt: today.toISOString(),
    currentGoal: signals.find((signal) => signal.kind === "goal")?.summary,
    dueReviewCount: dueMistakes.length + dueKnowledge.length + duePlans.length,
    evidenceCount,
    signals,
  };
}
