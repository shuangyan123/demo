import type { InterviewSession, InterviewSpeaker, InterviewStage } from "../../types/domains/interview.ts";

export type InterviewApplicationStep =
  | "load-turns"
  | "create-session"
  | "save-candidate-turn"
  | "request-reply"
  | "save-ai-turn"
  | "update-session";

/** 面试 Application 用例的稳定失败边界；partialResult 只描述已经确认完成的步骤。 */
export class InterviewApplicationError<TResult extends object> extends Error {
  readonly partialResult: Partial<TResult>;
  readonly step: InterviewApplicationStep;

  constructor(step: InterviewApplicationStep, cause: unknown, partialResult: Partial<TResult>) {
    super(cause instanceof Error ? cause.message : "面试流程执行失败", { cause });
    this.name = "InterviewApplicationError";
    this.step = step;
    this.partialResult = partialResult;
  }
}

/** AI 在不同面试流程阶段的身份属于流程规则，不由 React 控制器推断。 */
export function resolveInterviewAiSpeaker(type: InterviewSession["type"], stage: InterviewStage): InterviewSpeaker {
  if (type === "structured_group" && (stage === "peer_review" || stage === "response")) return "ai_peer";
  if (type === "leaderless_group" && stage === "discussion") return "ai_peer";
  return "ai_interviewer";
}
