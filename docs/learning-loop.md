# Learning Loop Phase 1

## 边界

Phase 1 将现有本地学习事实派生为可解释的只读行动队列，不新增表、不升级 `review_workspace` v16，也不自动执行任何学习动作。

```text
existing local facts
  -> LearnerStateSnapshot
  -> LearningActionRecommendation[]
  -> dashboard / existing module destination
```

推荐不会创建计划、修改掌握度、调用 AI、触发 Automation、写 Vault 或确认知识演进提案。用户点击 CTA 后才进入既有业务流程。

## 证据来源

- 错题：`Mistake`、最近 `Attempt`、`nextReviewAt`。
- 知识：`KnowledgeEntry`、最近 `KnowledgeAttempt`、`nextReviewAt`。
- 辅导：已提交且可确定评分的 `microAssessment`、`TutoringPlan.nextPracticeAt`。
- 面试：`InterviewEvaluation` 与 active `InterviewPracticePlan.nextPracticeAt`。

每个可执行推荐至少包含一个 `LearnerEvidenceRef`。UI 显示用户可读的证据类型和短标签，不显示数据库 ID；AI context 仅输出最小证据 ID，不复制完整题干、知识正文或历史对话。

## Mastery 契约

`Mistake.mastery` 与 `KnowledgeEntry.mastery` 始终是 1..5：

```text
1  clearly weak
2  weak
3  consolidating
4  stable, but not proof of permanent mastery
5  stable, but not proof of permanent mastery
```

`masteryLevelToScore()` 可生成 0..100 的只读排序分，但该值不得写回任何领域记录。最近 wrong/uncertain 可以使高 mastery 记录重新进入薄弱判断；最近 correct 不会把 4/5 自动描述为“完全掌握”。

## 固定优先级

```text
P1  到期的错题、知识、辅导计划、面试计划
P2  已提交但未通过的辅导微测
P3  至少两道独立错题支持的明确重复错因
P4  已确认但尚未到期的 active 辅导或面试计划
```

同一优先级内使用最近可观察结果、掌握度、日期和稳定 ID 排序。相同本地记录与相同 `today` 必须得到相同推荐 ID 和顺序。AI confidence 不参与 mastery 或行动优先级。

## 空白、数据不足与冲突

- 完全没有学习事实：显示“暂无足够学习记录形成今日推荐”。
- 有事实但没有可执行行动：显示“当前暂无到期学习任务”。
- 通用错因（如“待归因”“其他”“未知”）不形成长期误区。
- pending knowledge proposal 与 Vault conflict 不进入 Phase 1 行动队列，也不推进 learner state。

以下事实明确不代表学习完成：

```text
AutomationRun succeeded != learning completed
AI confidence != mastery evidence
pending proposal != confirmed knowledge
unfinished or cancelled interview != completed practice
unsubmitted micro-assessment != mastery
```

## Phase 1 限制

- Automation 尚无可靠的“用户已完成学习”语义，因此不作为行动或掌握证据；该映射留待后续阶段。
- 不使用 FSRS、SM-2、IRT、Elo、ML ranking 或总学习分。
- 推荐只导航到既有模块；不新增顶级页面或路由框架。
