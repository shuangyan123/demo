"use client";

import type { KnowledgeEvolutionProposal } from "../../types/domains/obsidian.ts";
import { Button, Chip } from "../shared/ui-primitives";

/** 在消息时间线内呈现可确认的 Obsidian 提案，不跳转到独立卡片墙。 */
export function ConversationProposalBlock({ proposal, busy, onAccept, onReject }: { proposal: KnowledgeEvolutionProposal; busy: boolean; onAccept: () => void; onReject: () => void }) {
  return (
    <article className="conversation-proposal-block">
      <header><span>OBSIDIAN PROPOSAL</span><Chip tone={proposal.status === "pending" ? "yellow" : proposal.status === "accepted" ? "green" : "neutral"}>{proposal.status}</Chip></header>
      <h3>{proposal.title}</h3><p>{proposal.summary}</p>
      <dl><div><dt>方式</dt><dd>{proposal.mode}</dd></div><div><dt>置信度</dt><dd>{Math.round(proposal.confidence * 100)}%</dd></div><div><dt>关系</dt><dd>{proposal.proposedLinks.join("、") || "无"}</dd></div></dl>
      {proposal.status === "pending" ? <footer><Button size="sm" variant="primary" disabled={busy} onClick={onAccept}>确认写入 Vault</Button><Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>忽略</Button></footer> : null}
    </article>
  );
}
