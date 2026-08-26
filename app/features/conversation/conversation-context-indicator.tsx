"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { conversationContextUsagePolicy, formatContextTokenCount, type ConversationContextBudget } from "../../services/conversation-context-budget.ts";
import type { ConversationContextCompaction } from "../../types/domains/conversation.ts";
import { AppIcon } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";

function compactSummary(summary: string): string {
  return summary.replace(/\s+/g, " ").trim().slice(0, 120) || "暂无可用摘要";
}

export function contextUsagePercent(budget: ConversationContextBudget): number | undefined {
  if (!budget.contextWindow) return undefined;
  return Math.max(0, Math.min(100, Math.round((budget.usedTokens / budget.contextWindow) * 100)));
}

/** 环形入口只展示结构化预算和规范化摘要，不回显完整历史消息。 */
export function ConversationContextIndicator({
  budget,
  compaction,
  compressing,
  compressionAvailable,
  conversationSummary,
  busy,
  onCompress,
}: {
  budget: ConversationContextBudget;
  compaction?: ConversationContextCompaction;
  compressing: boolean;
  compressionAvailable: boolean;
  conversationSummary: string;
  busy: boolean;
  onCompress: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const usagePercent = contextUsagePercent(budget);
  const displayPercent = usagePercent ?? 0;
  const warning = usagePercent !== undefined && usagePercent >= conversationContextUsagePolicy.warningPercent;
  return (
    <details
      ref={detailsRef}
      className="conversation-context-budget"
      data-context-warning={warning ? "true" : undefined}
      onKeyDown={(event: KeyboardEvent<HTMLDetailsElement>) => {
        if (event.key !== "Escape" || !detailsRef.current?.open) return;
        event.preventDefault();
        detailsRef.current.open = false;
        detailsRef.current.querySelector<HTMLElement>("summary")?.focus();
      }}
    >
      <summary aria-label={usagePercent === undefined ? "查看对话上下文用量，上限未知" : `查看对话上下文用量，已使用 ${usagePercent}%`}>
        <span
          className="conversation-context-ring"
          style={{ "--context-usage": `${displayPercent * 3.6}deg` } as CSSProperties}
        >
          <span>{usagePercent === undefined ? "—" : `${usagePercent}%`}</span>
        </span>
      </summary>
      <section aria-label="对话上下文详情">
        <header><strong>上下文</strong><span>{budget.precision === "usage-calibrated" ? "厂商用量校准" : "本地保守估算"}</span></header>
        <dl>
          <div><dt>已使用</dt><dd>{formatContextTokenCount(budget.usedTokens)} tokens{usagePercent !== undefined ? ` · ${usagePercent}%` : ""}</dd></div>
          <div><dt>上下文上限</dt><dd>{budget.contextWindow ? `${formatContextTokenCount(budget.contextWindow)} tokens` : "模型上限未知"}</dd></div>
          <div><dt>输出预留</dt><dd>{formatContextTokenCount(budget.outputReserveTokens)} tokens</dd></div>
        </dl>
        <div className="conversation-context-summary">
          <span>当前对话</span>
          <p>{compactSummary(compaction?.summary ?? conversationSummary)}</p>
        </div>
        <p className="conversation-context-compaction-state">
          {compaction ? `上次压缩：${new Date(compaction.compactedAt).toLocaleString("zh-CN")} · ${compaction.sourceMessageCount} 条消息` : "上次压缩：尚未执行"}
        </p>
        <Button size="sm" disabled={!compressionAvailable || compressing || busy} onClick={onCompress}>
          {compressing ? <><span className="ui-spinner" />正在压缩</> : <><AppIcon name="sparkles" size={16} />压缩上下文</>}
        </Button>
        {!compressionAvailable ? <small>旧上下文达到可压缩规模后可用；自动压缩尚未启用。</small> : null}
      </section>
    </details>
  );
}
