import { Button, CardButton, Chip, DataList, DataRow, EmptyState, MasteryDots, MetricCard, Panel, StatGrid } from "../shared/ui-primitives";
import type { BoardStat } from "../../lib/review-selectors";
import type { Board, KnowledgeCategory, KnowledgeCategorySummary, KnowledgeEntry, Mistake } from "../../types/review";

const colors = ["#2f6fed", "#1a9b71", "#d79018", "#d45145", "#7a5bd4", "#1c8c9a"];

type DashboardViewProps = {
  avgMastery: string;
  boardStats: BoardStat[];
  correctRate: number;
  dueKnowledgeEntries: KnowledgeEntry[];
  dueMistakes: Mistake[];
  knowledgeCategorySummaries: KnowledgeCategorySummary[];
  knowledgeCorrectRate: number;
  lowMistakes: Mistake[];
  onCreateKnowledgeStarterDrafts: (category?: KnowledgeCategory) => void;
  onOpenBoard: (board: Board) => void;
  onOpenKnowledgeCategory: (category: KnowledgeCategory) => void;
  onOpenKnowledgeTraining: (entryId?: string) => void;
  onOpenInterview: () => void;
  onOpenReview: (id: string) => void;
  onOpenTutoring: () => void;
};

// 渲染总览页，包括指标、六大板块概览和今日复盘队列；这里只消费派生数据，不直接读取仓储。
export function DashboardView({
  avgMastery,
  boardStats,
  correctRate,
  dueKnowledgeEntries,
  dueMistakes,
  knowledgeCategorySummaries,
  knowledgeCorrectRate,
  lowMistakes,
  onCreateKnowledgeStarterDrafts,
  onOpenBoard,
  onOpenKnowledgeCategory,
  onOpenKnowledgeTraining,
  onOpenInterview,
  onOpenReview,
  onOpenTutoring,
}: DashboardViewProps) {
  return (
    <section className="space-y-4">
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
              <strong className="text-lg">AI 实时辅导</strong>
              <Chip tone="green">浏览器 MVP</Chip>
            </span>
            <span className="text-sm leading-6 text-muted">
              用摄像头、屏幕共享或截图模拟眼镜视角，低频关键帧交给 AI 老师讲解；默认只保存文字摘要和用户确认的关联。
            </span>
            <span className="text-sm font-semibold text-blue">进入 AI 辅导</span>
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
