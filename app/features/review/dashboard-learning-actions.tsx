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
    <section className="dashboard-learning-actions" aria-labelledby="dashboard-learning-actions-title">
      <header>
        <div>
          <p>基于本地可观察学习记录</p>
          <h2 id="dashboard-learning-actions-title">今日学习</h2>
        </div>
        {recommendations.length ? <span>{recommendations.length} 项可执行</span> : null}
      </header>
      {recommendations.length ? (
        <div className="dashboard-learning-action-list">
          {recommendations.slice(0, 4).map((action) => (
            <article key={action.id} data-learning-action={action.kind}>
              <span className="dashboard-learning-action-icon" aria-hidden="true"><AppIcon name="chevronRight" size={18} /></span>
              <div className="dashboard-learning-action-copy">
                <h3>{action.title}</h3>
                <p>{action.summary}</p>
                <details>
                  <summary>为什么推荐？</summary>
                  <p>{action.priorityReason}</p>
                  <ul aria-label="本地证据来源">
                    {action.evidence.slice(0, 4).map((item) => (
                      <li key={`${item.type}:${item.id}`}><span>{evidenceLabels[item.type]}</span>{item.label}</li>
                    ))}
                  </ul>
                </details>
              </div>
              <Button size="sm" variant="soft" onClick={() => onOpen(action)}>{action.destination.module === "library" ? "查看错题" : actionLabels[action.kind]}</Button>
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
