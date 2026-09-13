"use client";

import { useMemo, useState } from "react";
import { isStudyDayDue } from "../../lib/study-day.ts";
import { masteryLevelToScore } from "../../lib/weakness-intelligence.ts";
import type { Attempt, Mistake } from "../../types/domains/review.ts";
import { BOARD_OPTIONS } from "../../types/domains/review.ts";
import type { KnowledgeAttempt, KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { LearnerStateSnapshot, LearningActionRecommendation } from "../../types/domains/learner-state.ts";
import { AppIcon } from "../shared/app-icon";
import { Button, MetricCard, StatGrid } from "../shared/ui-primitives";
import {
  deriveLearningInsightSnapshot,
  selectLearningInsightSignals,
  type LearningInsightOutcomeMetrics,
  type LearningInsightRange,
  type LearningInsightScope,
  type LearningInsightTrendPoint,
} from "./learning-insight-model.ts";
import styles from "./learning-insight-view.module.css";
import { canContinueWeakness } from "./learning-next-step.ts";

const rangeOptions: Array<{ label: string; value: LearningInsightRange }> = [
  { label: "近 7 天", value: 7 }, { label: "近 30 天", value: 30 }, { label: "近 90 天", value: 90 }, { label: "全部", value: "all" },
];
const scopeOptions: Array<{ label: string; value: LearningInsightScope }> = [
  { label: "全部已完成复盘", value: "all" }, { label: "当前待复习", value: "due" }, { label: "尚未掌握", value: "unmastered" },
];
const trendLabels = { up: "上升", down: "下降", stable: "持平" } as const;
const resultLabels = { correct: "答对", uncertain: "不确定", wrong: "答错" } as const;
const emptyMetrics: LearningInsightOutcomeMetrics = { attemptCount: 0, correctCount: 0, uncertainCount: 0, wrongCount: 0, correctRate: null, latestResult: null, latestReviewedAt: null };

function displayRate(value: number | null) { return value === null ? "数据不足" : `${value}%`; }
function displayResult(value: LearningInsightOutcomeMetrics["latestResult"]) { return value ? resultLabels[value] : "数据不足"; }

function InsightChart({ points }: { points: LearningInsightTrendPoint[] }) {
  if (!points.length) return <div className={styles.emptyChart} data-review-state="stats.timeline.empty">当前筛选范围内还没有有效复盘。</div>;
  const width = 620; const height = 236; const padding = { left: 44, right: 18, top: 20, bottom: 34 };
  const x = (index: number) => padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + ((100 - value) / 100) * (height - padding.top - padding.bottom);
  const line = points.map((point, index) => `${x(index)},${y(point.correctRate)}`).join(" ");
  const average = points.map((point, index) => `${x(index)},${y(point.movingAverage)}`).join(" ");
  return <div className={styles.chartWrap}>
    <div className={styles.legend}><span><i className={styles.legendSolid} />正确率（%）</span><span><i className={styles.legendDash} />7 天加权移动平均</span></div>
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="复盘正确率与七天加权移动平均折线图">
      {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className={styles.gridLine} /><text x={padding.left - 10} y={y(tick) + 4} textAnchor="end">{tick}%</text></g>)}
      <polyline points={average} className={styles.averageLine} /><polyline points={line} className={styles.rateLine} />
      {points.map((point, index) => <g key={point.date}><circle cx={x(index)} cy={y(point.correctRate)} r="3.5" className={styles.ratePoint}><title>{point.date}：{point.correctRate}%（{point.reviewed} 次）</title></circle>{(index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0) ? <text x={x(index)} y={height - 10} textAnchor="middle">{point.date.slice(5)}</text> : null}</g>)}
    </svg>
  </div>;
}

/** 基于真实复盘记录呈现描述性学习效果与薄弱分析。 */
export function LearningInsightView({
  recommendations = [], attempts, knowledgeAttempts, knowledgeEntries, learnerState, mistakes, now = new Date(), onOpenKnowledgeTraining, onOpenReview, onRefresh,
}: {
  recommendations?: LearningActionRecommendation[];
  attempts: Attempt[];
  knowledgeAttempts: KnowledgeAttempt[];
  knowledgeEntries: KnowledgeEntry[];
  learnerState: LearnerStateSnapshot;
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
  const snapshot = useMemo(() => deriveLearningInsightSnapshot({ attempts, knowledgeAttempts, knowledgeEntries, mistakes, now: new Date(nowTime), range, board, scope }), [attempts, board, knowledgeAttempts, knowledgeEntries, mistakes, nowTime, range, scope]);
  const signals = selectLearningInsightSignals(learnerState);
  const priorityItems = useMemo(() => [
    ...snapshot.priorityMistakes.map((item) => ({ id: item.id, kind: "mistake" as const, title: `${item.board} › ${item.stem}`, mastery: item.mastery, due: item.nextReviewAt, metrics: snapshot.mistakeMetrics.get(item.id) ?? emptyMetrics })),
    ...snapshot.priorityKnowledge.map((item) => ({ id: item.id, kind: "knowledge" as const, title: `${item.category} › ${item.title}`, mastery: item.mastery, due: item.nextReviewAt, metrics: snapshot.knowledgeMetrics.get(item.id) ?? emptyMetrics })),
  ].toSorted((left, right) => left.mastery - right.mastery || left.due.localeCompare(right.due) || left.id.localeCompare(right.id)), [snapshot]);
  const visiblePriorities = expanded ? priorityItems : priorityItems.slice(0, 3);

  async function refresh() {
    setRefreshing(true);
    try { await onRefresh?.(); setRefreshedAt(new Date()); } finally { setRefreshing(false); }
  }

  return <section className={styles.workspace} aria-label="薄弱分析">
    <header className={styles.header}><div><h2 className={styles.title}>薄弱分析</h2><p className={styles.description}>基于可观察的复盘结果，呈现当前学习状态、跨日恢复证据与薄弱信号。</p></div><span className={styles.updated}><AppIcon name="refresh" size={14} />数据更新：{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(refreshedAt)}</span></header>
    <div className={styles.toolbar}>
      <label><AppIcon name="calendar" size={16} /><span>时间范围</span><select aria-label="时间范围" value={String(range)} onChange={(event) => setRange(event.currentTarget.value === "all" ? "all" : Number(event.currentTarget.value) as LearningInsightRange)}>{rangeOptions.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select></label>
      <label><span>板块</span><select aria-label="薄弱分析板块" value={board} onChange={(event) => setBoard(event.currentTarget.value)}><option>全部板块</option>{BOARD_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>数据范围</span><select aria-label="薄弱分析数据范围" value={scope} onChange={(event) => setScope(event.currentTarget.value as LearningInsightScope)}>{scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <p><AppIcon name="info" size={14} />仅统计已完成且有结果的复盘</p><button aria-label="刷新薄弱分析" type="button" disabled={refreshing} onClick={() => void refresh()}><AppIcon name="refresh" size={16} /></button>
    </div>
    <section aria-label="学习效果摘要"><StatGrid>
      <MetricCard label="复盘答对率" value={displayRate(snapshot.correctRate)} hint="当前范围" tone="text-muted" />
      <MetricCard label="完成复盘" value={`${snapshot.attemptsCount} 次`} hint={`答对 ${snapshot.correctCount} · 不确定 ${snapshot.uncertainCount} · 答错 ${snapshot.wrongCount}`} tone="text-muted" />
      <MetricCard label="学习日期" value={`${snapshot.distinctStudyDays} 天`} hint="按有效复盘日期去重" tone="text-muted" />
      <MetricCard label="跨日复习通过率" value={displayRate(snapshot.spacedCorrectRate)} hint={snapshot.spacedAttemptCount ? `基于 ${snapshot.spacedAttemptCount} 次跨日复习` : "没有跨日复习证据"} tone="text-muted" />
      <MetricCard label="恢复证据" value={`${snapshot.recoveredSubjectCount} 项`} hint="跨日失败后答对且当前未到期" tone="text-muted" />
    </StatGrid></section>
    <div className={styles.columns}>
      <div className={styles.leftColumn}>
        <section className={styles.panel}><div className={styles.sectionHeader}><h3>复盘正确率趋势（总体）</h3><span>{displayRate(snapshot.correctRate)}</span></div><div className={styles.trendBody}><InsightChart points={snapshot.trend} /><dl className={styles.chartMetrics}><div><dt>复盘答对率</dt><dd>{displayRate(snapshot.correctRate)}</dd></div><div><dt>学习日期</dt><dd>{snapshot.distinctStudyDays} 天</dd></div><div><dt>待复习项</dt><dd>{snapshot.dueCount} 项</dd></div></dl></div><p className={styles.note}>说明：正确率基于所选时间、板块与数据范围内的真实复盘结果；跨日通过率只统计有更早学习日的同题复盘。</p></section>
        <section className={styles.panel}><div className={styles.sectionHeader}><h3>板块对比 <small>（当前掌握度）</small></h3></div><div className={styles.tableScroller}><table className={styles.table}><thead><tr><th>板块</th><th>完成复盘数</th><th>正确率</th><th>当前掌握度</th><th>待复习题</th><th>趋势</th></tr></thead><tbody>{snapshot.boards.map((row) => <tr key={row.board}><td><strong>{row.board}</strong></td><td>{row.reviewed}</td><td>{displayRate(row.correctRate)}</td><td><span className={styles.mastery}><span>{row.mastery === null ? "数据不足" : `平均 ${row.mastery}/5`}</span><small>派生掌握分 {row.masteryScore === null ? "数据不足" : `${row.masteryScore}/100`}</small><i><b style={{ width: `${row.masteryScore ?? 0}%` }} /></i></span></td><td>{row.dueCount}</td><td data-trend={row.trend ?? "insufficient"}>{row.sufficient && row.trend ? trendLabels[row.trend] : "数据不足"}</td></tr>)}</tbody></table></div><div className={styles.tableLegend}><span data-trend="up">↗ 上升</span><span data-trend="down">↘ 下降</span><span>→ 持平</span><span>ⓘ 数据不足</span></div></section>
        <section className={styles.panel}><div className={styles.sectionHeader}><h3>当前薄弱与错因</h3><span>来自当前学习状态证据</span></div>{signals.length ? <div className={styles.priorityList}>{signals.map((signal) => <article className={styles.priorityCard} key={signal.id}><div className={styles.priorityTitle}><strong>{signal.title}</strong></div><p><b>证据 {signal.evidence.length} 条</b>{signal.summary}</p></article>)}</div> : <div className={styles.priorityEmpty}>当前没有可展示的薄弱或错因信号</div>}<p className={styles.note}>证据条数是本地证据引用数量，不代表样本显著性；信号分数不在此处解释为掌握度或概率。</p></section>
      </div>
      <section className={`${styles.panel} ${styles.priorityPanel}`}><div className={styles.priorityHeader}><div><h3>当前薄弱项</h3><p>按当前掌握度与复习日期排序</p></div></div><div className={styles.priorityList}>{visiblePriorities.map((item, index) => <article key={`${item.kind}:${item.id}`} className={styles.priorityCard}><div className={styles.priorityTitle}><span data-rank={index + 1}>{index + 1}</span><strong>{item.title}</strong><em>{item.mastery <= 1 ? "薄弱" : "训练"}</em></div><p><b>本项证据</b>{item.metrics.attemptCount ? `本范围完成 ${item.metrics.attemptCount} 次，答对率 ${displayRate(item.metrics.correctRate)}。` : `暂无${item.kind === "knowledge" ? "训练" : "复盘"}记录。`}{item.metrics.latestResult ? `最近结果：${displayResult(item.metrics.latestResult)}。` : ""}</p><dl><div><dt>当前掌握度</dt><dd>{item.mastery}/5</dd></div><div><dt>派生掌握分</dt><dd>{masteryLevelToScore(item.mastery)}/100</dd></div><div><dt>下次复习</dt><dd>{isStudyDayDue(item.due, now) ? "已到期" : item.due}</dd></div></dl><div className={styles.recommendation}><span><b>建议行动</b>{item.kind === "mistake" ? "先复盘错题并归纳失分类型。" : "进入知识训练，完成一次主动回忆。"}</span>{canContinueWeakness(recommendations, item.kind, item.id) ? <Button size="sm" variant="outline" onClick={() => item.kind === "mistake" ? onOpenReview(item.id) : onOpenKnowledgeTraining(item.id)}>{item.kind === "mistake" ? "开始复盘" : "进入知识训练"}</Button> : <span className="text-sm text-muted">暂无可继续的推荐任务</span>}</div></article>)}{!priorityItems.length ? <div className={styles.priorityEmpty} data-review-state="stats.priorities.empty">暂无可排序的薄弱项</div> : null}</div>{priorityItems.length > 3 ? <button className={styles.showAll} type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起薄弱点" : `查看全部薄弱点（共 ${priorityItems.length} 项）`}<AppIcon name="chevronRight" size={16} /></button> : null}</section>
    </div>
  </section>;
}
