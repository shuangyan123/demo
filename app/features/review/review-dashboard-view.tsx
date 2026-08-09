import type { BoardStat } from "../../lib/review-selectors";
import type { Board, Mistake } from "../../types/domains/review.ts";
import type { KnowledgeCategory, KnowledgeCategorySummary, KnowledgeEntry } from "../../types/domains/knowledge.ts";
import type { LearnerStateSnapshot, LearningActionRecommendation } from "../../types/domains/learner-state.ts";
import { ConfigurationHealthPanel } from "../onboarding/configuration-health-panel";
import type { ConfigurationHealth, ConfigurationHealthAction } from "../onboarding/use-configuration-health";
import { AppIcon } from "../shared/app-icon";
import { Button, CardButton, Chip, DataList, DataRow, EmptyState, MasteryDots } from "../shared/ui-primitives";
import { studyDomainDefinitions } from "../study/study-registry";
import { resolveDashboardNextAction, type DashboardNextActionId } from "./dashboard-next-action.ts";
import { DashboardStudyFlow, dashboardFlowTones, type DashboardFlowItem } from "./dashboard-study-flow";
import { DashboardLearningActions } from "./dashboard-learning-actions.tsx";

const boardColors = ["#2f6fed", "#1a9b71", "#d79018", "#d45145", "#7a5bd4", "#1c8c9a"];
const civilServiceDomain = studyDomainDefinitions[0]!;

type DashboardViewProps = {
  avgMastery: string;
  automationActiveCount: number;
  automationUnreadCount: number;
  boardStats: BoardStat[];
  configurationHealth: ConfigurationHealth;
  correctRate: number;
  dateLabel: string;
  dueKnowledgeEntries: KnowledgeEntry[];
  dueMistakes: Mistake[];
  importDraftCount: number;
  importJobCount: number;
  knowledgeCategorySummaries: KnowledgeCategorySummary[];
  knowledgeCorrectRate: number;
  lowMistakes: Mistake[];
  learnerState: LearnerStateSnapshot;
  notice: string;
  obsidianConnected: boolean;
  pendingProposalCount: number;
  onConfigurationHealthAction: (action: ConfigurationHealthAction) => void;
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
  onOpenLearningAction: (action: LearningActionRecommendation) => void;
};

/** 渲染三个默认折叠的低频信息区，保留旧首页能力但不占用首屏注意力。 */
function DashboardDisclosure({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: "dashboard" | "knowledge" | "interview";
  title: string;
}) {
  return (
    <details className="dashboard-disclosure">
      <summary>
        <AppIcon name={icon} size={20} />
        <strong>{title}</strong>
        <AppIcon name="chevronRight" size={18} />
      </summary>
      <div className="dashboard-disclosure-content">{children}</div>
    </details>
  );
}

/** 公考首页只消费父级派生数据，不直接读取 repository 或修改业务状态。 */
export function DashboardView({
  avgMastery,
  automationActiveCount,
  automationUnreadCount,
  boardStats,
  configurationHealth,
  correctRate,
  dateLabel,
  dueKnowledgeEntries,
  dueMistakes,
  importDraftCount,
  importJobCount,
  knowledgeCategorySummaries,
  knowledgeCorrectRate,
  lowMistakes,
  learnerState,
  notice,
  obsidianConnected,
  pendingProposalCount,
  onConfigurationHealthAction,
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
  onOpenLearningAction,
}: DashboardViewProps) {
  const knowledgeTotal = knowledgeCategorySummaries.reduce((total, item) => total + item.total, 0);
  const mistakeTotal = boardStats.reduce((total, item) => total + item.total, 0);
  const nextAction = resolveDashboardNextAction({
    automationUnreadCount,
    dueKnowledgeCount: dueKnowledgeEntries.length,
    dueMistakeCount: dueMistakes.length,
    importDraftCount,
    importJobCount,
    knowledgeTotal,
    mistakeTotal,
    pendingProposalCount,
  });
  const actions: Record<DashboardNextActionId, () => void> = {
    "confirm-import": onOpenImport,
    import: onOpenImport,
    review: onOpenReviewQueue,
    training: () => onOpenKnowledgeTraining(),
    proposal: onOpenKnowledge,
    scheduled: onOpenAutomation,
    tutoring: onOpenTutoring,
  };
  const flowActions = {
    import: onOpenImport,
    mistake: onOpenReviewQueue,
    knowledge: onOpenKnowledge,
    training: () => onOpenKnowledgeTraining(),
    tutoring: onOpenTutoring,
    scheduled: onOpenAutomation,
    obsidian: onOpenKnowledge,
  };
  const flowStatuses = {
    import: importDraftCount ? `${importDraftCount} 条草稿` : importJobCount ? `${importJobCount} 个批次` : "待开始",
    mistake: dueMistakes.length ? `${dueMistakes.length} 道到期` : "暂无到期",
    knowledge: knowledgeTotal ? `${knowledgeTotal} 条资料` : "暂无资料",
    training: dueKnowledgeEntries.length ? `${dueKnowledgeEntries.length} 条待训` : "暂无待训",
    tutoring: "可开始",
    scheduled: automationUnreadCount ? `${automationUnreadCount} 条未读` : automationActiveCount ? `${automationActiveCount} 个任务` : "未启用",
    obsidian: pendingProposalCount ? `${pendingProposalCount} 条待确认` : obsidianConnected ? "已连接" : "待连接",
  };
  const flowItems: DashboardFlowItem[] = civilServiceDomain.dashboard.flow.map((step, index) => ({
    action: flowActions[step.id],
    status: flowStatuses[step.id],
    step,
    tone: dashboardFlowTones[index]!,
  }));

  return (
    <section className="dashboard-home">
      <header className="dashboard-home-header">
        <div>
          <p>{dateLabel} · {notice}</p>
          <h1>总览</h1>
        </div>
        <ConfigurationHealthPanel health={configurationHealth} onAction={onConfigurationHealthAction} />
      </header>

      <section className="dashboard-next-action" aria-labelledby="dashboard-next-action-title">
        <span className="dashboard-next-action-icon" aria-hidden="true"><AppIcon name="chevronRight" size={22} /></span>
        <div>
          <h2 id="dashboard-next-action-title">{nextAction.title}</h2>
          <p>{nextAction.description}</p>
        </div>
        <Button variant="primary" onClick={actions[nextAction.id]}>{nextAction.label}</Button>
      </section>

      <DashboardLearningActions
        recommendations={learnerState.recommendations}
        sourceRecordCount={learnerState.sourceRecordCount}
        insufficientEvidenceCount={learnerState.insufficientEvidenceCount}
        onOpen={onOpenLearningAction}
      />

      <DashboardStudyFlow items={flowItems} />

      <section className="dashboard-primary-stats" aria-label="今日学习统计">
        <article><span>今日待复盘</span><strong>{dueMistakes.length}</strong></article>
        <article><span>今日知识训练</span><strong>{dueKnowledgeEntries.length}</strong></article>
        <article><span>薄弱错题</span><strong>{lowMistakes.length}</strong></article>
      </section>

      <section className="dashboard-disclosures" aria-label="学习详情">
        <DashboardDisclosure icon="dashboard" title="六大板块">
          <div className="dashboard-secondary-stats" aria-label="复盘历史统计">
            <span>平均掌握度 <strong>{avgMastery}</strong></span>
            <span>复盘正确率 <strong>{correctRate}%</strong></span>
          </div>
          <div className="ui-card-grid">
            {boardStats.map((item, index) => (
              <CardButton key={item.board} className="grid min-h-28" onClick={() => onOpenBoard(item.board)}>
                <span className="flex items-center justify-between gap-3">
                  <strong className="text-lg">{item.board}</strong>
                  <i className="h-2.5 w-2.5 rounded-full" style={{ background: boardColors[index % boardColors.length] }} />
                </span>
                <span className="mt-4 grid grid-cols-3 gap-2 text-sm text-muted">
                  <span><b className="block text-xl text-foreground">{item.total}</b>总数</span>
                  <span><b className="block text-xl text-blue">{item.due}</b>待复盘</span>
                  <span><b className="block text-xl text-red">{item.weak}</b>薄弱</span>
                </span>
              </CardButton>
            ))}
          </div>
          <div className="ui-content-grid">
            <section>
              <h3>今日队列</h3>
              <DataList>
                {dueMistakes.length ? dueMistakes.slice(0, 5).map((item) => (
                  <DataRow key={item.id}>
                    <div className="min-w-0">
                      <strong className="block truncate">{item.stem}</strong>
                      <div className="mt-2 flex flex-wrap gap-2"><Chip tone="blue">{item.board}</Chip><Chip>{item.reasons[0] ?? "待归因"}</Chip></div>
                    </div>
                    <Button size="sm" variant="soft" onClick={() => onOpenReview(item.id)}>复盘</Button>
                  </DataRow>
                )) : <EmptyState reviewPack="learning" stateId="dashboard.due-mistakes.empty">今天没有到期错题</EmptyState>}
              </DataList>
            </section>
            <section>
              <h3>薄弱板块</h3>
              <DataList>
                {boardStats.some((item) => item.weak > 0) ? boardStats.filter((item) => item.weak > 0).toSorted((a, b) => b.weak - a.weak).map((item, index) => {
                  const maxWeak = Math.max(1, ...boardStats.map((stat) => stat.weak));
                  return (
                    <div key={item.board} className="grid grid-cols-[130px_minmax(0,1fr)_42px] items-center gap-3 text-sm">
                      <strong className="truncate">{item.board}</strong>
                      <div className="ui-meter-track"><span className="block h-full rounded-full" style={{ width: `${(item.weak / maxWeak) * 100}%`, background: boardColors[index % boardColors.length] }} /></div>
                      <span>{item.weak}</span>
                    </div>
                  );
                }) : <EmptyState reviewPack="learning" stateId="dashboard.weak-boards.empty">暂无薄弱板块</EmptyState>}
              </DataList>
            </section>
          </div>
        </DashboardDisclosure>

        <DashboardDisclosure icon="knowledge" title="知识中枢">
          <div className="dashboard-secondary-stats"><span>知识训练正确率 <strong>{knowledgeCorrectRate}%</strong></span></div>
          <div className="ui-card-grid">
            {knowledgeCategorySummaries.map((item) => (
              <article key={item.category} className="ui-card ui-card-muted grid gap-4 text-left">
                <button className="text-left" type="button" onClick={() => onOpenKnowledgeCategory(item.category)}><strong className="text-lg">{item.category}</strong></button>
                <span className="grid grid-cols-4 gap-2 text-sm text-muted">
                  <span><b className="block text-xl text-foreground">{item.total}</b>资料</span>
                  <span><b className="block text-xl text-blue">{item.due}</b>待训</span>
                  <span><b className="block text-xl text-red">{item.weak}</b>薄弱</span>
                  <span><b className="block text-xl text-yellow">{item.favorites}</b>收藏</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onCreateKnowledgeStarterDrafts(item.category)}>生成模板草稿</Button>
              </article>
            ))}
          </div>
          <section>
            <h3>知识训练队列</h3>
            <DataList>
              {dueKnowledgeEntries.length ? dueKnowledgeEntries.slice(0, 4).map((entry) => (
                <DataRow key={entry.id}>
                  <div className="min-w-0">
                    <strong className="block truncate">{entry.title}</strong>
                    <div className="mt-2 flex flex-wrap items-center gap-2"><Chip tone="blue">{entry.category}</Chip><MasteryDots value={entry.mastery} /></div>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => onOpenKnowledgeTraining(entry.id)}>训练</Button>
                </DataRow>
              )) : <EmptyState reviewPack="learning" stateId="dashboard.due-knowledge.empty">今天没有到期知识资料</EmptyState>}
            </DataList>
          </section>
        </DashboardDisclosure>

        <DashboardDisclosure icon="interview" title="面试与辅导">
          <div className="grid gap-3 md:grid-cols-2">
            <CardButton className="grid gap-3" onClick={onOpenInterview}>
              <strong className="text-lg">线上模拟与复盘</strong>
              <span className="text-sm text-muted">结构化、小组和无领导面试训练</span>
              <span className="text-sm font-semibold text-foreground">进入面试训练</span>
            </CardButton>
            <CardButton className="grid gap-3" onClick={onOpenTutoring}>
              <strong className="text-lg">对话辅导</strong>
              <span className="text-sm text-muted">按需使用截图、摄像头、屏幕和知识检索</span>
              <span className="text-sm font-semibold text-foreground">开始对话辅导</span>
            </CardButton>
          </div>
        </DashboardDisclosure>
      </section>
    </section>
  );
}
