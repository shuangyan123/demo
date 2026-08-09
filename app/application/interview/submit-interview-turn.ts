import type { InterviewAiReply } from "../../services/interview-ai-service.ts";
import type { InterviewTimerPatch } from "../../services/interview-timer.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { InterviewSession, InterviewTurn } from "../../types/domains/interview.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { InterviewApplicationError, resolveInterviewAiSpeaker } from "./interview-application.ts";

type NewInterviewTurn = Omit<InterviewTurn, "id" | "createdAt">;
type InterviewSessionPatch = Partial<Omit<InterviewSession, "id" | "createdAt">>;

export type SubmitInterviewTurnDependencies = {
  listTurns: (sessionId: string) => Promise<InterviewTurn[]>;
  addTurn: (input: NewInterviewTurn) => Promise<InterviewTurn>;
  requestReply: (input: {
    question: InterviewSession;
    session: InterviewSession;
    connection: ApiConnectionProfile;
    turns: InterviewTurn[];
    personalizationSettings: PersonalizationSettings;
  }) => Promise<InterviewAiReply>;
  updateSession: (id: string, patch: InterviewSessionPatch) => Promise<void>;
  resetTurnTimer: () => InterviewTimerPatch;
};

export type SubmitInterviewTurnResult = {
  session: InterviewSession;
  candidateTurn: InterviewTurn;
  aiTurn: InterviewTurn;
  shouldEvaluate: boolean;
};

export async function submitInterviewTurn({
  session,
  answer,
  durationSec,
  connection,
  personalizationSettings,
  dependencies,
}: {
  session: InterviewSession;
  answer: string;
  durationSec: number;
  connection: ApiConnectionProfile;
  personalizationSettings: PersonalizationSettings;
  dependencies: SubmitInterviewTurnDependencies;
}): Promise<SubmitInterviewTurnResult> {
  let existingTurns: InterviewTurn[];
  try {
    existingTurns = await dependencies.listTurns(session.id);
  } catch (error) {
    throw new InterviewApplicationError<SubmitInterviewTurnResult>("load-turns", error, { session });
  }

  let candidateTurn: InterviewTurn;
  try {
    candidateTurn = await dependencies.addTurn({
      content: answer,
      durationSec,
      sessionId: session.id,
      speaker: "candidate",
      stage: session.stage,
    });
  } catch (error) {
    throw new InterviewApplicationError<SubmitInterviewTurnResult>("save-candidate-turn", error, { session });
  }

  const turnsWithCandidate = [...existingTurns, candidateTurn];
  let reply: InterviewAiReply;
  try {
    reply = await dependencies.requestReply({
      question: session,
      session,
      connection,
      turns: turnsWithCandidate,
      personalizationSettings,
    });
  } catch (error) {
    throw new InterviewApplicationError<SubmitInterviewTurnResult>("request-reply", error, { session, candidateTurn });
  }

  let aiTurn: InterviewTurn;
  try {
    aiTurn = await dependencies.addTurn({
      content: reply.reply,
      sessionId: session.id,
      speaker: resolveInterviewAiSpeaker(session.type, reply.nextStage),
      stage: reply.nextStage,
    });
  } catch (error) {
    throw new InterviewApplicationError<SubmitInterviewTurnResult>("save-ai-turn", error, { session, candidateTurn });
  }

  const sessionPatch: InterviewSessionPatch = {
    stage: reply.nextStage,
    totalDurationSec: session.totalDurationSec + durationSec,
    ...dependencies.resetTurnTimer(),
    transcriptText: [...turnsWithCandidate, aiTurn].map((turn) => turn.content).join("\n"),
  };
  try {
    await dependencies.updateSession(session.id, sessionPatch);
  } catch (error) {
    throw new InterviewApplicationError<SubmitInterviewTurnResult>("update-session", error, {
      session,
      candidateTurn,
      aiTurn,
      shouldEvaluate: reply.shouldEvaluate,
    });
  }

  return {
    session: { ...session, ...sessionPatch },
    candidateTurn,
    aiTurn,
    shouldEvaluate: reply.shouldEvaluate,
  };
}
