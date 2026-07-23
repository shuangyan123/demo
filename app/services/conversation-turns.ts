import type { AiConversationMessage, AiConversationRunStep } from "../types/domains/conversation.ts";
import { compareConversationMessages } from "./conversation-repository.ts";
import { summarizeConversationRunSteps, type ConversationToolRunSummary } from "./conversation-tool-summary.ts";

export type ConversationTurn = {
  id: string;
  user?: AiConversationMessage;
  assistant?: AiConversationMessage;
  system: AiConversationMessage[];
  tools: ConversationToolRunSummary[];
};

export type ConversationTurnTimeline = {
  turns: ConversationTurn[];
  standaloneTools: ConversationToolRunSummary[];
};

/** 将新旧消息确定性归并为“用户 → 工具 → AI”轮次，不修改历史持久化数据。 */
export function buildConversationTurnTimeline(messages: AiConversationMessage[], runSteps: AiConversationRunStep[]): ConversationTurnTimeline {
  const turns: ConversationTurn[] = [];
  const byId = new Map<string, ConversationTurn>();
  const pendingLegacyTurns: ConversationTurn[] = [];
  let latestLegacyTurn: ConversationTurn | undefined;

  for (const message of messages.toSorted(compareConversationMessages)) {
    if (message.turnId) {
      let turn = byId.get(message.turnId);
      if (!turn) {
        turn = { id: message.turnId, system: [], tools: [] };
        byId.set(message.turnId, turn);
        turns.push(turn);
      }
      if (message.role === "user") turn.user = message;
      else if (message.role === "assistant") turn.assistant = message;
      else turn.system.push(message);
      continue;
    }

    if (message.role === "user") {
      latestLegacyTurn = { id: `legacy:${message.id}`, user: message, system: [], tools: [] };
      turns.push(latestLegacyTurn);
      pendingLegacyTurns.push(latestLegacyTurn);
      continue;
    }
    if (message.role === "assistant") {
      latestLegacyTurn = pendingLegacyTurns.pop();
      if (!latestLegacyTurn) {
        latestLegacyTurn = { id: `legacy:${message.id}`, system: [], tools: [] };
        turns.push(latestLegacyTurn);
      }
      latestLegacyTurn.assistant = message;
      continue;
    }
    if (!latestLegacyTurn) {
      latestLegacyTurn = { id: `legacy:${message.id}`, system: [], tools: [] };
      turns.push(latestLegacyTurn);
    }
    latestLegacyTurn.system.push(message);
  }

  const standaloneTools: ConversationToolRunSummary[] = [];
  for (const summary of summarizeConversationRunSteps(runSteps)) {
    const turn = summary.turnId ? byId.get(summary.turnId) : undefined;
    if (turn) turn.tools.push(summary);
    else standaloneTools.push(summary);
  }
  return { turns, standaloneTools };
}
