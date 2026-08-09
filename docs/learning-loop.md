# Learning Loop Core

## 边界

Phase 1 将现有本地学习事实派生为可解释的只读行动队列，不新增表、不升级 `review_workspace` v16，也不自动执行任何学习动作。

```text
existing local facts
  -> LearnerStateSnapshot
  -> LearningActionRecommendation[]
  -> dashboard / existing module destination
```

推荐不会创建计划、修改掌握度、调用 AI、触发 Automation、写 Vault 或确认知识演进提案。用户点击 CTA 后才进入既有业务流程。

## Completion Semantics

Recommendation lifecycle 始终由既有本地领域事实重新派生，不持久化完成事件或历史卡片。`id` 表示当前 target 集合对应的 recommendation instance；`semanticKey` 表示跨 partial progress 保持稳定的学习事项。`completionHint` 只向用户解释完成条件，不参与规则判断。

| Action | Source evidence | Completion evidence | Non-completion events | Transition |
| --- | --- | --- | --- | --- |
| `review_mistakes` P1 | due `Mistake.nextReviewAt`、mastery、最近 `Attempt` | `reviewRepository.recordReview()` 在同一事务写入新 `Attempt` 并更新 Mistake；target 不再 due | 打开复盘、查看答案、提交后仍为 wrong 且仍 due | grouped targets 逐项缩小；全部不再 due 后消失 |
| `review_knowledge` P1 | due `KnowledgeEntry.nextReviewAt`、mastery、最近 `KnowledgeAttempt` | `knowledgeRepository.recordReview()` 在同一事务写入 attempt 并更新 entry；target 不再 due | 打开训练、查看资料、`reviewCount + 1` 但仍 due | grouped targets 逐项缩小；全部不再 due 后消失 |
| `retry_tutoring` P1 | active due `TutoringPlan` | 用户提交确定性 micro-assessment，事务更新 assessment 与 `nextPracticeAt` | 打开辅导、AI reply、模型 confidence、只点击“重新微测” | 新结果失败且 plan future：P2；通过且 plan future：P4；plan 非 active：消失 |
| `retry_tutoring` P2 | 同一 session 最新 completed assessment 未全部通过 | 同一 assessment 重新提交或同 session 更新的 completed assessment | 打开辅导、再次讲解但没有提交新 assessment | 最新仍失败：保留 P2 并更新 evidence；最新通过且 plan future：P4 |
| `retry_tutoring` P4 | future active `TutoringPlan` | 后续确定性 micro-assessment 更新计划，或计划进入既有非 active 状态 | 计划页访问、Automation reminder delivery | 到期：P1；最新失败：P2；plan completed/paused：不再 actionable |
| `practice_interview` P1/P4 | active `InterviewPracticePlan` 的 `nextPracticeAt` 与进度 | `saveEvaluation()` 原子保存 evaluation、标记 session evaluated 并推进 plan | start session、active/unfinished session、`cancelSession()`、AI evaluation draft | 未达目标且 next date future：P4；达到目标且 plan completed：消失 |
| repeated misconception P3 | 同一明确 reason 至少两道当前 unresolved Mistake | 后续复盘使当前 unresolved 独立证据少于两道 | 历史 reason 仍存在、通用占位 reason、单道未解决错题 | 证据不足时消失；历史 reasons 保留 |

统一原则：

```text
click != completion
navigation != completion
AI response != completion
Automation success != learning completion
```

Scheduled reminder delivery 只能证明 workflow 已执行，不能证明学习结果；pending Knowledge Evolution proposal 在 accepted 前也不是正式知识或完成证据。

Review、Knowledge、Tutoring assessment 与 Interview evaluation 的真实提交完成后，切回 Dashboard 会调用既有 `refreshData()` 重新读取所有仓储；reload 会从相同持久化 facts 重建同一 recommendation 状态，不依赖 transient React state，也不引入 EventBus。

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

## Accessibility & Responsive Acceptance

- Desktop 与 mobile Dashboard 使用同一个 `LearningActionRecommendation[]` 派生模型和同一个语义组件；390×844 完整交互与 360×800 窄屏 smoke 均验证文本换行、证据 chips、CTA 可达和无横向溢出。
- “为什么推荐？”继续使用原生 `details` / `summary`，CTA 继续使用真实 `button`；两者可仅通过键盘到达、展开和触发，并保留可辨识的 `:focus-visible` / 浏览器原生焦点轮廓。
- 推荐原因、完成条件和证据标签均为可读文本，不依赖 hover、颜色、图标或视觉位置表达语义，也不向普通用户暴露数据库 ID 或内部优先级代号。
- click、navigation、AI reply 与 Automation success 仍不代表完成；recommendation transition 完全由 Review、Knowledge、Tutoring assessment 与 Interview evaluation 的 persisted domain facts 驱动。
- Dashboard refresh 与页面 reload 都从相同 v16 facts 重建 recommendation，不持久化卡片、完成事件或 UI 状态。
- Review 与 Knowledge 继续导航到具体 target；Tutoring / Interview 继续采用模块级导航，精确 plan deep-link 仍 deferred。

## Tutoring recommendation precedence

同一 `auto:${sessionId}` 学习事项只显示一个 recommendation，并在派生规则内按语义身份执行：

```text
P1 due tutoring plan
> P2 latest failed completed micro-assessment
> P4 future active tutoring plan
```

同一 session 存在多轮已完成微测时，只使用按 `completedAt desc -> createdAt desc -> stable id` 选出的最新证据；较新的通过结果会淘汰旧失败建议。推荐 ID 由 rule 与稳定语义目标构造，不依赖数组插入顺序。

Learner State derivation consumes normalized domain facts. 错题与知识 facts 必须先经过各自 Repository 的既有 legacy normalization，再进入纯派生；公共加载路径和 Dashboard refresh 均不得将 raw persistence read 与 normalization 并发竞速。Learner State 不复制 migration writer。

## Phase 1 限制

- Automation 尚无可靠的“用户已完成学习”语义，因此不作为行动或掌握证据；该映射留待后续阶段。
- 不使用 FSRS、SM-2、IRT、Elo、ML ranking 或总学习分。
- 推荐只导航到既有模块；不新增顶级页面或路由框架。
- Interview/Tutoring 当前没有可复用的 plan 选择入口，recommendation 仍采用模块级导航；精确 plan deep-link 保持 deferred。
