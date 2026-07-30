import type { InterviewSession } from "../types/domains/interview.ts";

export type InterviewTimerPatch = Pick<InterviewSession, "timerStatus" | "currentTurnElapsedSec" | "currentTurnStartedAt">;

/** 旧会话没有计时字段时，未完成会话继续运行，已完成或已评分会话永久冻结。 */
export function normalizeInterviewTimer(session: InterviewSession, nowMs = Date.now()): InterviewSession {
  if (session.timerStatus) return session;
  const finished = Boolean(session.completedAt) || session.status === "evaluated" || session.stage === "evaluated";
  return {
    ...session,
    timerStatus: finished ? "finished" : "running",
    currentTurnElapsedSec: 0,
    currentTurnStartedAt: finished ? undefined : new Date(nowMs).toISOString(),
  };
}

export function interviewTurnElapsedSec(session: InterviewSession, nowMs = Date.now()): number {
  const normalized = normalizeInterviewTimer(session, nowMs);
  const accumulated = Math.max(0, normalized.currentTurnElapsedSec ?? 0);
  if (normalized.timerStatus !== "running" || !normalized.currentTurnStartedAt) return accumulated;
  return accumulated + Math.max(0, Math.floor((nowMs - new Date(normalized.currentTurnStartedAt).getTime()) / 1_000));
}

export function pauseInterviewTimer(session: InterviewSession, nowMs = Date.now()): InterviewTimerPatch {
  return {
    timerStatus: "paused",
    currentTurnElapsedSec: interviewTurnElapsedSec(session, nowMs),
    currentTurnStartedAt: undefined,
  };
}

export function resumeInterviewTimer(session: InterviewSession, nowMs = Date.now()): InterviewTimerPatch {
  if (normalizeInterviewTimer(session, nowMs).timerStatus === "finished") {
    return finishInterviewTimer(session, nowMs);
  }
  return {
    timerStatus: "running",
    currentTurnElapsedSec: Math.max(0, session.currentTurnElapsedSec ?? 0),
    currentTurnStartedAt: new Date(nowMs).toISOString(),
  };
}

export function resetInterviewTurnTimer(nowMs = Date.now()): InterviewTimerPatch {
  return {
    timerStatus: "running",
    currentTurnElapsedSec: 0,
    currentTurnStartedAt: new Date(nowMs).toISOString(),
  };
}

export function finishInterviewTimer(session: InterviewSession, nowMs = Date.now()): InterviewTimerPatch {
  return {
    timerStatus: "finished",
    currentTurnElapsedSec: interviewTurnElapsedSec(session, nowMs),
    currentTurnStartedAt: undefined,
  };
}
