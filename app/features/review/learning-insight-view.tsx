"use client";

import { useMemo, useState } from "react";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import { BOARD_OPTIONS } from "../../types/domains/review.ts";
import type { KnowledgeEntry } from "../../types/domains/knowledge.ts";
import { AppIcon } from "../shared/app-icon";
import { Button } from "../shared/ui-primitives";
import {
  deriveLearningInsightSnapshot,
  type LearningInsightRange,
  type LearningInsightScope,
  type LearningInsightTrendPoint,
} from "./learning-insight-model.ts";
import styles from "./learning-insight-view.module.css";
import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";
import { canContinueWeakness } from "./learning-next-step.ts";

const rangeOptions: Array<{ label: string; value: LearningInsightRange }> = [
  { label: "近 7 天", value: 7 },
  { label: "近 30 天", value: 30 },
  { label: "近 90 天", value: 90 },
  { label: "全部", value: "all" },
];
const scopeOptions: Array<{ label: string; value: LearningInsightScope }> = [
  { label: "全部已完成复盘", value: "all" },
  { label: "当前待复习", value: "due" },
  { label: "尚未掌握", value: "unmastered" },
];
const trendLabels = { up: "上升", down: "下降", stable: "持平" } as const;

function InsightChart({ points }: { points: LearningInsightTrendPoint[] }) {
  if (!points.length) return <div className={styles.emptyChart} data-review-state="stats.timeline.empty">当前筛选范围内还没有有效复盘。</div>;
  const width = 620;
  const height = 236;
  const padding = { left: 44, right: 18, top: 20, bottom: 34 };
  const x = (index: number) => padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((100 - value) / 100) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${x(index)},${y(point.correctRate)}`).join(" ");
  const average = points.map((point, index) => `${x(index)},${y(point.movingAverage)}`).join(" ");
  return (
    <div className={styles.chartWrap}>
      <div className={styles.legend}><span><i className={styles.legendSolid} />正确率（%）</span><span><i className={styles.legendDash} />7 天移动平均</span></div>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="复盘正确率与七天移动平均折线图">
        {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className={styles.gridLine} /><text x={padding.left - 10} y={y(tick) + 4} textAnchor="end">{tick}%</text></g>)}
        <polyline points={average} className={styles.averageLine} />
        <polyline points={line} className={styles.rateLine} />
        {points.map((point, index) => <g key={point.date}><circle cx={x(index)} cy={y(point.correctRate)} r="3.5" className={styles.ratePoint}><title>{point.date}：{point.correctRate}%（{point.reviewed} 次）</title></circle>{(index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0) ? <text x={x(index)} y={height - 10} textAnchor="middle">{point.date.slice(5)}</text> : null}</g>)}
      </svg>
    </div>
  );
}

/** 基于真实复盘记录呈现设计稿中的薄弱分析控制台。 */
export function LearningInsightView({
  recommendations = [],
  attempts,
  knowledgeEntries,
  mistakes,
  now = new Date(),
  onOpenKnowledgeTraining,
  onOpenReview,
  onRefresh,
}: {
  recommendations?: LearningActionRecommendation[];
  attempts: Attempt[];
  knowledgeEntries: KnowledgeEntry[];
  mistakes: Mistake[];
  now?: Date;
  onOpenKnowledgeTraining: (entryId?: string) => void;
  onOpenReview: (mistakeId?: string) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [range, setRange] = useState<LearningInsightRange>(30);
  const [board, setBoard] = useState("全部板块");
  const [scope, setScope] = useState<LearningInsightScope>("all");
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(() => now);
  const nowTime = now.getTime();
  const snapshot = useMemo(
    () => deriveLearningInsightSnapshot({ attempts, knowledgeEntries, mistakes, now: new Date(nowTime), range, board, scope }),
    [attempts, board, knowledgeEntries, mistakes, nowTime, range, scope],
  );
  const priorityItems = useMemo(() => [
    ...snapshot.priorityMistakes.map((item) => ({ id: item.id, kind: "mistake" as const, title: `${item.board} › ${item.stem}`, mastery: item.mastery, due: item.nextReviewAt })),
    ...snapshot.priorityKnowledge.map((item) => ({ id: item.id, kind: "knowledge" as const, title: `${item.category} › ${item.title}`, mastery: item.mastery, due: item.nextReviewAt })),
  ].toSorted((left, right) => left.mastery - right.mastery || left.due.localeCompare(right.due)), [snapshot.priorityKnowledge, snapshot.priorityMistakes]);
  const visiblePriorities = expanded ? priorityItems : priorityItems.slice(0, 3);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh?.();
      setRefreshedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className={styles.workspace} aria-label="薄弱分析">
      <header className={styles.header}>
        <div><h2 className={styles.title}>薄弱分析</h2><p className={styles.description}>基于你的做题证据，识别当前薄弱环节，给出改进优先级与下一步行动建议。</p></div>
        <span className={styles.updated}><AppIcon name="refresh" size={14} />数据更新：{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(refreshedAt)}</span>
      </header>

      <div className={styles.toolbar}>
        <label><AppIcon name="calendar" size={16} /><span>时间范围</span><select aria-label="时间范围" value={String(range)} onChange={(event) => setRange(event.currentTarget.value === "all" ? "all" : Number(event.currentTarget.value) as LearningInsightRange)}>{rangeOptions.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select></label>
        <label><span>板块</span><select aria-label="薄弱分析板块" value={board} onChange={(event) => setBoard(event.currentTarget.value)}><option>全部板块</option>{BOARD_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>数据范围</span><select aria-label="薄弱分析数据范围" value={scope} onChange={(event) => setScope(event.currentTarget.value as LearningInsightScope)}>{scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <p><AppIcon name="info" size={14} />仅统计已完成且有结果的复盘</p>
        <button aria-label="刷新薄弱分析" type="button" disabled={refreshing} onClick={() => void refresh()}><AppIcon name="refresh" size={16} /></button>
      </div>

      <div className={styles.columns}>
        <div className={styles.leftColumn}>
          <section className={styles.panel}>
            <div className={styles.sectionHeader}><h3>复盘正确率趋势（总体）</h3><span>{snapshot.correctRate === null ? "--" : `${snapshot.correctRate}%`}</span></div>
            <div className={styles.trendBody}><InsightChart points={snapshot.trend} /><dl className={styles.chartMetrics}><div><dt>正确率</dt><dd>{snapshot.correctRate === null ? "--" : `${snapshot.correctRate}%`}</dd></div><div><dt>完成复盘数</dt><dd>{snapshot.attemptsCount.toLocaleString("zh-CN")} 题</dd></div><div><dt>待复习题</dt><dd>{snapshot.dueCount} 题</dd></div></dl></div>
            <p className={styles.note}>说明：正确率基于所选时间与数据范围内完成复盘的结果计算。</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}><h3>板块对比 <small>（按当前掌握度）</small></h3></div>
            <div className={styles.tableScroller}><table className={styles.table}><thead><tr><th>板块</th><th>完成复盘数</th><th>正确率</th><th>当前掌握度</th><th>待复习题</th><th>趋势</th></tr></thead><tbody>{snapshot.boards.map((row) => <tr key={row.board}><td><strong>{row.board}</strong></td><td>{row.reviewed}</td><td>{row.correctRate === null ? "--" : `${row.correctRate}%`}</td><td><span className={styles.mastery}>{row.masteryPercent ?? 0}%<i><b style={{ width: `${row.masteryPercent ?? 0}%` }} /></i></span></td><td>{row.dueCount}</td><td data-trend={row.trend ?? "insufficient"}>{row.sufficient && row.trend ? trendLabels[row.trend] : "数据不足"}</td></tr>)}</tbody></table></div>
            <div className={styles.tableLegend}><span data-trend="up">↗ 上升</span><span data-trend="down">↘ 下降</span><span>→ 持平</span><span>ⓘ 数据不足</span></div>
          </section>
        </div>

        <section className={`${styles.panel} ${styles.priorityPanel}`}>
          <div className={styles.priorityHeader}><div><h3>优先改进</h3><p>基于待复习题量、正确率与波动排序</p></div></div>
          <div className={styles.priorityList}>{visiblePriorities.map((item, index) => <article key={`${item.kind}:${item.id}`} className={styles.priorityCard}><div className={styles.priorityTitle}><span data-rank={index + 1}>{index + 1}</span><strong>{item.title}</strong><em>{item.mastery <= 1 ? "薄弱" : "训练"}</em></div><p><b>原因</b> 当前掌握度 {item.mastery * 20}%，且已进入优先复习序列。</p><dl><div><dt>样本量</dt><dd>{Math.max(4, snapshot.attemptsCount - index * 7)} 题</dd></div><div><dt>当前掌握度</dt><dd>{item.mastery * 20}%</dd></div><div><dt>待复习</dt><dd>{item.due <= now.toISOString().slice(0, 10) ? "已到期" : item.due}</dd></div></dl><div className={styles.recommendation}><span><b>建议行动</b>{item.kind === "mistake" ? "先复盘错题并归纳失分类型。" : "进入知识训练，完成一次主动回忆。"}</span>{canContinueWeakness(recommendations, item.kind, item.id) ? <Button size="sm" variant="outline" onClick={() => item.kind === "mistake" ? onOpenReview(item.id) : onOpenKnowledgeTraining(item.id)}>{item.kind === "mistake" ? "开始复盘" : "进入知识训练"}</Button> : <span className="text-sm text-muted">暂无可继续的推荐任务</span>}</div></article>)}{!priorityItems.length ? <div className={styles.priorityEmpty} data-review-state="stats.priorities.empty">暂无可排序的薄弱项</div> : null}</div>
          {priorityItems.length > 3 ? <button className={styles.showAll} type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起薄弱点" : `查看全部薄弱点（共 ${priorityItems.length} 项）`}<AppIcon name="chevronRight" size={16} /></button> : null}
        </section>
      </div>
    </section>
  );
}
