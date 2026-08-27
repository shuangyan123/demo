"use client";

import { type CSSProperties } from "react";
import { conversationContextUsagePolicy, formatContextTokenCount, type ConversationContextBudget } from "../../services/conversation-context-budget.ts";
import { UiPopover } from "../shared/ui-popover";

export function contextUsagePercent(budget: ConversationContextBudget): number | undefined {
  if (!budget.contextWindow) return undefined;
  return Math.max(0, Math.min(100, Math.round((budget.usedTokens / budget.contextWindow) * 100)));
}

/** 环形入口只展示紧凑的结构化用量；手动压缩通过输入框的 /压缩 命令触发。 */
export function ConversationContextIndicator({ budget }: { budget: ConversationContextBudget }) {
  const usagePercent = contextUsagePercent(budget);
  const displayPercent = usagePercent ?? 0;
  const warning = usagePercent !== undefined && usagePercent >= conversationContextUsagePolicy.warningPercent;
  const panel = (
    <section className="conversation-context-popover-content">
      <header><strong>上下文窗口</strong><span>{warning ? "接近上限" : usagePercent === undefined ? "上限未知" : "当前用量"}</span></header>
      <p className="conversation-context-usage">{usagePercent === undefined ? "用量未知" : `${usagePercent}% 已用`}</p>
      <p className="conversation-context-tokens">
        {formatContextTokenCount(budget.usedTokens)} tokens{budget.contextWindow ? `，共 ${formatContextTokenCount(budget.contextWindow)} tokens` : "，上限未知"}
      </p>
    </section>
  );
  return (
    <UiPopover content={panel} contentClassName="conversation-context-popover" contentLabel="上下文窗口">
      {({ contentId, expanded, toggle, triggerRef }) => <button
        ref={triggerRef}
        aria-controls={contentId}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-label={usagePercent === undefined ? "查看对话上下文用量，上限未知" : `查看对话上下文用量，已使用 ${usagePercent}%`}
        className="conversation-context-budget"
        data-context-warning={warning ? "true" : undefined}
        type="button"
        onClick={toggle}
      >
        <span
          className="conversation-context-ring"
          style={{ "--context-usage": `${displayPercent * 3.6}deg` } as CSSProperties}
        >
          <span>{usagePercent === undefined ? "—" : `${usagePercent}%`}</span>
        </span>
      </button>}
    </UiPopover>
  );
}
