import type { InterviewAiReply } from "../../services/interview-ai-service.ts";
import type { ApiConnectionProfile } from "../../types/domains/ai-connection.ts";
import type { InterviewQuestion, InterviewSession, InterviewTurn } from "../../types/domains/interview.ts";
import type { PersonalizationSettings } from "../../types/domains/personalization.ts";
import { InterviewApplicationError, resolveInterviewAiSpeaker } from "./interview-application.ts";

type NewInterviewTurn = Omit<InterviewTurn, "id" | "createdAt">;
type InterviewSessionPatch = Partial<Omit<InterviewSession, "id" | "createdAt">>;

export type StartInterviewSessionDependencies = {
  createSession: (question: InterviewQuestion, planId?: string) => Promise<InterviewSession>;
  requestReply: (input: {
    question: InterviewQuestion;
    session: InterviewSession;
    connection: ApiConnectionProfile;
    turns: InterviewTurn[];
    personalizationSettings: PersonalizationSettings;
  }) => Promise<InterviewAiReply>;
  addTurn: (input: NewInterviewTurn) => Promise<InterviewTurn>;
  updateSession: (id: string, patch: InterviewSessionPatch) => Promise<void>;
};

export type StartInterviewSessionResult = {
  session: InterviewSession;
  aiTurn: InterviewTurn;
};

export async function startInterviewSession({
  question,
  planId,
  connection,
  personalizationSettings,
  dependencies,
}: {
  question: InterviewQuestion;
  planId?: string;
  connection: ApiConnectionProfile;
  personalizationSettings: PersonalizationSettings;
  dependencies: StartInterviewSessionDependencies;
}): Promise<StartInterviewSessionResult> {
  let session: InterviewSession;
  try {
    session = await dependencies.createSession(question, planId);
  } catch (error) {
    throw new InterviewApplicationError<StartInterviewSessionResult>("create-session", error, {});
  }

  let reply: InterviewAiReply;
  try {
    reply = await dependencies.requestReply({ question, session, connection, turns: [], personalizationSettings });
  } catch (error) {
    throw new InterviewApplicationError<StartInterviewSessionResult>("request-reply", error, { session });
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
    throw new InterviewApplicationError<StartInterviewSessionResult>("save-ai-turn", error, { session });
  }

  const sessionPatch: InterviewSessionPatch = {
    stage: reply.nextStage,
    transcriptText: reply.reply,
  };
  try {
    await dependencies.updateSession(session.id, sessionPatch);
  } catch (error) {
    throw new InterviewApplicationError<StartInterviewSessionResult>("update-session", error, { session, aiTurn });
  }

  return { session: { ...session, ...sessionPatch }, aiTurn };
}
