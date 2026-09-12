"use client";

import { formatShortDate, masteryLabel } from "../../lib/review-utils";
import type { KnowledgeEntry, KnowledgeQueueFilter } from "../../types/domains/knowledge.ts";
import type { ReviewResult } from "../../types/domains/review.ts";
import { Button, Chip, DetailBlock, DetailCard, EmptyState, MasteryDots, Panel, SoftBlock } from "../shared/ui-primitives";
import styles from "./knowledge-training-view.module.css";

function QueueFilterTabs({ active, onChange }: { active: KnowledgeQueueFilter; onChange: (filter: KnowledgeQueueFilter) => void }) {
  const options: Array<[KnowledgeQueueFilter, string]> = [["due", "今日到期"], ["weak", "薄弱"], ["favorite", "收藏"], ["all", "全部"]];
  return (
    <div className={styles.queueFilters}>
      {options.map(([value, label]) => (
        <Button key={value} type="button" size="sm" variant={active === value ? "soft" : "outline"} onClick={() => onChange(value)}>{label}</Button>
      ))}
    </div>
  );
}

/** 知识训练将训练画布、队列和会话摘要拆为单一职责区域。 */
export function KnowledgeTrainingView({
  disabled = false,
  answerOpen,
  attemptsCount,
  correctRate,
  currentEntry,
  dueEntries,
  lowEntries,
  queueEntries,
  queueFilter,
  trainingIndex,
  onChangeQueueFilter,
  onMove,
  onOpenKnowledgeEntry,
  onRecordReview,
  onSkip,
  onSelectEntry,
  onToggleAnswer,
}: {
  disabled?: boolean;
  answerOpen: boolean;
  attemptsCount: number;
  correctRate: number;
  currentEntry: KnowledgeEntry | null;
  dueEntries: KnowledgeEntry[];
  lowEntries: KnowledgeEntry[];
  queueEntries: KnowledgeEntry[];
  queueFilter: KnowledgeQueueFilter;
  trainingIndex: number;
  onChangeQueueFilter: (filter: KnowledgeQueueFilter) => void;
  onMove: (delta: -1 | 1) => void;
  onOpenKnowledgeEntry: (entry: KnowledgeEntry) => void;
  onRecordReview: (result: ReviewResult) => void;
  onSkip: () => void;
  onSelectEntry: (entryId?: string) => void;
  onToggleAnswer: () => void;
}) {
  return (
    <section className={styles.workspace}>
      <DetailCard className={styles.canvas}>
        <QueueFilterTabs active={queueFilter} onChange={onChangeQueueFilter} />
        {currentEntry ? (
          <>
            <header className={styles.header}>
              <div><p>{currentEntry.category} · {currentEntry.source}</p><h1>第 {Math.min(trainingIndex + 1, queueEntries.length)} 条 / {queueEntries.length}</h1></div>
              <div className={styles.status}><Chip tone="yellow">{masteryLabel(currentEntry.mastery)}</Chip><MasteryDots value={currentEntry.mastery} /></div>
            </header>
            <SoftBlock className={styles.prompt}>
              <strong>{currentEntry.title}</strong>
              <p>{currentEntry.summary || "先闭卷回想这条资料的关键词、适用场景和易混点。"}</p>
              <div className="mt-4 flex flex-wrap gap-2">{currentEntry.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}</div>
            </SoftBlock>
            <fieldset disabled={disabled} className={styles.actions}>
              <Button variant="outline" onClick={onToggleAnswer}>{answerOpen ? "收起资料" : "查看资料"}</Button>
              <Button variant="soft" onClick={() => onRecordReview("correct")}>会了</Button>
              <Button variant="outline" onClick={() => onRecordReview("uncertain")}>犹豫</Button>
              <Button variant="danger" onClick={() => onRecordReview("wrong")}>不会</Button>
              <Button variant="outline" onClick={() => onMove(-1)}>上一条</Button>
              <Button variant="outline" onClick={() => onMove(1)}>下一条</Button>
              <Button variant="outline" onClick={onSkip}>跳过本次</Button>
              <Button variant="soft" onClick={() => onOpenKnowledgeEntry(currentEntry)}>编辑资料</Button>
            </fieldset>
            {answerOpen ? (
              <div className="mt-5 space-y-4 leading-relaxed">
                <DetailBlock title="资料正文">{currentEntry.content}</DetailBlock>
                <DetailBlock title="训练计划">下次训练 {currentEntry.nextReviewAt} · 已训练 {currentEntry.reviewCount} 次{currentEntry.lastReviewedAt ? ` · 最近 ${currentEntry.lastReviewedAt}` : ""}</DetailBlock>
              </div>
            ) : null}
          </>
        ) : <div className="mt-4"><EmptyState stateId="knowledge.training.results.empty">当前筛选下没有知识资料。切换队列，或先在知识库新增资料。</EmptyState></div>}
      </DetailCard>

      <aside className={styles.aside}>
        <Panel title="会话摘要" eyebrow="Session">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-blue/10 p-3 text-blue"><span className="text-xs font-bold">今日到期</span><strong className="mt-1 block text-2xl">{dueEntries.length}</strong></div>
            <div className="rounded-lg bg-red/10 p-3 text-red"><span className="text-xs font-bold">薄弱资料</span><strong className="mt-1 block text-2xl">{lowEntries.length}</strong></div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">已训练 {attemptsCount} 次，历史会了率 {correctRate}%。</p>
        </Panel>
        <Panel title="训练队列" eyebrow="Queue">
          <div className={styles.queue}>
            {queueEntries.length ? queueEntries.map((entry, index) => (
              <button key={entry.id} aria-current={currentEntry?.id === entry.id ? "true" : undefined} type="button" onClick={() => onSelectEntry(entry.id)}>
                <span className={styles.queueIndex}>{index + 1}</span>
                <span className="min-w-0"><strong>{entry.title}</strong><small>{entry.category} · {formatShortDate(entry.nextReviewAt)}</small></span>
              </button>
            )) : <EmptyState reviewPack="learning" stateId="knowledge.training.queue.empty">当前队列为空</EmptyState>}
          </div>
        </Panel>
      </aside>
    </section>
  );
}
