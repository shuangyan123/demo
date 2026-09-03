"use client";

import type { AiConversation, AiConversationAttachment } from "../../types/domains/conversation.ts";
import { AppIcon } from "../shared/app-icon";
import type { ConversationLaunchContext } from "./conversation-launch-context.ts";

type ConversationContextPanelProps = {
  activeConversation?: AiConversation | null;
  attachments: AiConversationAttachment[];
  partitionLabel?: string;
  launchContext?: ConversationLaunchContext | null;
  projectLabel?: string;
};

function ContextFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="workspace-context-fact grid min-w-0 gap-1 border-t border-line pt-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-xs font-semibold" style={{ overflowWrap: "anywhere" }}>{value}</dd>
    </div>
  );
}

/** 对话注册的轻量上下文内容只读本地快照，不创建新的资料或凭据边界。 */
export function ConversationContextPanel({ activeConversation, attachments, partitionLabel, launchContext, projectLabel }: ConversationContextPanelProps) {
  const facts = [
    projectLabel ? <ContextFact key="project" label="项目" value={projectLabel} /> : null,
    partitionLabel ? <ContextFact key="partition" label="分区" value={partitionLabel} /> : null,
    activeConversation ? <ContextFact key="messages" label="消息" value={`${activeConversation.messageCount} 条`} /> : null,
    activeConversation ? <ContextFact key="source" label="来源" value={activeConversation.sourceType} /> : null,
  ].filter(Boolean);
  const title = activeConversation?.title ?? launchContext?.title ?? "新对话";

  return (
    <div className="workspace-context-panel-content grid min-w-0 gap-4" data-context-panel-slot="conversation">
      <section className="workspace-context-panel-lead grid min-w-0 gap-1">
        <span className="workspace-context-panel-eyebrow text-xs font-semibold uppercase text-muted">会话资料</span>
        <h3 className="m-0 truncate text-base font-bold" title={title}>{title}</h3>
        <p className="m-0 text-xs leading-6 text-muted">{activeConversation ? "已保存的本地会话" : "发送首条消息后创建本地会话。"}</p>
      </section>
      {launchContext && !activeConversation ? (
        <section className="workspace-context-launch grid gap-2 rounded-lg border border-line bg-surface-muted p-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold"><AppIcon name="sparkles" size={16} /><strong className="truncate">{launchContext.moduleLabel}</strong></div>
          <p className="m-0 text-xs leading-6 text-muted">{launchContext.summary}</p>
        </section>
      ) : null}
      {facts.length ? <dl className="workspace-context-facts grid grid-cols-2 gap-2">{facts}</dl> : null}
      <section className="workspace-context-attachments grid min-w-0 gap-2">
        <div className="workspace-context-section-heading flex min-w-0 items-center justify-between gap-2 border-b border-line pb-2">
          <h3 className="m-0 text-xs font-bold">附加资料</h3>
          <span className="font-mono text-xs text-muted">{attachments.length}</span>
        </div>
        {attachments.length ? (
          <ul className="m-0 grid list-none gap-1 p-0">
            {attachments.map((attachment) => (
              <li className="grid min-w-0 gap-1 border-b border-line py-2" key={attachment.id}>
                <strong className="truncate text-xs" title={attachment.label}>{attachment.label}</strong>
                <span className="text-xs leading-5 text-muted" style={{ overflowWrap: "anywhere" }}>{attachment.summary || "没有摘要"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="workspace-context-muted m-0 text-xs leading-6 text-muted">当前会话尚未附加资料。</p>}
      </section>
    </div>
  );
}
