import type { ConversationToolRunSummary } from "../../services/conversation-tool-summary";
import { AppIcon } from "../shared/app-icon";
import { cx } from "../shared/ui-primitives";

/** 用颜色点表示单个工具步骤的本地执行状态。 */
function ToolStateDot({ state }: { state: "pending" | "running" | "done" | "error" }) {
  return <span aria-hidden="true" className={cx("mt-1 h-2.5 w-2.5 rounded-full", state === "done" && "bg-green", state === "running" && "bg-blue", state === "error" && "bg-red", state === "pending" && "bg-muted/40")} />;
}

/** 工具过程在消息流中折叠展示，展开后才显示每一步的本地摘要。 */
export function ConversationToolRunSummary({ summary }: { summary: ConversationToolRunSummary }) {
  return (
    <details className={cx("conversation-tool-summary", summary.state === "error" && "is-error", summary.state === "running" && "is-running")}>
      <summary><span aria-hidden="true" className="conversation-tool-summary-icon"><AppIcon name="activity" size={16} /></span><span>{summary.label}</span></summary>
      <ol>{summary.steps.map((step) => <li key={step.id}><ToolStateDot state={step.state} /><span className="min-w-0"><strong>{step.label}</strong>{step.text ? <small>{step.text}</small> : null}</span></li>)}</ol>
    </details>
  );
}
