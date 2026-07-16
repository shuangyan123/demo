import type { TutoringSession, TutoringTurn } from "../types/review.ts";

export type TutoringPilotMetrics = {
  completedSessions: number;
  helpfulRate?: number;
  assessedTurnCount: number;
  averageAssessmentRate?: number;
  assessmentGain?: number;
  responseLatencyP95Ms?: number;
  d7Returned: boolean;
};

function percentile(values: number[], ratio: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** 从本地辅导记录计算试点指标，不上传用户行为或媒体数据。 */
export function calculateTutoringPilotMetrics(sessions: TutoringSession[], turns: TutoringTurn[]): TutoringPilotMetrics {
  const helpful = turns.filter((turn) => turn.speaker === "ai_tutor" && turn.helpful !== undefined);
  const assessments = turns.flatMap((turn) => {
    const assessment = turn.microAssessment;
    if (!assessment?.completedAt || !assessment.questions.length) return [];
    return [{ sessionId: turn.sessionId, rate: (assessment.correctCount ?? 0) / assessment.questions.length, completedAt: assessment.completedAt }];
  });
  const sessionAssessments = new Map<string, typeof assessments>();
  for (const assessment of assessments) sessionAssessments.set(assessment.sessionId, [...(sessionAssessments.get(assessment.sessionId) ?? []), assessment]);
  const gains = [...sessionAssessments.values()].flatMap((items) => {
    const sorted = items.toSorted((left, right) => left.completedAt.localeCompare(right.completedAt));
    return sorted.length > 1 ? [sorted.at(-1)!.rate - sorted[0].rate] : [];
  });
  const sessionsByTopic = new Map<string, number[]>();
  for (const session of sessions) {
    const key = session.topic.trim().toLowerCase();
    const startedAt = Date.parse(session.startedAt);
    if (!key || !Number.isFinite(startedAt)) continue;
    sessionsByTopic.set(key, [...(sessionsByTopic.get(key) ?? []), startedAt]);
  }
  const d7Returned = [...sessionsByTopic.values()].some((values) => {
    const sorted = values.toSorted((left, right) => left - right);
    return sorted.length > 1 && sorted.at(-1)! - sorted[0] >= 7 * 24 * 60 * 60 * 1000;
  });
  const latency = turns.flatMap((turn) => typeof turn.responseLatencyMs === "number" ? [turn.responseLatencyMs] : []);
  return {
    completedSessions: sessions.filter((session) => session.status === "completed").length,
    helpfulRate: helpful.length ? helpful.filter((turn) => turn.helpful).length / helpful.length : undefined,
    assessedTurnCount: assessments.length,
    averageAssessmentRate: assessments.length ? assessments.reduce((sum, item) => sum + item.rate, 0) / assessments.length : undefined,
    assessmentGain: gains.length ? gains.reduce((sum, value) => sum + value, 0) / gains.length : undefined,
    responseLatencyP95Ms: percentile(latency, 0.95),
    d7Returned,
  };
}
