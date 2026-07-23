import type { ConversationTurnTimeline } from "../../services/conversation-turns";
import type { AiConversationRunStep } from "../../types/domains/conversation.ts";
import type { ReactNode } from "react";
import { ConversationToolRunSummary } from "./conversation-tool-run-summary";

/** 极简轮次视图固定呈现用户、必要工具和 AI，诊断元数据按需展开。 */
export function ConversationTurnList({
  timeline,
  activeTurnId,
  assistantDraft,
  diagnostics,
  renderAfterAssistant,
}: {
  timeline: ConversationTurnTimeline;
  activeTurnId?: string;
  assistantDraft: string;
  diagnostics: Map<string, AiConversationRunStep[]>;
  renderAfterAssistant?: (messageId: string) => ReactNode;
}) {
  const draftAttached = Boolean(activeTurnId && timeline.turns.some((turn) => turn.id === activeTurnId));
  return (
    <>
      {timeline.turns.map((turn) => {
        const turnDiagnostics = diagnostics.get(turn.id) ?? [];
        return (
          <section key={turn.id} className="conversation-turn" data-turn-id={turn.id}>
            {turn.user ? <article className="conversation-message is-user"><div className="conversation-message-bubble"><p>{turn.user.content}</p></div></article> : null}
            {turn.tools.map((summary) => <ConversationToolRunSummary key={summary.runId} summary={summary} />)}
            {turn.assistant ? <article className="conversation-message is-assistant"><div className="conversation-message-bubble"><p>{turn.assistant.content}</p></div></article> : null}
            {turn.assistant ? renderAfterAssistant?.(turn.assistant.id) : null}
            {activeTurnId === turn.id && assistantDraft ? <article className="conversation-message is-assistant is-streaming"><div className="conversation-message-bubble"><p>{assistantDraft}</p></div></article> : null}
            {turnDiagnostics.length ? (
              <details className="conversation-turn-details">
                <summary>详情</summary>
                <ul>{turnDiagnostics.map((step) => <li key={step.id}><strong>{step.label}</strong>{step.text ? <span>{step.text}</span> : null}</li>)}</ul>
              </details>
            ) : null}
          </section>
        );
      })}
      {!draftAttached && assistantDraft ? <article className="conversation-message is-assistant is-streaming"><div className="conversation-message-bubble"><p>{assistantDraft}</p></div></article> : null}
      {timeline.standaloneTools.map((summary) => <ConversationToolRunSummary key={summary.runId} summary={summary} />)}
    </>
  );
}
