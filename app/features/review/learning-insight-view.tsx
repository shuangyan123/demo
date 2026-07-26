"use client";

import { useMemo, useState } from "react";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import { Button, EmptyState } from "../shared/ui-primitives";
import { deriveLearningInsightSnapshot, type LearningInsightRange } from "./learning-insight-model.ts";
import styles from "./learning-insight-view.module.css";

const rangeOptions: Array<{ label: string; value: LearningInsightRange }> = [
  { label: "7 天", value: 7 },
  { label: "30 天", value: 30 },
  { label: "90 天", value: 90 },
  { label: "全部", value: "all" },
];

const trendLabels = { up: "上升", down: "下降", stable: "稳定" } as const;

/** 呈现基于真实复盘记录的薄弱分析，并把动作限定为复盘或知识训练。 */
export function LearningInsightView({
  attempts,
  knowledgeEntries,
  mistakes,
  now = new Date(),
  onOpenKnowledgeTraining,
  onOpenReview,
}: {
  attempts: Attempt[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  now?: Date;
  onOpenKnowledgeTraining: (entryId?: string) => void;
  onOpenReview: (mistakeId?: string) => void;
}) {
  const [range, setRange] = useState<LearningInsightRange>(30);
  const nowTime = now.getTime();
  const snapshot = useMemo(
    () => deriveLearningInsightSnapshot({ attempts, knowledgeEntries, mistakes, now: new Date(nowTime), range }),
    [attempts, knowledgeEntries, mistakes, nowTime, range],
  );

  return (
    <section className={styles.workspace} aria-label="薄弱分析">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>薄弱分析</h2>
          <p className={styles.description}>正确率仅来自已保存复盘；少于 5 次的板块不会判断趋势。</p>
        </div>
        <div className={styles.ranges} aria-label="分析时间范围">
          {rangeOptions.map((option) => (
            <button key={String(option.value)} aria-pressed={range === option.value} type="button" onClick={() => setRange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.summary}>
        <div className={styles.metric}><span>有效复盘</span><strong>{snapshot.attemptsCount}</strong></div>
        <div className={styles.metric}><span>复盘正确率</span><strong>{snapshot.correctRate === null ? "--" : `${snapshot.correctRate}%`}</strong></div>
        <div className={styles.metric}><span>当前到期</span><strong>{snapshot.dueCount}</strong></div>
        <div className={styles.metric}><span>数据不足板块</span><strong>{snapshot.insufficientBoards}</strong></div>
      </div>

      <section className={`${styles.panel} ${styles.trendPanel}`}>
        <div className={styles.sectionHeader}><h3>复盘正确率趋势</h3><p>按实际复盘日期聚合</p></div>
        {snapshot.trend.length ? (
          <div className={styles.trend} aria-label="复盘正确率趋势图">
            {snapshot.trend.map((point) => (
              <div
                key={point.date}
                className={styles.trendBar}
                style={{ height: `${Math.max(10, point.correctRate)}%` }}
                title={`${point.date}：${point.correctRate}%（${point.reviewed} 次）`}
              >
                <span>{point.date.slice(5)}</span>
              </div>
            ))}
          </div>
        ) : <div className={styles.emptyChart}>当前时间范围内还没有有效复盘。</div>}
      </section>

      <section className={`${styles.panel} ${styles.tablePanel}`}>
        <div className={styles.sectionHeader}><h3>板块证据</h3><p>掌握度为当前错题快照，不作为历史趋势</p></div>
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead><tr><th>板块</th><th>完成复盘</th><th>正确率</th><th>当前掌握度</th><th>到期</th><th>趋势</th></tr></thead>
            <tbody>
              {snapshot.boards.map((row) => (
                <tr key={row.board}>
                  <td><strong>{row.board}</strong></td>
                  <td>{row.reviewed}</td>
                  <td>{row.correctRate === null ? "--" : `${row.correctRate}%`}</td>
                  <td>{row.mastery === null ? "--" : `${row.mastery} / 5`}</td>
                  <td>{row.dueCount}</td>
                  <td className={!row.sufficient ? styles.insufficient : undefined}>
                    {row.sufficient && row.trend ? trendLabels[row.trend] : "数据不足"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.priorityPanel}`}>
        <div className={styles.sectionHeader}><h3>优先改进项</h3><p>仅依据低掌握度与到期状态排序</p></div>
        <div className={styles.priorityList}>
          {snapshot.priorityMistakes.map((mistake) => (
            <article key={mistake.id} className={styles.priorityRow}>
              <div className="min-w-0"><strong>{mistake.board} · {mistake.stem}</strong><small>掌握度 {mistake.mastery} · {mistake.nextReviewAt} 复盘</small></div>
              <div className={styles.actions}><Button size="sm" variant="primary" onClick={() => onOpenReview(mistake.id)}>进入复盘</Button></div>
            </article>
          ))}
          {snapshot.priorityKnowledge.map((entry) => (
            <article key={entry.id} className={styles.priorityRow}>
              <div className="min-w-0"><strong>{entry.category} · {entry.title}</strong><small>掌握度 {entry.mastery} · {entry.nextReviewAt} 训练</small></div>
              <div className={styles.actions}><Button size="sm" variant="soft" onClick={() => onOpenKnowledgeTraining(entry.id)}>知识训练</Button></div>
            </article>
          ))}
          {!snapshot.priorityMistakes.length && !snapshot.priorityKnowledge.length ? <EmptyState>暂无可排序的薄弱项</EmptyState> : null}
        </div>
      </section>
    </section>
  );
}
