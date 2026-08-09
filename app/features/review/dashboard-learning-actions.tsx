import type { LearningActionRecommendation } from "../../types/domains/learner-state.ts";
import { AppIcon } from "../shared/app-icon";
import { Button, EmptyState } from "../shared/ui-primitives";

const actionLabels: Record<LearningActionRecommendation["kind"], string> = {
  review_mistakes: "开始复盘",
  review_knowledge: "进入训练",
  retry_tutoring: "继续辅导",
  practice_interview: "进入面试",
};

const evidenceLabels = {
  mistake: "错题记录",
  review_attempt: "复盘结果",
  knowledge: "知识资料",
  knowledge_attempt: "训练结果",
  interview: "面试评分",
  interview_plan: "面试计划",
  tutoring: "辅导微测",
  tutoring_plan: "辅导计划",
} satisfies Record<LearningActionRecommendation["evidence"][number]["type"], string>;

export function DashboardLearningActions({
  recommendations,
  sourceRecordCount,
  insufficientEvidenceCount,
  onOpen,
}: {
  recommendations: LearningActionRecommendation[];
  sourceRecordCount: number;
  insufficientEvidenceCount: number;
  onOpen: (action: LearningActionRecommendation) => void;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-labelledby="dashboard-learning-actions-title">
      <header className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted">基于本地可观察学习记录</p>
          <h2 className="mt-0.5 text-base font-semibold" id="dashboard-learning-actions-title">今日学习</h2>
        </div>
        {recommendations.length ? <span className="text-xs text-muted">{recommendations.length} 项可执行</span> : null}
      </header>
      {recommendations.length ? (
        <div className="grid gap-2">
          {recommendations.slice(0, 4).map((action) => (
            <article className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-t border-line pt-3 max-sm:grid-cols-[auto_minmax(0,1fr)]" key={action.id} data-learning-action={action.kind}>
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-muted" aria-hidden="true"><AppIcon name="chevronRight" size={18} /></span>
              <div>
                <h3 className="text-sm font-semibold">{action.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted">{action.summary}</p>
                <details className="mt-1 text-xs leading-5 text-muted">
                  <summary className="w-fit cursor-pointer font-semibold text-foreground">为什么推荐？</summary>
                  <p className="mt-1">{action.priorityReason}</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="本地证据来源">
                    {action.evidence.slice(0, 4).map((item) => (
                      <li className="rounded-full bg-surface-muted px-2 py-0.5" key={`${item.type}:${item.id}`}><span className="mr-1.5 font-semibold text-foreground">{evidenceLabels[item.type]}</span>{item.label}</li>
                    ))}
                  </ul>
                </details>
              </div>
              <Button className="max-sm:col-start-2 max-sm:justify-self-start" size="sm" variant="soft" onClick={() => onOpen(action)}>{action.destination.module === "library" ? "查看错题" : actionLabels[action.kind]}</Button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState stateId={!sourceRecordCount ? "dashboard.learning-actions.insufficient" : insufficientEvidenceCount ? "dashboard.learning-actions.unsubmitted" : "dashboard.learning-actions.not-due"}>
          {!sourceRecordCount
            ? "暂无足够学习记录形成今日推荐。"
            : insufficientEvidenceCount
              ? "有学习记录，但尚缺少已提交评测证据。"
              : "当前暂无到期学习任务"}
        </EmptyState>
      )}
    </section>
  );
}
