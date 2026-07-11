import type { ReactNode } from "react";
import { Button, CardButton, Chip, DataList, DataRow, EmptyState, MasteryDots, MetricCard, Panel, StatGrid } from "../shared/ui-primitives";
import type { BoardStat } from "../../lib/review-selectors";
import type { Board, KnowledgeCategory, KnowledgeCategorySummary, KnowledgeEntry, Mistake } from "../../types/review";
import { studyDomainDefinitions } from "../study/study-registry";

const colors = ["#2f6fed", "#1a9b71", "#d79018", "#d45145", "#7a5bd4", "#1c8c9a"];
const civilServiceDomain = studyDomainDefinitions[0]!;

type DashboardViewProps = {
  avgMastery: string;
  automationActiveCount: number;
  automationUnreadCount: number;
  boardStats: BoardStat[];
  configurationHealth?: ReactNode;
  correctRate: number;
  dueKnowledgeEntries: KnowledgeEntry[];
  dueMistakes: Mistake[];
  importDraftCount: number;
  importJobCount: number;
  knowledgeCategorySummaries: KnowledgeCategorySummary[];
  knowledgeCorrectRate: number;
  lowMistakes: Mistake[];
  obsidianConnected: boolean;
  pendingProposalCount: number;
  onOpenAutomation: () => void;
  onCreateKnowledgeStarterDrafts: (category?: KnowledgeCategory) => void;
  onOpenBoard: (board: Board) => void;
  onOpenImport: () => void;
  onOpenKnowledge: () => void;
  onOpenKnowledgeCategory: (category: KnowledgeCategory) => void;
  onOpenKnowledgeTraining: (entryId?: string) => void;
  onOpenInterview: () => void;
  onOpenReview: (id: string) => void;
  onOpenReviewQueue: () => void;
  onOpenTutoring: () => void;
};

// 渲染总览页，包括指标、六大板块概览和今日复盘队列；这里只消费派生数据，不直接读取仓储。
export function DashboardView({
  avgMastery,
  automationActiveCount,
  automationUnreadCount,
  boardStats,
  configurationHealth,
  correctRate,
  dueKnowledgeEntries,
  dueMistakes,
  importDraftCount,
  importJobCount,
  knowledgeCategorySummaries,
  knowledgeCorrectRate,
  lowMistakes,
  obsidianConnected,
  pendingProposalCount,
  onOpenAutomation,
  onCreateKnowledgeStarterDrafts,
  onOpenBoard,
  onOpenImport,
  onOpenKnowledge,
  onOpenKnowledgeCategory,
  onOpenKnowledgeTraining,
  onOpenInterview,
  onOpenReview,
  onOpenReviewQueue,
  onOpenTutoring,
}: DashboardViewProps) {
  const knowledgeTotal = knowledgeCategorySummaries.reduce((total, item) => total + item.total, 0);
  const flowActions: Record<string, () => void> = {
    import: onOpenImport,
    mistake: onOpenReviewQueue,
    knowledge: onOpenKnowledge,
    training: () => onOpenKnowledgeTraining(),
    tutoring: onOpenTutoring,
    scheduled: onOpenAutomation,
    obsidian: onOpenKnowledge,
  };
  const flowMeta: Record<string, { count: string; tone: "blue" | "green" | "yellow" | "red" | "neutral" }> = {
    import: {
      count: importDraftCount ? `${importDraftCount} 条草稿待确认` : importJobCount ? `${importJobCount} 个导入批次` : "可从粉笔插件开始",
      tone: importDraftCount ? "yellow" : "blue",
    },
    mistake: { count: `${dueMistakes.length} 道到期`, tone: dueMistakes.length ? "yellow" : "green" },
    knowledge: { count: `${knowledgeTotal} 条资料`, tone: knowledgeTotal ? "green" : "yellow" },
    training: { count: `${dueKnowledgeEntries.length} 条待训`, tone: dueKnowledgeEntries.length ? "yellow" : "green" },
    tutoring: { count: "多模态辅导入口", tone: "blue" },
    scheduled: { count: automationUnreadCount ? `${automationUnreadCount} 条未读` : `${automationActiveCount} 个启用任务`, tone: automationUnreadCount ? "yellow" : automationActiveCount ? "green" : "neutral" },
    obsidian: { count: pendingProposalCount ? `${pendingProposalCount} 条提案待确认` : obsidianConnected ? "Vault 已连接" : "待连接 Vault", tone: pendingProposalCount ? "yellow" : obsidianConnected ? "green" : "neutral" },
  };

  return (
    <section className="space-y-4">
      {configurationHealth}

      <Panel title="公考学习链路" eyebrow="Study Flow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-3xl text-sm leading-6 text-muted">{civilServiceDomain.dashboard.headline}</p>
          <div className="flex flex-wrap gap-2">
            {civilServiceDomain.dashboard.defaultNextActions.map((action) => <Chip key={action} tone="blue">{action}</Chip>)}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {civilServiceDomain.dashboard.flow.map((step, index) => {
            const meta = flowMeta[step.id] ?? { count: "待处理", tone: "neutral" as const };
            return (
              <button
                key={step.id}
                className="grid min-h-36 rounded-lg border border-line bg-surface-muted p-4 text-left transition hover:border-blue/40 hover:bg-blue/5"
                type="button"
                onClick={flowActions[step.id]}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <small className="text-xs font-semibold text-muted">{String(index + 1).padStart(2, "0")}</small>
                    <strong className="mt-1 block">{step.label}</strong>
                  </span>
                  <Chip tone={meta.tone}>{meta.count}</Chip>
                </span>
                <span className="mt-3 text-sm leading-6 text-muted">{step.description}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <StatGrid>
        <MetricCard label="今日待复盘" value={dueMistakes.length} hint="按到期和薄弱度排序" tone="text-blue" />
        <MetricCard label="今日知识训练" value={dueKnowledgeEntries.length} hint={`历史正确率 ${knowledgeCorrectRate}%`} tone="text-blue" />
        <MetricCard label="薄弱错题" value={lowMistakes.length} hint="掌握度 1-2 的题" tone="text-red" />
        <MetricCard label="平均掌握度" value={avgMastery} hint="满分 5 分" tone="text-green" />
        <MetricCard label="复盘正确率" value={`${correctRate}%`} hint="基于历史复盘记录" tone="text-yellow" />
      </StatGrid>

      <Panel title="六大板块概览" eyebrow="Board Overview">
        <div className="ui-card-grid">
          {boardStats.map((item, index) => (
            <CardButton key={item.board} className="grid min-h-28" onClick={() => onOpenBoard(item.board)}>
              <span className="flex items-center justify-between gap-3">
                <strong className="text-lg">{item.board}</strong>
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: colors[index % colors.length] }} />
              </span>
              <span className="mt-4 grid grid-cols-3 gap-2 text-sm text-muted">
                <span>
                  <b className="block text-xl text-foreground">{item.total}</b>总数
                </span>
                <span>
                  <b className="block text-xl text-blue">{item.due}</b>待复盘
                </span>
                <span>
                  <b className="block text-xl text-red">{item.weak}</b>薄弱
                </span>
              </span>
            </CardButton>
          ))}
        </div>
      </Panel>

      <Panel title="三类知识中枢" eyebrow="Knowledge Hub">
        <div className="ui-card-grid">
          {knowledgeCategorySummaries.map((item) => (
            <article key={item.category} className="ui-card ui-card-muted grid gap-4 text-left transition hover:border-blue/40 hover:bg-blue/5">
              <button className="text-left" type="button" onClick={() => onOpenKnowledgeCategory(item.category)}>
                <strong className="text-lg">{item.category}</strong>
              </button>
              <span className="grid grid-cols-4 gap-2 text-sm text-muted">
                <span>
                  <b className="block text-xl text-foreground">{item.total}</b>资料
                </span>
                <span>
                  <b className="block text-xl text-blue">{item.due}</b>待训
                </span>
                <span>
                  <b className="block text-xl text-red">{item.weak}</b>薄弱
                </span>
                <span>
                  <b className="block text-xl text-yellow">{item.favorites}</b>收藏
                </span>
              </span>
              <Button size="sm" variant="outline" onClick={() => onCreateKnowledgeStarterDrafts(item.category)}>
                生成模板草稿
              </Button>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="面试训练" eyebrow="Interview Practice">
        <div className="grid gap-3 md:grid-cols-2">
          <CardButton className="grid gap-3 text-left" onClick={onOpenInterview}>
            <span className="flex items-center justify-between gap-3">
              <strong className="text-lg">线上模拟与复盘</strong>
              <Chip tone="blue">三类场景</Chip>
            </span>
            <span className="text-sm leading-6 text-muted">
              覆盖结构化面试、结构化小组和无领导小组三类训练，支持语音转写兜底文字输入，并在结束后生成评分与改进建议。
            </span>
            <span className="text-sm font-semibold text-blue">进入面试训练</span>
          </CardButton>
          <CardButton className="grid gap-3 text-left" onClick={onOpenTutoring}>
            <span className="flex items-center justify-between gap-3">
              <strong className="text-lg">对话辅导</strong>
              <Chip tone="green">工具化</Chip>
            </span>
            <span className="text-sm leading-6 text-muted">
              在新对话中按需打开摄像头、屏幕共享、截图和知识检索；原始画面只保留在当前浏览器内存。
            </span>
            <span className="text-sm font-semibold text-blue">开始对话辅导</span>
          </CardButton>
        </div>
      </Panel>

      <div className="ui-content-grid">
        <Panel title="今日队列" eyebrow="Review Queue">
          <DataList>
            {dueMistakes.length ? (
              dueMistakes.slice(0, 5).map((item) => (
                <DataRow key={item.id}>
                  <div className="min-w-0">
                    <strong className="block truncate">{item.stem}</strong>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip tone="blue">{item.board}</Chip>
                      <Chip>{item.reasons[0] ?? "待归因"}</Chip>
                      <Chip tone="yellow">掌握度 {item.mastery}</Chip>
                    </div>
                  </div>
                  <Button size="sm" type="button" variant="soft" onClick={() => onOpenReview(item.id)}>
                    复盘
                  </Button>
                </DataRow>
              ))
            ) : (
              <EmptyState>今天没有到期错题</EmptyState>
            )}
          </DataList>
        </Panel>

        <div className="space-y-4">
          <Panel title="知识训练队列" eyebrow="Knowledge Drill">
            <DataList>
              {dueKnowledgeEntries.length ? (
                dueKnowledgeEntries.slice(0, 4).map((entry) => (
                  <DataRow key={entry.id}>
                    <div className="min-w-0">
                      <strong className="block truncate">{entry.title}</strong>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip tone="blue">{entry.category}</Chip>
                        <Chip tone="yellow">掌握度 {entry.mastery}</Chip>
                        <MasteryDots value={entry.mastery} />
                      </div>
                    </div>
                    <Button size="sm" type="button" variant="soft" onClick={() => onOpenKnowledgeTraining(entry.id)}>
                      训练
                    </Button>
                  </DataRow>
                ))
              ) : (
                <EmptyState>今天没有到期知识资料</EmptyState>
              )}
            </DataList>
          </Panel>

          <Panel title="薄弱板块" eyebrow="Weak Spots">
            <DataList>
              {boardStats.some((item) => item.weak > 0) ? (
                boardStats
                  .filter((item) => item.weak > 0)
                  .sort((a, b) => b.weak - a.weak)
                  .map((item, index) => {
                    const maxWeak = Math.max(1, ...boardStats.map((stat) => stat.weak));
                    return (
                      <div key={item.board} className="grid grid-cols-[130px_minmax(0,1fr)_42px] items-center gap-3 text-sm">
                        <strong className="truncate">{item.board}</strong>
                        <div className="ui-meter-track">
                          <span className="block h-full rounded-full" style={{ width: `${(item.weak / maxWeak) * 100}%`, background: colors[index % colors.length] }} />
                        </div>
                        <span>{item.weak}</span>
                      </div>
                    );
                  })
              ) : (
                <EmptyState>暂无薄弱板块</EmptyState>
              )}
            </DataList>
          </Panel>
        </div>
      </div>
    </section>
  );
}
