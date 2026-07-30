"use client";

import { useMemo, useState } from "react";
import { isAcquisitionProposalConfirmable } from "../../services/acquisition-trust";
import type { KnowledgeEvolutionProposal } from "../../types/domains/obsidian.ts";
import { Button, Chip, EmptyState } from "../shared/ui-primitives";
import type { useObsidianKnowledgeBridge } from "./use-obsidian-knowledge-bridge.ts";

type Controller = ReturnType<typeof useObsidianKnowledgeBridge>;
type FilterValue = "all" | string;

/** 桌面双栏、移动单栏的提案筛选与批量确认工作区。 */
export function ObsidianProposalReview({ controller }: { controller: Controller }) {
  const [domain, setDomain] = useState<FilterValue>("all");
  const [grade, setGrade] = useState<FilterValue>("all");
  const [review, setReview] = useState<FilterValue>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>();

  const filtered = useMemo(() => controller.pendingProposals.filter((proposal) => {
    const provenance = proposal.provenance;
    return (domain === "all" || provenance?.domain === domain)
      && (grade === "all" || provenance?.trust.grade === grade)
      && (review === "all" || provenance?.reviewStatus === review);
  }), [controller.pendingProposals, domain, grade, review]);
  const active = filtered.find((proposal) => proposal.id === activeId) ?? filtered[0];
  const selectableIds = filtered.filter(isAcquisitionProposalConfirmable).map((proposal) => proposal.id);

  function toggleSelected(id: string, checked: boolean): void {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface-muted p-3">
        <Filter label="领域" value={domain} onChange={setDomain} options={[["all", "全部"], ["xingce", "行测"], ["shenlun", "申论"], ["interview", "面试"]]} />
        <Filter label="可信度" value={grade} onChange={setGrade} options={[["all", "全部"], ["A", "A 级"], ["B", "B 级"], ["C", "C 级"]]} />
        <Filter label="复核" value={review} onChange={setReview} options={[["all", "全部"], ["agreed", "一致"], ["disputed", "有争议"], ["not_configured", "未交叉复核"]]} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!selectableIds.length} onClick={() => setSelectedIds(selectableIds)}>选择可确认项</Button>
          <Button size="sm" variant="primary" disabled={controller.busy || !selectedIds.length} onClick={() => void controller.acceptProposals(selectedIds)}>批量确认 {selectedIds.length || ""}</Button>
        </div>
      </div>

      {filtered.length ? (
        <div className="grid min-w-0 grid-cols-[minmax(280px,.78fr)_minmax(0,1.22fr)] gap-4 max-lg:grid-cols-1">
          <div className="grid max-h-[720px] content-start gap-2 overflow-y-auto pr-1">
            {filtered.map((proposal) => {
              const blocked = !isAcquisitionProposalConfirmable(proposal);
              const trust = proposal.provenance?.trust;
              return (
                <article key={proposal.id} className={`rounded-xl border p-3 ${active?.id === proposal.id ? "border-foreground bg-[var(--interactive-selected-bg)]" : "border-line bg-background"}`}>
                  <div className="flex items-start gap-3">
                    <input aria-label={`选择 ${proposal.title}`} className="mt-1" type="checkbox" disabled={blocked} checked={selectedIds.includes(proposal.id)} onChange={(event) => toggleSelected(proposal.id, event.currentTarget.checked)} />
                    <button className="min-w-0 flex-1 text-left" type="button" onClick={() => setActiveId(proposal.id)}>
                      <div className="flex flex-wrap gap-1.5">
                        <Chip tone={trust?.grade === "A" ? "green" : trust?.grade === "B" ? "blue" : "yellow"}>{trust ? `${trust.grade} · ${trust.total}` : `${Math.round(proposal.confidence * 100)}%`}</Chip>
                        <Chip>{proposal.provenance?.domain === "xingce" ? "行测" : proposal.provenance?.domain === "shenlun" ? "申论" : proposal.provenance?.domain === "interview" ? "面试" : proposal.category}</Chip>
                        {proposal.provenance?.reviewStatus === "disputed" ? <Chip tone="red">有争议</Chip> : proposal.provenance?.reviewStatus === "not_configured" ? <Chip tone="yellow">未交叉复核</Chip> : null}
                      </div>
                      <strong className="mt-2 block text-sm leading-6">{proposal.title}</strong>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{proposal.summary || proposal.reason}</p>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {active ? <ProposalDetail key={`${active.id}:${active.updatedAt}`} controller={controller} proposal={active} /> : null}
        </div>
      ) : <EmptyState stateId="knowledge.obsidian.proposal-filter.empty">当前筛选下没有待确认提案。</EmptyState>}
    </div>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-xs text-muted">{label}<select className="min-h-9 rounded-lg border border-line bg-background px-2 text-sm text-foreground" value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}

/** 详情区允许修订生成稿；证据和可信度只读。 */
function ProposalDetail({ controller, proposal }: { controller: Controller; proposal: KnowledgeEvolutionProposal }) {
  const [title, setTitle] = useState(proposal.title);
  const [summary, setSummary] = useState(proposal.summary);
  const [content, setContent] = useState(proposal.content);
  const [tags, setTags] = useState(proposal.tags.join("、"));
  const [links, setLinks] = useState(proposal.proposedLinks.join("、"));
  const provenance = proposal.provenance;
  const blocked = !isAcquisitionProposalConfirmable(proposal);
  const split = (value: string) => value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  return (
    <section className="min-w-0 rounded-xl border border-line bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {provenance ? <Chip tone={provenance.trust.grade === "A" ? "green" : provenance.trust.grade === "B" ? "blue" : "yellow"}>可信度 {provenance.trust.grade} · {provenance.trust.total}</Chip> : null}
          {provenance ? <Chip tone={provenance.reviewStatus === "disputed" ? "red" : provenance.reviewStatus === "not_configured" ? "yellow" : "green"}>{provenance.reviewStatus === "agreed" ? "双模型一致" : provenance.reviewStatus === "disputed" ? "模型有分歧" : "未交叉复核"}</Chip> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={controller.busy} onClick={() => void controller.rejectProposal(proposal.id)}>忽略</Button>
          <Button size="sm" variant="primary" disabled={controller.busy || blocked} onClick={() => void controller.acceptProposal(proposal.id)}>确认写入</Button>
        </div>
      </div>
      {provenance?.trust.blockingIssues.length ? <div className="mt-3 rounded-lg border border-red/30 bg-red/5 p-3 text-sm text-danger">阻止确认：{provenance.trust.blockingIssues.join("；")}</div> : null}
      {provenance?.reviewIssues.length ? <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">复核说明：{provenance.reviewIssues.join("；")}</div> : null}
      <p className="mt-3 text-sm leading-6 text-muted">{proposal.reason}</p>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">标题<input className="min-h-10 rounded-lg border border-line px-3" value={title} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
        <label className="grid gap-1 text-sm">摘要<textarea className="min-h-20 rounded-lg border border-line p-3" value={summary} onChange={(event) => setSummary(event.currentTarget.value)} /></label>
        <label className="grid gap-1 text-sm">生成稿<textarea className="min-h-72 rounded-lg border border-line p-3 font-mono text-sm leading-6" value={content} onChange={(event) => setContent(event.currentTarget.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">标签<input className="min-h-9 rounded-lg border border-line px-3" value={tags} onChange={(event) => setTags(event.currentTarget.value)} /></label>
          <label className="grid gap-1 text-sm">建议双链<input className="min-h-9 rounded-lg border border-line px-3" value={links} onChange={(event) => setLinks(event.currentTarget.value)} /></label>
        </div>
        <Button className="justify-self-start" size="sm" variant="outline" disabled={controller.busy} onClick={() => void controller.updateProposal(proposal.id, { title, summary, content, tags: split(tags), proposedLinks: split(links) })}>保存修改</Button>
      </div>

      {provenance ? (
        <details className="mt-5 rounded-xl border border-line bg-surface-muted p-3" open>
          <summary className="cursor-pointer font-medium">段落证据 · {provenance.evidence.length} 条</summary>
          <div className="mt-3 grid gap-3">
            {provenance.evidence.map((evidence) => (
              <article key={evidence.id} className="rounded-lg border border-line bg-background p-3">
                <p className="text-sm leading-6">{evidence.quote}</p>
                <a className="mt-2 block break-all text-xs text-foreground underline-offset-2 hover:underline" href={evidence.url} rel="noreferrer" target="_blank">{evidence.publisher || new URL(evidence.url).hostname} · {evidence.publishedAt || "采集时可访问"}</a>
                <p className="mt-1 break-all font-mono text-[11px] text-muted">SHA-256 {evidence.contentHash}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
