# Recall Kernel Architecture RFC

- 当前 Phase F Slice 1：[Managed Data Root Foundation](recall-managed-storage.md)；Slice 2：[Diagnostic Durable Capture Repository](recall-diagnostic-history.md)。Slice 3：[Production Durable Diagnostic Submission & Owner Recovery](recall-durable-diagnostic-submission.md) 已接通 trusted Main→Next、durable owner recovery 与 submit→Evidence→reveal；Slice 4：[Complete Diagnostic History → Learner State → WHAT](recall-diagnostic-state-reconstruction.md) 已接通当前 profile/epoch/source 的完整 generation→重新准入→State→WHAT 内部只读重建。F5 的 [Diagnostic-first Resume Slice 1](recall-diagnostic-resume.md) 已接通有效 profile 的入口、只读恢复和显式重复作答；production profile relocation、新 profile onboarding 与后续 Mod adoption 仍未实现。Phase E 保持 COMPLETE，Phase F 整体未完成。

- 状态：Phase B 已由 [#132](https://github.com/shuangyan123/demo/pull/132) 合并完成；Phase C **Evidence Engine / Policy V1 shadow foundation 已实现，并已通过受控 production-path 持久化记录的只读 shadow 验收**（[#133](https://github.com/shuangyan123/demo/pull/133)）；**Phase D Completed.** 三片均已合并：[#134](https://github.com/shuangyan123/demo/pull/134) Review / Knowledge self-report compatibility、[#135](https://github.com/shuangyan123/demo/pull/135) completed Tutoring supplied-key compatibility、[#136](https://github.com/shuangyan123/demo/pull/136) Interview model-assessment compatibility。#136 的 exact-diff / runtime-read 架构评审已在合并前完成；尚无独立 learner-truth authority cutover。Phase E **COMPLETE**（限定完成范围见第 14 节）：前三片建立完整 Evidence scope、asOf、verified direct assessment 与有限晋级；第四片以 learner-state-policy/v3 的最新等时 effective verification set 解释当前状态并保留历史；第五片消费该 state 作纯 WHAT-only Verification Policy。第六片建立 source-admission/v1 的受信 lookup / capture 准入契约；第七片建立机械核验、不可变 revision 的 first-party diagnostic spec/key authority；第八片建立内部 capture lifecycle mechanism；第九片接通独立 controlled assessment surface 与真实 capture/admission/Evidence，none 仅表示当前 surface 无内建辅助，唯一 production owner 为 recall-diagnostic。仍无 learner-state/UI recommendation/persistence cutover。
- Phase A 审计基线：`shuangyan123/demo`，`0b08ec14bf43cffbd64617b89dbea53e26bfa545`。
- RFC 初稿日期：2026-10-02。
- 交付边界：Phase A 交付本文和 README 索引；Phase B 已实现纯契约与 legacy adapters；#133 实现 Phase C 的纯 Evidence / Policy V1、shadow report、契约测试和架构守卫，并已完成受控 production-path 持久化记录的只读 shadow 验收；Phase D 让旧 LearnerStateSnapshot 的 Review / Knowledge latest result、已完成 Tutoring 微测结果与 Interview 模型评分展示经过 Kernel compatibility bridge，不创建 LearnerTargetState；Phase E 前六片保持 pure/shadow-only：保留完整 Evidence scope 与 asOf 边界、verified direct correctness 来源，并以 learner-state-policy/v3 的最新等时有效验证集合解释有限晋级；Verification Policy 只消费当前 state 决定 WHAT；legacy Evidence 全部 blocked，不接入既有 learner-state、UI 或持久化。第六片仅建立 source admission / ownership contract；第七片建立 spec-only authority；第八片提供内部 clock/UUID 的内存 capture mechanism；第九片接通受控页面与固定 production owner，仅验收 source-controlled assistance 和既有 Evidence，不接入 learner-state 或持久化。
- 下文既有行为审计描述 Phase A 基线；提议契约的实际实现进度以第 14 节为准。未完成阶段仍是设计提议，不代表已存在的 API 或已获批准的执行计划。

## 1. 产品定义与核心问题

> Recall turns learning activity into evidence-backed learner state, then decides what should be verified next.

> Recall 把学习过程转化为有证据支撑的学习状态，并据此决定下一步最值得验证什么。

Kernel 要解决的问题是：**如何把真实学习活动转化为可信、可追溯、可更新的学习者状态？**

AI chat、通用 AI Tutor、错题本、知识库、公考应用和单一 mastery score 都不构成 Recall 的核心定义。对话、错题、知识、公考等能力可以继续作为 Kernel 周围的第一方 Mod / Surface；本 RFC 不删除它们，也不改变现有产品身份或导航。

“有证据”同时要求来源可追溯和结论权限受限。保存了一条记录，只能证明该记录存在；不能因此宣称其中的判断已经独立验证。

## 2. 逻辑管线与事实分离

```text
Learning Activity
      ↓
LearningEvent
      ↓
Evidence Policy
      ↓
EvidenceRecord
      ↓
LearnerTargetState
      ↓
Verification Policy
      ↓
Next Verification / Learning Action
```

这是一条逻辑派生管线，不是 EventBus、持久化事件溯源系统或执行调度器。

| 概念 | 回答的问题 | 示例 | 不能自动推出 |
| --- | --- | --- | --- |
| Event | 发生了什么？ | 用户提交复盘结果 `correct` | 客观答对、理解或掌握 |
| Evidence | 对什么 claim 有何种支持，限制是什么？ | 有来源的 `self_report` | 独立评分成立 |
| Learner-state claim | 对这个 target，目前能支持什么状态？ | 理解仍 unknown，需要新题验证 | 永久掌握 |
| Workflow completion | 哪个产品步骤已提交？ | 保存面试评价并推进计划 | 面试技能已经提升 |
| Recommendation | 接下来值得验证或学习什么？ | 提议一次无提示变式题 | 用户已执行或完成 |

**Event != Evidence != Learner-state claim != Workflow completion != Recommendation。**

一个 Event 可以产生零条或多条 Evidence。例如面试评价保存可分别支持“产品流程完成”和“模型对表达的判断”；两条 Evidence 的 claim、class 和权限不同。缺少可用证据时保留 unknown / untested，而不是生成肯定结论。

## 3. Kernel authority：Models propose. Evidence decides.

**Models propose. Evidence decides.**

模型可以提出 diagnosis、explanation、misconception hypothesis、question、intervention 和 next action。模型输出本身不得直接标记概念 mastered、覆盖 learner state、设置权威 mastery，或把自己的 confidence 转换为学生证据。

**A persisted model judgment is still a model judgment.** Persistence does not upgrade evidence authority.

Kernel 根据可信、版本化 Evidence Policy 决定哪些 Evidence 可支持哪类状态。模型判断可以保留为明确标注的 `model_assessment`、解释线索或待验证假设；仅有模型判断不得推进理解、独立性、保持或迁移状态。将它先保存再读取，也不能绕过此限制。

“权威状态”表示产品用于作出学习决策的受约束结论，不表示绝对真理。`supported` 必须说明支持范围与证据；缺失、冲突或过期时仍可重新进入验证。

## 4. 当前实现与证据权限审计

### 4.1 Review Attempt 与 KnowledgeAttempt

当前 [Review 类型入口](../app/types/domains/review.ts) 和 [Knowledge 类型入口](../app/types/domains/knowledge.ts) 从 [legacy-review.ts](../app/types/domains/legacy-review.ts) 导出既有记录。

| 当前来源 | 已核对的写入行为 | 能证明什么 | 不能默认证明什么 |
| --- | --- | --- | --- |
| [reviewRepository.recordReview](../app/services/review-repository.ts) | 接收 `correct / uncertain / wrong`；同一事务添加 `Attempt` 并更新 Mistake 的 mastery / nextReviewAt | 用户确认了一次复盘结果；本地复盘提交发生 | 独立采集并客观评分了一份新答案 |
| [knowledgeRepository.recordReview](../app/services/knowledge-repository.ts) | 接收同一 result；事务添加 `KnowledgeAttempt` 并更新 entry 的 mastery、日期和 reviewCount | 用户确认了一次知识训练结果；本地训练提交发生 | 独立验证了知识理解或保持 |

当前 Attempt / KnowledgeAttempt 没有新答案正文、独立 grader 或答案来源契约。它们更接近 **user-confirmed / self-reported review outcome**，是有价值的本地证据，但不自动具有 independently verified mastery authority。

两个 writer 的 `confidence` 都来自更新后的 legacy mastery，并非另行采集的学生置信度或评分可靠度；不能把字段名称解释为概率、独立证据或新的测量。

`Mistake.mastery`、`KnowledgeEntry.mastery` 的现有契约是 **1..5 的 legacy scheduling/mastery heuristics**。[review-utils.ts](../app/lib/review-utils.ts) 和知识 writer 按 result 调整该值并安排下次日期。保留其现有用途，不自动将它升级为 canonical learner truth。

### 4.2 Tutoring micro-assessment

当前 [tutoring-ai-service.ts](../app/services/tutoring-ai-service.ts) 通过模型生成 `microQuiz`；question prompt、options、`correctOptionIndex` 和 explanation 均来自模型返回。解析会检查题目与选项结构，但没有独立验证答案内容。

[tutoringRepository.completeMicroAssessment](../app/services/tutoring-repository.ts) 校验提交选项，再确定性比较：

```text
selected option == correctOptionIndex
```

同一事务保存 selections、correctCount、completedAt，并创建或更新 `auto:${sessionId}` TutoringPlan。当前全部通过 / 至少一半通过 / 其余结果分别安排 7 / 3 / 1 天后复练。它不读取模型 confidence，也不直接写 Mistake / KnowledgeEntry 的 mastery。

正确表述是 **model-authored assessment + deterministic scoring**。提交证明学生做出了选择，分数证明选择是否匹配给定 key；这比模型自信更强，但并非 independent ground truth。题目质量、key 来源、辅助程度和实际测量目标仍需可见。

未提交的 micro-assessment 不构成作答表现证据。当前 `TutoringTurn.confidence`、detectedProblem、AI prose 和 observation summary 不能直接变成掌握或误区事实。

### 4.3 Interview evaluation

[interview-ai-service.ts](../app/services/interview-ai-service.ts) 的 `requestInterviewEvaluation()` 根据文字稿请求模型，解析 totalScore、dimensions、strengths、problems、suggestions 与 evidence 文案。数值归一化不会将模型评价变成独立评分。

[interviewRepository.saveEvaluation](../app/services/interview-repository.ts) 在事务中保存评价，将 session 标记为 evaluated，并在存在关联计划时推进 completedSessionCount / nextPracticeAt / status。`cancelSession()` 不生成评价、不推进计划；其 completedAt 是中止时间，不能仅按这个字段判断练习完成。

保存 evaluation 可以证明 **practice workflow completed**；其中的 score 和 `evidence: string[]` 仍是 **model assessment**。后者不是 Kernel EvidenceRecord，也不是独立 learner skill 验证。**Session/practice completion 与 evidence about learner skill 必须分开。**

当前 learner-state-service 确实将低于阈值的模型面试维度评分派生为 weakness signal；本 RFC 不把既有这一行为重新描述成独立验证，也不在本次改变它。

### 4.4 Sensor / hardware observation

未来 pause、erase、rewrite、stroke timing 属于观察。`pause 8 seconds` 不能直接等于“学生不理解 concept X”；后一句是解释或推断，需要另行提出假设并验证。模型解释后的传感器数据也不能改变这个权限边界。

### 4.5 当前 read model、Dashboard 与历史限制

[learner-state-service.ts](../app/services/learner-state-service.ts) 的 `LearnerStateFacts` 直接理解十类领域记录：Mistake、Attempt、KnowledgeEntry、KnowledgeAttempt、InterviewEvaluation、InterviewPracticePlan、InterviewSession、TutoringSession、TutoringTurn 和 TutoringPlan。它是一个 cross-domain aggregator，尚不是独立 Kernel。

- `deriveLearnerStateSnapshot(facts, today)` 从这些事实派生 signals、counts 与 recommendations，不写派生结论。`masteryLevelToScore()` 的 0..100 和 signal.score 是只读转换 / 排序信息，不是 canonical mastery 或统计置信度。
- 公共 loader 先调用 Review / Knowledge repository 的 normalization，再读取其余 v16 表并保留既有 WorkspaceDataScope。Repository normalization 可能写入旧字段或清理早期 demo；不能将整个 loading path 说成绝对无写入。纯派生函数与历史兼容 writer 是不同边界。
- 当前 `LearnerEvidenceRef` 主要是 type、id、label、observedAt 的记录引用；`evidenceCount` 是引用数量，不能表达证据等级或测量质量。
- [learning-context-assembler.ts](../app/services/learning-context-assembler.ts) 选择有引用的少量 signals，按字符预算传最小证据 ID，不复制完整题库、知识正文或历史。已有引用仍不保证引用内容具有独立验证权限。
- [dashboard-next-action.ts](../app/features/review/dashboard-next-action.ts) 的主操作包含导入确认、知识提案、Automation 收件箱等产品动作；它与 snapshot 的学习推荐队列不是同一种 authority。
- 当前微测重提覆盖同一 turn 上的 microAssessment；面试重评删除同 session 旧评价并保存新评价。`saveEvaluation()` 的计划计数没有按已 evaluated session 去重的检查，不能据此承诺“唯一已完成场次”的事件历史。兼容适配只反映可读事实，不补造被覆盖结果或额外场次。
- Review / Knowledge 的 reviewedAt 由日期工具生成，通常只有 `YYYY-MM-DD`。旧记录缺少辅助程度、作者 provenance、独立评分标记及部分稳定 target 映射；这些缺口必须保持未知。

现有 [Learning Loop 文档](learning-loop.md) 的“确定性提交”“真实完成”和“证据”描述的是可观察 commit / recommendation transition；不等价于内容具有独立 ground truth。本文细化其 authority，不宣告现有 0.5 行为被替换。[architecture.md](architecture.md) 与 [路线图](product-roadmap-0.3-to-1.0.md) 的完成状态也不表示 Kernel 已实现。

## 5. 提议：LearningEventV1 逻辑契约

以下是 RFC 字段定义，不新增生产类型或存储表。

| 字段 | 提议语义 |
| --- | --- |
| `schemaVersion` | 固定 `1`；标识 event schema，不表示 Dexie 版本 |
| `id` | source namespace、记录身份、语义 kind 与可辨别 revision 构造的稳定 ID；同一投影不得每次随机生成 |
| `kind` | 受版本化契约约束的语义事件类型；不接受任意 payload 直接影响状态 |
| `occurredAt` | 活动时间；支持来源真实精度的日期 / instant；缺失为 `null` |
| `recordedAt` | 来源记录该活动的时间；缺失为 `null`，不以每次加载时间补造 |
| `sessionId` / `attemptId` | 有真实可验证关联时提供；缺失时省略，不能按上下文猜测 |
| `target` | 明确的 `{ category, namespace, id }`；category 为 question、mistake、knowledge、concept、skill、interview_skill |
| `source` | adapter ID 与原始记录 refs；ref 至少包含 record type / ID，可包含真实可辨别 revision |
| `provenance` | 归一化 / interpreter 版本、modality、作者与 key 来源、scoring method、policy version、时间精度与可用性 |
| `payload` | 按 kind 区分的最小观察事实，不接收 canonical state patch |
| `traceRef` | 仅在 raw trace 经授权保留时可附带的 opaque 引用；缺失不影响 event 有效性，不内嵌点流、路径或凭据 |

`provenance` 应能表达 adapter ID、original record type / ID、modality（text / selection / pen 等，无法确认则 unknown）、`modelAuthored: true / false / unknown`、scoring method（self_report / option_key_comparison / model_rubric 等）与适用版本。`false` 也不能自动表示内容已独立验证；需要独立的内容 / key 验证来源。Event 上的 policy version 标识归一化规则，Evidence 上另记解释规则，不让来源选择权威等级。

初始语义例子：

| Kind | 可承载的最小事实 | 边界 |
| --- | --- | --- |
| `attempt.started` / `attempt.completed` | attempt 身份与可观察开始 / 结束状态 | completed 不代表正确 |
| `answer.submitted` | 提交身份与有权限的答案引用 | 没有评分不产生 correctness 结论 |
| `review.completed` | 用户确认 result、Attempt / Mistake refs | 自报结果，不伪装成新答案评分 |
| `knowledge_review.completed` | 用户确认 result、KnowledgeAttempt / entry refs | 同样保留 self_report |
| `hint.requested` | 明确请求的提示及与 attempt 的关联 | 无该事件不表示 assistance none |
| `assessment.submitted` | selections、对应 key 的判分结果、题目 / key provenance、turn / session refs | 模型 key 与独立 key 分开 |
| `interview.completed` | 可追溯的已保存评价与 evaluated session 事实 | 只证明 practice workflow completion |
| `interview.evaluated` | rubric 维度评价与作者 provenance | 默认保持 model_assessment |

未来硬件可增加 `answer.revised`、`pause.detected`、`erase.detected`、`trace.attached` 等语义；这里只给扩展方向，不枚举全部设备事件。

Legacy adapter 只能输出源记录支持的事件。当前 Review Attempt 不能反推 `answer.submitted` 或 `attempt.started`；没有可靠 concept / skill 映射时保留已有 mistake / knowledge / question target，不从题干、标签或模型建议推断稳定 concept 身份。无有效 target 的输入保持显式 unsupported / unmapped，不进入 target-state 派生。

时间精度必须随 provenance 保留。date-only 不能伪装成精确提交时刻；recordedAt 不可用时不复制 occurredAt 冒充录入时间。revision 无法还原时只派生当前可观察投影，并明确 history incomplete。

同一原始记录有可观察修订时，event identity 必须区分该修订；没有源 revision 字段时，可由当前最小规范化事实的确定性摘要区分投影，但这不恢复过去的记录。Evidence identity 随 source event IDs、claim 与 Evidence Policy 版本构造；后续修改或删除来源时重算，不能沿用失效的 claim。归一化、Evidence、状态和 Verification 各自记录版本，不混用 schemaVersion 或 Dexie 版本。

Payload / provenance 采用按 kind 的字段允许清单，不复制 API Key、Cookie、Authorization、隐藏思维链、thought signature、完整 Provider 响应、完整 prompt、原始媒体或不必要的 MCP 输出。答案与 trace 引用仍受外层权限控制，不因进入 Event 就获得模型上下文或导出权限。

## 6. 提议：EvidenceRecordV1 与 Evidence Policy

EvidenceRecord 与 LearningEvent 分离：Event 保存“发生”，Evidence Policy 解释“支持哪个有限 claim”。不将所有 Event 直接折叠成一个 mastery update。

| 字段 / 维度 | 提议值或职责 |
| --- | --- |
| `schemaVersion` / `id` / `target` | V1、稳定派生身份、明确 target |
| `claim` | correctness、performance、understanding、independence、retention、transfer、misconception、completion |
| `outcome` | 对该 claim 的支持 / 反证 / inconclusive，及具体测量范围；例如 matches_model_key 而非无条件 objective_correct |
| `evidenceClass` | workflow_fact、self_report、scored_performance、human_assessment、model_assessment、sensor_observation |
| `assistance` | unknown、none、hint、guided、solution；只有显式可靠事实才能选 none |
| `strength` | weak、moderate、strong；对该 claim 的分类支持程度，不是概率 |
| `sourceEventIds` | 非空、可解析的来源 event IDs |
| `sourceRecordRefs` | 原始 record type / ID 与可用 revision；保持与 Event 链一致 |
| `measurementGroupId` | 稳定来源测量身份；Phase C 使用 source event ID，同一次面试评价的 overall / dimension Evidence 共用一组 |
| `policyVersion` / `provenance` | Evidence Policy 版本及作者、key、评分、辅助、时间、适用范围与限制 |

Evidence Policy 是版本化纯规则，不能由模型或第三方 adapter 任意传入。Event 的来源声明需要 adapter boundary 校验；第三方声称“human graded”或“no assistance”不自动获得高权限。未知、无效、冲突来源不升级，保留理由。

Phase C 的 `performance` 表示模型 rubric 对表现的测量，保留 overall / dimension、score 与 maxScore；它不等于 correctness 或 understanding。`evidence-policy/v1` 将此类 Evidence 标为 weak、model_assessment、inconclusive，不自动推进 LearnerTargetState，也不将维度标签映射为 canonical skill / weakness。纯 shadow report 仅返回固定词表计数，不持久化、不自动记录、不接入 UI 或现有 learner-state / recommendation。

初始映射方向：

| 可观察来源 | 可派生 Evidence | 对 learner state 的初始权限 |
| --- | --- | --- |
| Review / Knowledge commit | completion 的 workflow_fact；报告 result 的 self_report | 可支持复盘完成、发现验证需求；不能直接确立独立正确性或 supported 理解 |
| 已提交模型微测 | completion 的 workflow_fact；匹配给定 key 的 scored_performance，保留 modelAuthored / key 限制 | 有作答表现，但单次模型 key 不能证明独立 ground truth、独立作答、长期保持或迁移 |
| 已保存模型面试评价 | completion 的 workflow_fact；维度的 model_assessment | 模型维度只作为待验证判断，不单独推进权威技能状态 |
| 明确 human assessment | 带评估者 / rubric 来源的 human_assessment | 只能在来源和目标可验证、策略允许时支持特定 claim；本基线没有由此证明的通用入口 |
| pause / erase 语义观察 | 通常只保留 Event，不强塞进技能 claim；未来明确策略可对受支持的 claim 派生 sensor_observation | 无适用 claim 时产生零条 Evidence；不能直接产生 understanding / misconception 结论 |

同一来源产生多条 Evidence 不等于多次独立学习测量；必须按原始 attempt / assessment 身份关联去重。`strong completion` 不能转为 `strong understanding`。提示后答对不能转成 independent；重复看到同一模型题及 key 不能自动作为 retention / transfer 的独立样本。

V1 不定义精确统计概率，也不把 weak / moderate / strong 映射为百分比。具体晋级门槛须在 Phase B/C 用真实数据和反例验证；本 RFC 固定禁止规则与可追溯契约，不伪造已校准的测量模型。

## 7. 提议：LearnerTargetStateV1

当前 [LearnerStateSnapshot](../app/types/domains/learner-state.ts) 是用于 signals 和 recommendations 的 derived read model，不扩展为 canonical state object。Phase E 首片另建纯派生 LearnerTargetStateV1；下表分类契约已定义；第四片仍仅授权 emerging / scoped independent，更强状态与 retention / transfer 晋级仍 deferred：

| 维度 | 提议分类 | 解释 |
| --- | --- | --- |
| `target` | 明确 target identity | 与 Event / Evidence 使用同一有来源的映射 |
| `understanding` | unknown、emerging、developing、supported | 特定目标理解的有限支持；supported 不是永久 mastered |
| `independence` | unknown、assisted、partial、independent | 是否在可靠记录的辅助条件下完成；缺失辅助事实保持 unknown |
| `retention` | untested、at_risk、supported | 延迟验证的证据状态；安排复习或时间过去本身不能证明保持 |
| `transfer` | untested、weak、supported | 不同已明确关联情境的表现；换题名或换措辞不自动证明迁移 |
| `evidenceReferences` | 按维度引用 Evidence IDs | 包含适用范围、反证与限制；每个非默认 claim 都可回溯 |
| `lastEvidenceAt` | 来源真实时间或 null | 最近可用证据时间，不等于已验证 |
| `lastVerifiedAt` | 策略认可的直接验证时间或 null | self_report / 单独 model judgment 不能刷新此字段 |
| `nextVerificationAt` | 明确 time context 下的提议日期或 null | 派生验证需求，不表示创建了计划或用户已承诺 |
| `policyVersion` / `timeContext` | 状态策略版本与显式评估日期 / 时区 / 时间粒度 | 用于解释和重算 |

仅有自报或模型出题结果时，可用有限证据提出进一步验证；不得自动输出 supported / independent 等高权限结论。是否足以形成 emerging / developing，必须在具体策略中明确允许的 claim、provenance 和限制。单独模型评价不能晋级。没有可用正反证时返回默认 unknown / untested；有冲突时保留冲突理由与双方 Evidence，并请求验证，不用平均分抹平。

模型微测与真实独立评估必须保持不同的验证资格。`lastVerifiedAt` 的内容验证、辅助与目标要求应由策略显式定义；单独提交、matches_model_key 或工作流保存不能冒充独立验证。

不定义单一 canonical 0–100 mastery score。少量且来源不同的观察无法支持“理解 83%”之类精度；理解、辅助、保持与迁移也不能无损压成一个数字。保留分类和 Evidence 链，比不可校准的精确数字更容易解释、质疑和更新。

以下 Slice 1–8 保留各片交付时的历史基线；其中 deferred、尚缺或未批准等描述不代表当前 completion blocker。当前 Phase E **COMPLETE**，限定范围与 closure rationale 见第 14 节。

### Phase E first / second slices — historical conservative baseline

**前两片基线（#138 / #139）；Phase D remains Completed。** 以下描述进入第三片之前的 learner-state-policy/v1；第三片的变更见下一节。 #138 建立 [LearnerTargetStateV1](../app/types/domains/learning-kernel.ts) 与 [deriveLearnerTargetStates](../app/services/learning-kernel/derive-learner-state.ts) 的保守纯派生基线。第二片加入 [learner-state-policy.ts](../app/services/learning-kernel/learner-state-policy.ts) 的显式晋级资格解释、完整 Evidence scope 与 `asOf` 因果边界；仍不接入 UI、既有 LearnerStateSnapshot、推荐或 runtime，不持久化状态。Verification Policy 仍 deferred；不创建 `verification-policy.ts`，不安排验证。

- 输入为显式 Events、Evidence 与 `LearnerStateTimeContextV1 { asOf }`。`asOf` 必须是带 timezone/offset 的有效 instant，并成为实际因果边界。source occurrence 的 instant 晚于 `asOf` 时整条 Evidence 排除；date-only 只与 `asOf` 字符串的 civil date 部分比较，晚于该日期时排除。同日 civil date 可参与非时间权限检查，但不声明它早于精确 instant，不补午夜 UTC；未知 source time 可保留为非时间候选，不能支持任何依赖时间的晋级。未来 Evidence 不创建 target、不进入来源或 eligibility、不刷新 `lastEvidenceAt`，并产生 `evidence_after_as_of`。本片仍不计算 retention timing、decay 或调度，不访问时钟、随机或全局可变状态。
- 内部重跑唯一 `deriveEvidence(events)`；显式 Evidence 参数必须与**完整 canonical Evidence 集合**的 IDs / 内容完全一致，允许相同重复确定性折叠与对象属性重排。遗漏 completion、learning、反证或未来 Evidence 都产生逐 ID 的 `incomplete_evidence_scope` 并返回空状态，不静默补齐。冲突 supplied Evidence、无效/意外/noncanonical Evidence 或孤立 lineage 同样使**整个 scope**返回空状态；伪造 class/strength/assistance/limitations/outcome/claim/target/measurement/policy 不授予权限。Event policy diagnostics 继续确定性透传；被 Event policy 拒绝的来源不属于 canonical 集合，调用方准确提供剩余完整集合时可保留无关 target。完整性检查先于时间排除，不任选输入顺序 winner，也不读取 Event payload 绕过 Evidence。诊断只含 codes 与 opaque IDs；正常权限不足不报错。
- target 只有存在至少一条校验通过的非 completion learning Evidence 才进入状态集。当前 Review/Knowledge self_report correct/wrong/uncertain、Tutoring supplied-model-key pass/fail 与 Interview 高低 model rubric 分数均保持 `understanding=unknown`、`independence=unknown`、`retention=untested`、`transfer=untested`。不产生 emerging/developing、supported/independent、canonical weakness/misconception/mastery 或概率；rubric 标签不映射 skill，多个 slices 不复合为独立测量或更强 authority。
- `evidenceReferences` 明确分 understanding/independence/retention/transfer 四维；只有实际贡献非默认状态的 Evidence 才可进入，当前均为空。`sourceEvidenceIds` 是排序、去重的 canonical 非 completion Evidence IDs，仅供追溯，不表示维度支持。
- **canonical Evidence != promotion-eligible Evidence。** `promotionEligibility` 是与维度状态值、实际支持引用分离的四维权限解释，包含 `status`、排序去重的 `candidateEvidenceIds` / `candidateMeasurementGroupIds`、`eligibleEvidenceIds` 与封闭 V1 `blockers`。候选只表示接受权限检查，不承诺兼容的 claim/context 或独立评分资格。当前全部 legacy Evidence 的 `status=blocked`、`eligibleEvidenceIds=[]`；所有维度都含 `no_qualified_direct_evidence`。EvidenceLimitationV1 同义 code 直接复用，blockers 是正常策略输出而非诊断或自由文案。
- Review / Knowledge 的正确、错误或不确定自报含 `self_report_only` / `no_independent_grader`，既不证明理解，也不创建 canonical weakness。Tutoring pass/fail 含 `model_authored_key` / `no_independent_grader`；Interview 高低分含 `model_assessment_only` / `no_independent_grader`。`assistance_unknown` 阻断 independent/partial/assisted 等晋级；`current_projection` / `history_incomplete` 保留来源历史限制。retention 另含 `missing_delayed_verification`，transfer 另含 `missing_transfer_context`：elapsed time、due date、重复自报/模型测验、题名/措辞差异、rubric label 或 namespace 相似都不能补造这些权限。
- 候选按 `measurementGroupId` 分组，多个 rubric slices 仍是一份测量；相同 Evidence 不增加候选测量数。completion 即便是 strong workflow_fact 也不进入候选，不能与同流程的 performance 复合成第二份独立测量。无数值 confidence weighting 或当前来源的晋级门槛。
- `lastEvidenceAt` 只从上述 Evidence 的已校验 source Event occurrence 获取 `{ value, precision: "date" | "instant" }`。completion 不刷新 recency；缺失时间保持 `null`，date-only 不补为午夜。日期按日期排序，instants 按真实 offset 排序并固定词法打破等时 ties；若同 target 混合精度无法安全排序，则返回 `null` 与 `ambiguous_evidence_time`。当前 legacy target namespaces 由 Evidence policy 限定单一已知精度。
- 状态策略保持 `learner-state-policy/v1`：第二片在任何 runtime adoption 之前补全最初 V1 的保守权限契约，未引入新的晋级语义；区别于 Evidence policy/schema/Dexie。所有当前 legacy 来源的 `lastVerifiedAt=null`、`nextVerificationAt=null`；completion、自报、model-authored key 与模型评价均无独立验证资格。

未来实际晋级必须另外证明 canonical Evidence、被授权的 evidence class、明确 grader/key provenance、独立评分与内容有效性、无 `no_independent_grader` 限制、适当 assistance fact、兼容 claim、有效 target 与适用 time/context semantics。`human_assessment` 类型形状本身不能满足这些要求；当前来源不能证明就继续 blocked。本片不新增评估 writer、Event kind、transferContext 或 target mappings 来制造 eligible 样本。

契约测试与架构守卫覆盖默认权限、完整 scope、反证遗漏、asOf 边界、测量去重、Phase C 不变、输入不变、冲突/伪造/孤立血缘、确定性、时间精度与隐私白名单，并禁止任何外层生产模块消费派生器或权限策略（包括 Phase D compatibility bridge / learner-state-service）。前两片不含 actual promotion；第三片在下文单独定义首个有权来源与有限晋级。前两片交付时 Verification Policy、后续状态策略与来源 runtime adoption 尚未完成；后续各片及第 14 节记录其交付与收口，Phase F/G 状态不变。

### Phase E third slice — verified direct assessment and first qualified promotion

**第三片历史基线（#140，learner-state-policy/v2）；当前第四片的时间语义见下一节。** 新来源只在纯 Kernel / shadow 契约中存在，没有生产 writer。[verified-assessment-adapter.ts](../app/services/learning-kernel/verified-assessment-adapter.ts) 分开接受 `VerifiedAssessmentSpecV1` 与 `VerifiedAssessmentAttemptV1`：规格拥有稳定单题 identity、optionCount 与 verified key；attempt 引用 exact spec identity，提供稳定 attempt ID、选择位置、offset-aware instant 和明确的 `none / hint / guided / solution` assistance。unknown、缺失 assistance、date-only 或无 timezone 时间均拒绝。

规格的独立核验是未来授权 source owner 的责任，本片不提供任意对象“自称 verified/correct”或内容核验服务。adapter 自行比较选择与 verified key，白名单赋予 `recall-verified-assessment/v1`、`verified-assessment/v1`、selection、modelAuthored=false、keySource=verified_assessment、scoringMethod=verified_key_comparison、instant、complete_record；输入附加字段不能覆盖这些事实。`verification.assessed` 与 legacy `assessment.submitted` 分开。

- target 固定为 `question / verified_assessment_question / spec.id`；不推断 concept、skill 或 interview_skill mapping。attempt revision 为 `[specId, selectedOptionIndex, assistance, occurredAt]`，spec revision 为 `[optionCount, verifiedCorrectOptionIndex]`。Event identity 编码双方 ID/revision；Evidence policy 重建并验证 bounds、关联、revision、payload、target、provenance 和 comparison。在整个 `deriveEvidence(events)` 输入 scope 中，verified adapter 的同一 `recordType / recordId` 只能有一个 revision；不同 Event ID、被拒绝的 Event 组或 asOf 之外的修订不能绕过此约束。同一 attempt 或 spec 的冲突 revision 使所有涉及它的测量 fail closed，诊断为封闭 code `conflicting_source_identity` 与 opaque Event ID，不复制 revision 正文。不同 attempt ID 只有在 spec revision 相同的情况下才能复用同一 spec；相同 Event/revision 的重复输入仍确定性折叠。无 spec-version 或 attempt-supersession 语义。
- **版本分开：** 新 Event 产生 `evidence-policy/v2` 的单条 correctness / scored_performance / strong Evidence，其 outcome 仅含 `verified_key_comparison`、matchesVerifiedKey 与 supports/refutes。保留实际 assistance，不复制选择位置或正文到 Evidence outcome，不额外发 completion，也不在 Evidence Engine 推断 understanding/retention/transfer。不存在 legacy 的 no_independent_grader、model_authored_key、assistance_unknown、current_projection 或 history_incomplete 限制时 limitations=[]。Review / Knowledge / Tutoring / Interview 的 Evidence 仍为 `evidence-policy/v1`，IDs、provenance、limitations 与 Phase D compatibility 不变。
- **canonical Evidence != promotion-eligible Evidence。** 类型、class、strong、none 或空 limitations 本身不授权。完整 canonical scope 与 asOf 检查之后，state policy 仍要求 recognized verification kind / adapter / exact provenance / 双 lineage / canonical Evidence 相等。资格解释分 candidate、eligible direct measurements、eligibleSupportingEvidenceIds、eligibleRefutingEvidenceIds 与封闭 blockers；所有 IDs 排序去重，按 measurementGroupId 去重。
- 真正晋级语义使状态策略明确升级到 `learner-state-policy/v2`，schemaVersion 仍为 1。只有 verified correct + assistance=none、且无 qualified refutation 时，`understanding=emerging`、`independence=independent`；仅限该单题 target。实际 dimension evidenceReferences 只包含导致晋级的 qualified supporting unassisted Evidence IDs。
- hint/guided/solution 的成功测量仍 canonical / qualified direct，但不独立促成晋级，缺少无辅助支持时给出 `assistance_present`。wrong 是真实 qualified refuting Evidence；单独存在时 unknown / unknown，并给出 `no_qualified_supporting_evidence`，区别于无 qualified measurement 的 `no_qualified_direct_evidence`。同 target 任何 qualified support/refute（包括已知辅助）冲突时给出 `conflicting_qualified_evidence`，unknown / unknown、dimension refs=[]，保留全部正反证 IDs；不平均、不按顺序或 latest-wins 选择结论。
- `lastVerifiedAt` 明确定义为 asOf 内**最新 qualified direct verification measurement** 的 occurrence instant，不限成功或无辅助。wrong、受辅助以及不同合法 attempt 的支持/反证冲突测量均可刷新；来源身份冲突的测量不产生 canonical Evidence，不能刷新验证时间或获得晋级权限。self-report、model key、model rubric、workflow completion 均不能刷新。offset 真实时间排序与等时词法 tie break 延续原规则。未来 verified Evidence 不创建 target、不进入 source/eligibility、不能晋级或刷新 lastEvidenceAt/lastVerifiedAt；完整 scope 检查仍先于 asOf 排除。
- 任意多个 clean supports 都最多 emerging / scoped independent；不新增 developing/supported、负面 mastery state、百分比或数量阈值。retention/transfer 继续 untested，分别 blocked by `missing_delayed_verification` / `missing_transfer_context`，对应 refs=[]、nextVerificationAt=null。不设置延迟、衰减、transfer mapping 或调度。
- Fenbi 当前账户同步是 wrong-only → ImportDraft → legacy mistake/import。上游 userAnswer/answer 不证明可靠 occurrence time、assistance、verified spec lineage、target mapping 或完整独立表现历史；它不自动获得此 adapter 的 authority。本片不修改 Fenbi runtime。
- 新 Event/Evidence/state/eligibility/diagnostics 不复制题干、选项正文、解释、推理、导入正文、provider 响应、凭据、transcript 或 raw media。Event revision 仅含所需结构化整数、封闭 assistance、instant 与 opaque ID；诊断只含 code / opaque IDs。

契约和架构守卫覆盖上述正反证、辅助、scope、asOf、版本、确定性与隐私，并禁止外层 runtime / UI / repository / Dexie / network / AI / Automation 接入新来源、state derivation 或 policy。Phase D compatibility-snapshot 与 learner-state-service 保持原有职责，`verification-policy.ts` 不存在；核心库仍 v16，无 schema、dependency 或 runtime adoption。第三片交付时 Phase E 尚未完成；该历史记录不改变第 14 节的当前 COMPLETE 状态，Phase F/G 继续 Deferred。

### Phase E fourth slice — temporal effective verification for current state

**第四片历史基线；当时 Verification Policy still deferred。** 当前状态策略升级到 `learner-state-policy/v3`，LearnerTargetState schemaVersion 仍为 1；legacy `evidence-policy/v1`、verified `evidence-policy/v2` 及双方 Evidence IDs/内容均不变。

Historical Evidence 是不可变、可审计的观察历史；当前 LearnerTargetState 不再永久合并所有历史直接正反证。先完整 canonical scope 校验（含 source identity conflict），再排除 asOf 之后的 Evidence，最后对每个 target 的 qualified verified direct measurements 按解析后的实际 occurrence instant 选取最大时刻。**该时刻的全部合格测量组成 effective verification set**，相同实际时刻的不同 offset 表达属于同一集合；不选数组末项，不用 lexical ID 决定 learner truth，不改写存储的来源时间字符串。

- candidate IDs 保留原义；understanding / independence 的 `eligibleEvidenceIds`、`eligibleSupportingEvidenceIds`、`eligibleRefutingEvidenceIds` 保留全部 asOf 内 authority-qualified direct Evidence 审计集合。新增 `effectiveEvidenceIds` 及其 supporting/refuting 子集仅含最新等时集合；`historicalQualifiedEvidenceIds` 显式列出更早的 qualified Evidence。所有数组去重、词法排序、确定性、无正文。retention / transfer 尚无对应 context，原有 eligible 与新增 effective/historical 权限字段继续为空，不能借 correctness 获得资格。
- 只用 effective set 判断当前 understanding / independence：有至少一条 assistance=none 的 support 且无 refute → emerging / independent；assisted-only support → unknown / unknown，`assistance_present`；refute-only → unknown / unknown，`no_qualified_supporting_evidence`；同一最新实际时刻 support + refute → unknown / unknown，`conflicting_qualified_evidence`。多个 clean current supports 仍最多 emerging，不引入 developing/supported、assisted/partial 或数量加权。
- 更早 refute 不再永久阻断更新的无辅助成功；更早成功也不能支撑更新的失败或 assisted-only 成功。所有历史 Evidence 仍 canonical，保留在 `sourceEvidenceIds` 及适用的 qualified audit 字段；缺少任何历史支持/反证仍拒绝完整 scope。非默认维度的 evidenceReferences 仅引用 effective unassisted supporting IDs；默认状态 refs=[]，历史支持不继续作为当前因果引用。
- `lastVerifiedAt` 仍是最新 qualified direct occurrence instant，与 effective set 对应；失败、assisted 或同一最新时刻的冲突均可更新。等时来源字符串延续固定词法 tie break，保持原值。`lastEvidenceAt` 继续表示更广的 valid non-completion learner Evidence，原时间精度规则不变。未来测量不进入来源、qualified/effective IDs、状态、refs 或两个时间字段，不能在较早 asOf 提前 supersede 已有验证。
- **时间演进必须使用 NEW attempt identity。** 同一 verification_attempt 或 verification_spec recordId 的矛盾 revision 仍 `conflicting_source_identity`、fail closed；校验发生在 authority / asOf 排除之前，不允许把 changing revision 当 temporal supersession。合法的新 attempt ID、相同不可变 spec revision 才表示下一次测量。
- 历史间隔及跨题成功不证明 retention / transfer；继续 untested，保留 `missing_delayed_verification` / `missing_transfer_context`。`nextVerificationAt=null`，没有延迟阈值、transfer mapping 或 verification-policy.ts。Review/Knowledge self-report、Tutoring model key、Interview model assessment 仍 blocked，不参与 effective direct set；Fenbi wrong-only import 仍非 qualified。

本片必须先于 Verification Policy：建议“再次验证”必须能够改变当前状态；永久历史 support/refute conflict 会使这一动作无法收敛。当前只建立纯 Kernel / shadow 时间解释，不接入 runtime、UI、推荐、source writer 或 persistence；Phase D compatibility-snapshot 与 learner-state-service 不变，不处理无关的 mixed evidence-shadow aggregate policyVersion。第四片交付时 Phase E 尚未完成；当前状态见第 14 节，Phase F/G 继续 Deferred。

### Phase E fifth slice — WHAT-only Verification Policy

**第五片历史基线；WHAT-only Verification Policy 在本片交付。** Verification Policy decides what should be verified next from the current effective verification state; it does not schedule or execute verification.

`decideNextVerification(derivation: LearnerStateDerivationV1, learningTarget: LearningTargetV1): VerificationDecisionV1` 消费 `deriveLearnerTargetStates` 的完整受信结果，为一个 exact category/namespace/id 的学习对象决定下一次验证维度。调用方不得自行拼装摘要来绕过 canonical scope / asOf / qualification。Policy 不接受 Events 或 Evidence、不重新评分、不重算 qualified/effective set；candidate/eligible/historical IDs 仅用于摘要自洽性检查，不用于当前 target 选择，也不更改 state policy v3 或 Evidence v1/v2。

摘要校验遵循 v3 已有不变量：eligible support/refute 是互斥完备分区；effective/historical 是 eligible 的互斥完备分区，effective 的方向子集必须属于对应 eligible 方向，eligible 必须属于 candidate。understanding/independence 的全部 candidate/eligible/effective/historical 集合、status 和 blockers 一致；四维 candidate IDs/measurement groups 一致，retention/transfer 的 qualified 集合为空。缺失字段继续返回 incomplete_effective_state；内部集合矛盾返回 ambiguous_evidence_qualification。摘要没有 Evidence-to-measurement-group 映射，校验不猜测该关联，也不独立建立 Evidence authority。

V1 只授权一个能由当前模型明确区分的目标：最新 effective set 全部为 supporting、状态 unknown/unknown、两维 blocked 且唯一 blocker 是 `assistance_present` 时，返回 `{ kind: "verify", target: "independence", reason: "assistance_present" }`。这说明需要验证 independence；如何产生合格无辅助测量属于本片之外的 HOW，不表示 assisted correctness 已经证明 understanding。Policy 不先经过 understanding 阶段，也不把历史成功当不可逆 progress。

其余输出均为 `{ kind: "none", reason }`，不包含默认 target：

| reason | 含义 |
| --- | --- |
| `incomplete_effective_state` | 找不到请求的 state，或缺少 policy 所需的 effective 摘要、引用、asOf/verification instant 信息 |
| `unsupported_effective_state` | 不支持的 schema/state-policy 版本、当前 v3 不产生的维度状态，或未实现的 retention/transfer qualification context |
| `ambiguous_evidence_qualification` | 派生有未解决诊断、同对象重复 state、最新等时 support/refute 冲突，或 effective 分区、两维资格/引用/状态不一致 |
| `no_qualified_direct_evidence` | state 存在但没有合格直接测量；legacy self-report/model assessment 的 unknown 不授权猜测下一目标 |
| `ambiguous_verification_target` | 最新 qualified set 只有反证，两维均 unknown；当前模型不能区分下一次应验证 understanding 还是 independence |
| `no_authorized_verification_target` | 当前已有 emerging/scoped independent 的合格支持；不机械重复直接验证，也不因 retention/transfer=untested 而推断下一目标。这不声称所有学习维度已经掌握 |

诊断采用保守的完整输入边界：除 `evidence_after_as_of`（上游已排除未来测量）外，任何派生诊断都返回 `ambiguous_evidence_qualification`，即使另一个 target 看起来正常也不能屏蔽错误。等实际时刻冲突不选 winner；新 attempt 的 qualified state 可将 independence 验证变成无决策，或在较新 assisted-only support 后重新要求 independence。输入顺序、重复 canonical source measurements 与历史最强支持不决定输出。

当前 vocabulary 包含 understanding/independence/retention/transfer，但 V1 不虚构 retention 的 delayed-verification 或 transfer context，也不为无法区分的理解/独立性缺口设 tie-break 优先级。WHAT-only 是纯内存 Kernel decision：不读取时钟，不计算日期，不产生 job，不持久化，不接入 runtime/UI/network/notification/automatic execution。历史 Evidence 和所有审计字段保持原样；`nextVerificationAt` 继续由既有 state derivation 输出 null。focused contracts 接入现有 `test:contracts`，架构守卫继续阻止所有外层 consumer；第五片交付时真实授权来源尚未建立；当前 closure 见第 14 节，Phase F/G 继续 Deferred。

### Phase E sixth slice — authorized verification source admission boundary

**第六片历史基线；当时仅有 admission boundary，真实生产来源尚未批准。** 本片只建立 source-authority contract / admission boundary；没有批准真实 production source，没有 runtime consumer、writer、UI、persistence 或新的 learner-state semantics。

现有 `adaptVerifiedAssessment` 继续接受 already-authorized minimal facts。它能检查 bounds、exact identity、comparison、revision 与双 lineage 的内部一致性，不能仅靠 shape 证明 key 内容正确、caller 获准提供 spec、assistance 可靠或实际 occurrence。第六片将这项外层前提落实在 [source admission](../app/services/verification-source/verification-source-admission.ts)；Kernel 不反向 import source layer。

```text
caller: sourceOwnerId / specId / specRevision / attemptId
  → admission-controlled authorized owner lookup
  → canonical spec + captured attempt facts
  → admitted VerifiedAssessmentSpecV1 + VerifiedAssessmentAttemptV1
  → existing pure Kernel adapter / Evidence / state / WHAT decision
```

- 公共 `admitVerifiedAssessment(request)` 不接受 owner、resolver、key、target、assistance 或 occurrence authority。请求附加字段不参与准入，不能自签 verified authority。内部 core 只供该 facade 和 dedicated contract tests 调用；没有注册 API、plugin registry 或 DI framework。
- Spec authority owner 必须经独立评审批准，拥有稳定 source/spec 身份、不可变 spec revision、绑定题目/选项内容的 opaque `contentRevision`、明确顺序的唯一 `optionIds` 及独立核验的 `verifiedCorrectOptionId`。这些来自受信 lookup，不来自普通 caller。Shape 校验与测试桩都不能证明真实内容核验已经完成。
- Capture owner 对其实际可证明的 attempt ID、exact spec/revision、展示的 content revision / option ordering、selected option、explicit assistance 和 offset-aware occurrence instant 负责。公共 caller 只传 attempt identity；assistance/time 从 owner lookup 返回。缺失 assistance 不默认 none；缺少 hint log 不证明 none。date-only、无 timezone 或非法 occurrence 拒绝，不读取当前时钟补值。
- 在不修改既有 Kernel identity 算法的前提下，source-admission/v1 将 `[admissionVersion, sourceOwnerId, specId, specRevision, contentRevision, orderedOptionIds, verifiedCorrectOptionId]` 的确定性 JSON 编码投影为现有 `spec.id`，attempt ID 为 `[admissionVersion, sourceOwnerId, attemptId]`。内容/顺序/key/revision/source 改变均产生不同 Kernel spec identity，不能混为同一 target；不同 revision 不自动合并成学习进展。投影仍受既有 256-character source ID / Event bounds 约束，超界拒绝，不截断。Owner 仍负责 revision 的真实性和不可变性；本片不保存跨调用历史来验证 owner 是否违约。
- admitted 只返回 detached minimal spec/attempt 与 `policyVersion=source-admission/v1`；不返回临时 Event、不宣告 learner state、不证明所有 attempt 已加载。rejected 返回同一版本与封闭 reason：`invalid_request`、`unknown_source_owner`、`unknown_spec`、`invalid_spec`、`spec_revision_mismatch`、`spec_binding_mismatch`、`invalid_attempt`、`missing_assistance`、`invalid_occurrence_time`、`invalid_source_facts`。Owner 错误不传播正文、Provider error 或凭据，不回退 caller facts。
- **第六片交付时 production authorized owner set 是 frozen empty array；第九片已注册固定 recall-diagnostic owner。** Tutoring model key、Review/Knowledge self-report、Interview model rubric、Fenbi wrong-only import、manual import 与 arbitrary objects 均未批准；test owner 只存在 dedicated contract test 内，不导出、不注册到生产。Happy-path 测试仅证明受信 owner 前提成立时的契约，不是 production source acceptance。
- Architecture AST guards 覆盖 raw adapter 的 alias/re-export/dynamic import/require/import-type bypass、internal core 的任意 resolver 注入、test owner 进入 production 及尚未批准的 runtime adoption。唯一新增 raw adapter 访问者是纯 admission core；Kernel 内部和 dedicated contract tests 保持合法。既有 Phase E state/decision 无外层 consumer 的保护不变。
- 独立版本仅为 `source-admission/v1`。VerifiedAssessmentSpecV1 / AttemptV1、Event/Evidence schema、legacy evidence-policy/v1、verified evidence-policy/v2、learner-state-policy/v3 与 VerificationDecisionV1 均不变；Dexie v16 不变。
- **完整输入 scope 由未来 source/runtime caller 负责。** Kernel 的 canonical completeness 只相对于传入 Events；admission 对单次输入准入不证明 repository history completeness。本片不实现 history loader、repository scan、DB query、global attempt service 或任何持久化。

第六片交付时尚缺真正批准的 source owner/source instance，以及真实 authorized source 的只读语义验收；这些历史 completion 条件已由 Slice 7–9 与 Completion Audit 关闭，不是当前 blocker。retention/transfer、developing/supported、assisted/partial、Today/recommendation integration、scheduler、notification、writer、UI 与 schema migration 均不在本片范围。

### Phase E seventh slice — First-party Diagnostic Spec Authority Foundation

**第七片历史基线；当时只建立 spec/key authority。** 本片回答“系统凭什么知道 canonical spec/content/key”，不证明用户完成过 assessment。**first-party ≠ automatically trusted；spec authority ≠ attempt authority。** 只有明确 owner authority 提供的 immutable revisioned spec/key 才能作为后续 admission 的 canonical spec；没有真实 capture 时仍不能生成 verified Evidence。

[FirstPartyDiagnosticSpecV1](../app/types/domains/first-party-diagnostic.ts) 复用 `VerificationSourceSpecV1` 的 schema、id、revision、contentRevision、ordered optionIds 与 verifiedCorrectOptionId，只补充 immutable learner-visible content、response format、canonical `LearningTargetV1` 和 spec-only authority metadata。不修改 #141/#142/#143 的 Kernel、state、policy 或 source-admission/v1 API。

首批仅有 `recall-diagnostic / int-add-2-3 / r1`：题干 `2 + 3 = ?`，按 `four / five / six` 顺序展示 `4 / 5 / 6`，response 为 `single_option_id`，canonical key 为 `five`。这是受控的基础数学规格，不声称公考覆盖或模块能力。Owner 提供 key 的依据不是第一方身份：

- `bounded-integer-addition/v1` 独立复算两个 `[0, 100]` 的安全整数，验证 prompt 与 operands 一致，且唯一 canonical decimal option 等于精确整数和。
- 拒绝负数、负零、浮点、非有限值、越界、重复 IDs/数值、非 canonical 数字文本和无唯一答案；不使用 LLM 生成 key、LLM Judge、主观写作或 pedagogical judgment。
- 数学正确仍不足以批准任意 item：只接受内部已发布 exact revision 的全部 canonical semantics。其他正确算式、caller 自称 verified 或自带 key 都不能获得该规格身份。

[内部 spec capability](../app/services/first-party-diagnostic/spec-authority.ts) 仅有 `id / resolveSpec(specId, revision)`，无 public lookup facade、公共 registry、任意 registration API、catalog/resolver 注入或 `resolveAttempt`。普通 caller 仍只能向已有 admission 提供 owner/spec/revision/attempt locators。Unknown spec、wrong revision、malformed locator/spec 均 fail closed；错误结果只返回封闭 reason，不回退 caller facts。返回规格递归冻结，附加调用参数不能改 key、content、revision 或 target。

**Revision 是受控发布身份，不接受 latest 或 caller 任意 revision。** `r1` 的完整 canonical 快照通过 SHA-256 contract pin 保持可审计；runtime 校验使用固定字段顺序比较已发布 semantics，不依赖输入对象属性插入顺序。Prompt、option text/order、response schema、canonical key、LearningTarget 或 authority rule 任何变化必须发布新 revision，并保留旧快照及其 pin；不能改旧 pin 来覆盖 r1。本片没有发布 r2；任意构造的新 revision 继续拒绝。`contentRevision=r1` 与整体 revision 同步，不能同 revision 原地换 key、选项或 target。

LearningTarget 是固定 `question / verified_assessment_question`，其 id 为现有 source-admission/v1 tuple `[admissionVersion, sourceOwnerId, specId, specRevision, contentRevision, orderedOptionIds, key]` 的 exact JSON 编码，受现有 256-character identity bound 约束。该 binding 由受控 spec 提供，并在内部校验中重新检查一致性；不是从中文 display label、PreparationScope、Planning selector 或 Fenbi taxonomy 推断，也不授权一般 scope→target mapping。不同 revision 不自动合并为同一学习对象。

**第七片交付时 Production registration 选择 A。** 既有 production owner contract 同时要求 `resolveSpec` 与 `resolveAttempt`；本片只具备经过机械校验的 spec authority，缺真实 capture，因此不把 spec-only capability 塞入最终 admission owner 集合。`AUTHORIZED_VERIFICATION_SOURCE_OWNERS` 继续 frozen empty array；`recall-diagnostic` 的 production admission 仍稳定返回 `unknown_source_owner`。没有 fake captured-attempt resolver、synthetic production attempt、fixture 冒充 capture 或 localhost/dev shortcut。

Architecture AST guards 限制 spec authority 为固定纯依赖，禁止 UI、Preparation/Planning、persistence/repository、Fenbi、LLM Provider、dynamic import/require 和外层 capability consumer；导出清单禁止任意 registration/capture API。既有 admission empty-set/adapter-bypass guards 不变，并以源码 pins 冻结 #141/#142/#143 关键语义。直接 contracts 验证已发布规格、key 复算、target、revision、内容/顺序/schema、malformed inputs 和 deep immutability；tests 不构造真实 attempt、Event、Evidence 或 state。

**第七片交付时下一片 capture authority 尚缺：**真实且独立的 attemptId、actual offset-aware occurrence instant、learner response、exact displayed spec/content revision 与 option order、可证明的 assistance state、submit/reveal ordering 和 capture provenance。当时后续仍需真实 source instance 的只读语义验收与 scope/history 责任说明；当前来源边界与 closure 见第九片及第 14 节。不能把当前 spec contract tests 当生产 source acceptance。本片无 UI、diagnostic session、persistence、Event/Evidence writer、LearnerState 修改、Preparation/Planning 或 Fenbi 接入。

### Phase E eighth slice — First-party Diagnostic Capture Authority Foundation

**第八片历史基线；第九片当前路径见下一节。** Spec authority 已完成；capture lifecycle foundation 已实现，当时真实 production capture / source acceptance 未完成。 本片不改 Slice 7 已发布内容/版本/key，也不改 #141/#142/#143、adapter、Evidence、LearnerState 或 VerificationDecision 语义。

[内部 capture facade](../app/services/first-party-diagnostic/capture-authority.ts) 使用内部 `crypto.randomUUID()` 和 `Date.now()`，调用 [capture mechanism](../app/services/first-party-diagnostic/capture-authority-core.ts)。它是可供后续受控 runtime 使用的真实执行机制，不是无状态的对象生成函数；有独立 lifecycle、提交封存与仅解析本 instance 实际 records 的内存 lookup。但第八片交付时唯一调用者是专用 contracts，没有产品 learner submission 调用路径，也没有可信展示/辅助 surface。运行测试的 submission 不是生产 learner 事实；本片不能描述为已完成 production capture。

Trust model 区分两个边界：

- **Learner action/input**：`begin` 只接受 `specId / specRevision` locators；`submit` 只接受 `selectedOptionId`。caller-added attempt ID、timestamp、verified/key/target、assistance、display snapshot 或 reveal-order assertion 均拒绝。仅使用 plain data descriptors 的快照；getter、未知字段、symbols、Proxy 换值与重入不授予 authority。
- **Internal capture facts**：受控 service 在 begin resolve exact canonical spec，发出不含 key/answer/explanation/target 的冻结 presentation；submission commit 内生成 ID、获取实际时间、校验 response、封存不可变 record。它能证明 service 发出了哪个 canonical snapshot 和自身的 submit/reveal 顺序，**不能证明 renderer 实际展示了它、实际 learner 身份或实际辅助状态**。

Record 绑定 `sourceOwnerId=recall-diagnostic`、`specId / specRevision / contentRevision`、canonical ordered option IDs 与 exact response schema；历史 capture 不重新绑定 current revision。Presentation 从 canonical spec detached copy；caller 无权提供正文、排序或 revision snapshot。每次成功提交由内部生成独立 attemptId；重做同题需新 lifecycle、新 ID，specId 不用于 attempt 去重；ID 冲突拒绝，不覆盖旧记录。Response 按 `single_option_id` 校验并保存 canonical identity；错误选项仍原样保存，不由 key 自动修正；空白/缺失/不可能 ID/展示文本不形成错误回答。

`occurredAt` 只在 synchronous submission commit 读取内部 epoch clock，并输出经既有 instant validator 检查的 canonical UTC `toISOString()`。不是 begin、render、lookup、reveal、import 或 verification time。公开 action 不接受 clock/ID dependency；可控依赖仅在内部 core 与专用 contracts，production facade 固定内部默认。异常、无效/越界时间或随机 ID 失败使 lifecycle 失效，不封存记录，不传播原始 error，不自动重试。

State machine 由闭包持有，caller 不能改状态或替换方法：

```text
before_submit → committing → captured → reveal_allowed
      │              │
      └─ early reveal/commit failure/reentry → invalidated
```

合法提交前不从此机制输出 canonical answer / explanation。Reveal-before-submit 返回拒绝并使 lifecycle 失效；submit-before-reveal 封存后才允许读取 answer/explanation。重复 submit、reveal 后再次 submit 均拒绝，不能改原 response/time/assistance/revision；再答必须新 lifecycle。新 lifecycle 也不证明学习者未看过前次答案。所有 presentation、record、option arrays、response schema 与 provenance 递归冻结，输入 alias 不影响已封存事实。

**Assistance authority 未成立，固定为 `unknown`。** 即使 service 没有 hint、tutoring 或 guided-step API，也没有受控 runtime 保证 learner surface 未展示 solution/canonical answer 或未调用其他辅助。因此本片不存在 justified `none` path，不接收 caller 自签 `none`，也不添加 fake trusted-surface token 来宣布成功。Provenance 只记 `first-party-diagnostic-capture/v1`、`canonical_snapshot_issued`、`uncontrolled_surface` 和 service 内 `submitted_before_reveal`；不复制 session logs、UI internals、凭据、raw payload 或 catalog key。这个 capture 类型故意不能赋给要求已知 assistance 的既有 admission attempt contract。

Lookup 只解析本 instance 实际成功封存的 record；unknown attempt、wrong owner、wrong spec/revision tuple 拒绝，无预置 `attempt-001`、synthetic catalog、fixture resolver、imported captures 或 dev shortcut。内存记录不持久化，process/module lifecycle 结束后不再存在；不承诺跨重启历史、恢复或 complete history。

**第八片交付时 Production registration 仍选择 A，owner 集合保持 frozen empty array；第九片已注册固定 owner。** 当时 canonical spec resolver 已有，可信实际 learner capture / assistance resolver 尚缺。`admitVerifiedAssessment` 对该来源继续返回 `unknown_source_owner`；专用 owner-contract 测试进一步证明 `assistance=unknown` 即使经测试桥接仍被既有 admission 和 adapter 拒绝。没有真实 capture → admission → Evidence 的成功链路；adapter/Evidence 拒绝测试只证明 fail-closed compatibility，不是 production end-to-end acceptance。

Contracts 覆盖内部 identity/clock、重复 attempt、exact revision/order/schema、响应保存/无效值、caller forgery、reveal/submit、duplicate/reentry、immutability/aliasing、lookup tuple 与 production denial。Architecture guards 只增加固定 core→spec 与 facade→core edges，禁止 UI/Preparation/Planning/Fenbi/LLM/tutor/DB/renderer/runtime 接入、公开 owner registration、clock/resolver injection leakage 与 test capability 泄漏；保留并新增 Slice 7 source pins，#141/#142/#143 pins 不变。未修改浏览器/UI runtime，因此不运行 Playwright。

第八片交付时尚缺受控 learner surface 的真实调用与展示绑定、source-scoped assistance、生产来源批准及真实 source 语义验收；Slice 9 与 Completion Audit 已关闭这些来源条件。Scope/history 的责任分工见第 14 节，不承诺长期完整历史，不扩大 Preparation/Planning/learner-state 或持久化。Phase F/G 继续 Deferred。

### Phase E ninth slice — First-party Diagnostic Controlled Assessment Surface

**Phase E COMPLETE；第九片提供当前受控来源闭环，限定完成范围见第 14 节。** 首个真实 learner-facing 路径为 `/diagnostic`：server-rendered canonical form → native POST `/api/diagnostic/submit` → Slice 8 capture mechanism → 固定 production owner → `admitVerifiedAssessment` → existing adapter / `deriveEvidence` → post-capture answer reveal。没有 quiz bank、多题、Planning/Preparation/Fenbi/LLM/Tutor、analytics、recommendation 或 scheduling 接入。此处真实路径表示产品 runtime 已接通并通过本机 production standalone/browser 验收，不代表自然学习历史、学习效果或远程部署验收。

**Assistance 的精确 scope。** 既有契约要求 owner 提供显式可靠辅助事实，independence 解释为“是否在可靠记录的辅助条件下完成”，晋级限定单题/scoped independent；没有定义“排除现实世界全部外部帮助”。本片保持该 Kernel/admission/Evidence 语义，只由受控来源提供其实际能证明的事实：`none` 表示 **Recall 当前 controlled assessment surface provided no built-in assistance**。不能据此推断 learner 没有搜索网页、问别人、用手机/另一个 AI，不能声称 globally unassisted、真实阅读、实际人类身份或总体 mastery。此题答案被前一次 reveal 后记住也不构成 retention/transfer 验证；新 lifecycle 的 none 仍只描述当前 surface。

**Presentation proof 是受控交付，不是阅读证明。** [server page](../app/diagnostic/page.tsx) 只从 [runtime store](../app/server/diagnostic/assessment-store.ts) 获取 Slice 7 exact `recall-diagnostic / int-add-2-3 / r1` 的 key-free frozen presentation，按 canonical option order 渲染唯一表单。Server-issued 随机 session token 与这份表单一同交付；提交持有 token，将响应绑定回原 lifecycle。没有由 renderer 上报 displayed=true/assistance=none 的 receipt/assertion，也不接受 renderer 的 spec snapshot。结构与浏览器验收证明这一 token 的正常 delivery path 生成了 exact canonical assessment，并且页面中没有内建辅助；不证明 HTTP 阅读、注意力或外部行为。

页面为动态 Server Component，不挂载 workspace、AI activity、Tutor 或 client assessment controller。Issued 页面及 HTML/RSC payload 不发送 canonical key、explanation、hint、guided steps 或 learner state；表单只有 session locator 与 `selectedOptionId`。既有 CSP 禁止 iframe 嵌入，原生表单不引入辅助 channel。Result 只展示题目、原选择、提交成功、正确答案和解释；无 score dashboard/mastery/recommendation。未知/过期 session 显示重新开始入口。

**真实 capture 复用第八片机制。** 普通 `FIRST_PARTY_DIAGNOSTIC_CAPTURE` 继续 `assistance=unknown`。仅固定 server store 可构造内部 controlled facade，它仍调用同一个 `createMechanism` 的 spec binding、response validation、ID/clock、immutable seal 和 submit/reveal 状态机；没有第二套 attempt object generator。Controlled record 的 provenance 是 `first-party-diagnostic-capture/v1`、`controlled_surface_delivered`、`controlled_surface_no_builtin_assistance`、`submitted_before_reveal`。控制模式不是 request 参数；clock/UUID 仍内部提供。重复提交不能改已有记录；失败/不确定后续状态没有自动重放。

[HTTP boundary](../app/api/diagnostic/submit/route.ts) 使用既有 same-origin/security error 边界并限制原生 form body 到 1024 bytes，拒绝重复字段、其他 content type、invalid option 和额外 authority 字段（attemptId、occurredAt、assistance、revision、canonicalAnswer、verified、learningTarget 或 spec override）。全站 `no-referrer` 使原生 POST 发送 `Origin: null`（[Fetch Standard](https://fetch.spec.whatwg.org/#append-a-request-origin-header)）；仅此 route 要求完整 `Sec-Fetch-Site: same-origin`、`Mode: navigate`、`Dest: document` 才允许这种表单，缺失或跨来源元数据拒绝，其他 Origin 仍经既有检查。网页不能改写这些 `Sec-` 请求头（[Fetch Metadata](https://www.w3.org/TR/fetch-metadata/)）。只在 [submission operation](../app/server/diagnostic/assessment-submission.ts) 真正捕获、admit 且派生一条 existing Evidence 后返回 303；该响应不泄漏 key 或 Evidence。页面只能在 captured lifecycle 后取得 reveal。Capture 封存以后 admission/Evidence 失败不能回滚 capture；返回终态失败，不授权整流程 retry 或改原答案。

**Lifetime / lookup。** Runtime memory 是同一 local server process 中的真实记录源，不是测试 Map 或持久 repository。Next page/API bundles 通过固定 server-only global symbol 共用 store；每个 session 拥有真实 Slice 8 mechanism，仅保存其实际 captured record。最多 256 个 sessions，每个从 issue 起存活 30 分钟，过期删除并释放整个 mechanism。Reload 同一 result URL 在有效期和同一 process 内可以 resolve 原 attempt，不创建新 attempt；server restart、session expiry 或另一个 process 后无法 resolve，owner 返回 unknown/invalid attempt，不从 UI/URL/fixtures/备份重新构造。跨 process sharing、durability、跨重启 history、恢复和全部学习历史 completeness 都未实现，也不作这些承诺；没有 Dexie/schema/index migration。

**Production owner 已注册，只有 `recall-diagnostic`。** [固定 owner](../app/server/diagnostic/source-owner.ts) 组合 Slice 7 spec resolver 与真实 controlled captured-attempt resolver。Unknown spec/revision/attempt、其他 owner 和 tuple mismatch 继续 fail closed；普通 E8 unknown captures 不能被该 resolver 找到或 admission。调用 `admitVerifiedAssessment` 只传 owner/spec/revision/attempt locators，key、target、assistance 和 occurrence 来自 owner；caller-added authority 不参与。Registry 仍 private frozen const，无 public registration/injection；admission core 与公共 facade function body 不变，只有固定 owner 集合改变。

真实提交会执行 existing adapter 和 Evidence derivation：`five` → 原有 supporting correctness Evidence，`four` → 原有 refuting correctness Evidence，均保留实际选择与 source-controlled none，policyVersion 仍 `evidence-policy/v2`。Evidence 只作同步内存验收，不写数据库、UI 或学习状态；不调用 `deriveLearnerState`、`VerificationDecision`，不新增状态规则，不假装具有 complete repository history。单次 `complete_record` 不等于完整学习历史。

Integration contracts 覆盖 delivery/schema/order、pre-submit key/explanation absence、forged fields、actual capture/admission/Evidence、wrong response、duplicate/reload、immutability、expiry、fresh-process rejection、HTTP origin/body/field limits。针对性 Playwright 在真实 production standalone 服务中验收 correct/wrong 路径、提交后 reveal、reload、新 lifecycle 和 forged/duplicate HTTP 拒绝；不使用 capture fixtures、假 owner 或视觉快照。Architecture guards 只授权固定 server/page/route edges，禁止其他 renderer、Preparation/Planning/Fenbi/LLM consumers、dynamic/require bypass、test capability 泄漏与值级 admission core access；Slice 7 和既有 Kernel/admission core/Evidence/state/policy source pins 保留。

Phase E Completion Audit 已确认当前受控单题来源、question target、有限重做、source-scoped assistance 及 lifetime/history 边界满足本阶段 contract，Phase E **COMPLETE**。跨重启持久化、完整 history loading、多题/跨 revision target mapping 和 additional authorized sources 是 follow-up，不是 completion blocker；不自动开始这些工作或 Planning。

## 8. 提议：Verification Policy 与动作权限

Verification Policy 只读 LearnerTargetState、允许的 Evidence、目标关联和显式时间上下文，输出 **Next Verification / Learning Action**，不写计划、调用模型或执行外部动作。

每项提议包含 target、待验证 claim、依据 Evidence IDs、推荐原因、所需辅助 / 内容验证条件与稳定语义身份。例如：仅有自报 correct → 请求捕获新答案并评分；模型微测通过但 assistance unknown → 请求无提示新题；存在初次直接表现但保持 untested → 请求后续延迟验证。缺少安全可用的执行能力时标记 blocked / insufficient-data，不伪造完成。

| 动作域 | authority owner | 例子 |
| --- | --- | --- |
| Learning / Verification Actions | Kernel-derived；用户显式进入产品流程 | 到期验证、换例复练、无提示作答、延迟测试 |
| Workflow / Inbox Actions | product orchestration | 导入确认、查看 Automation 结果、处理集成配置、确认知识提案、处理 Vault conflict |

未来 Today Surface 可以视觉组合两个队列，但保留独立身份、来源与完成条件。导入成功、Automation success、提案 accepted 或集成可用都不自动更新 learner skill。CTA destination / 路由解析在外层产品映射，Kernel 不理解 UI route structure。

早期迁移继续保留现有 P1 到期、P2 微测失败、P3 明确重复错因、P4 active future plan 的兼容推荐语义；Shadow mode 先解释差异，不直接换掉优先级或改变用户可见 authority。

## 9. Adapter / Mod / Surface

| 边界 | 方向与例子 | 允许 | 禁止 |
| --- | --- | --- | --- |
| Adapter | External world → Recall；Fenbi、Web exercise、future digital pen / tablet、third-party Tutor | 输出经校验的 observations / events 和 provenance | 直接修改权威 learner state，声称某个 source flag 本身决定 mastery |
| Mod | Recall → specialized capability；civil-service、AI Tutor、Interview、future Gaokao、Anki integration、Obsidian-related | 读已授权状态、查询允许的 Evidence、提出 diagnosis、请求验证、提出 next action | 直接设置或权威宣告 mastery、删除 Evidence、覆盖 canonical state |
| Surface | User interaction；Desktop、Web、future Study Pad、Teacher Console | 展示、输入、显式提交与权限反馈 | 持有或伪造 learner truth |

**Mods propose; Adapters observe; Kernel decides state.** 一种集成可以同时有独立的 Adapter 输入职责和 Mod 能力职责，不能用“插件”一个名词混合二者权限。

当前 [study-registry.ts](../app/features/study/study-registry.ts) 登记公考导航、模块可见性和能力描述，不是 Mod runtime。第一批 Recall Mods 应为 **first-party、built-in、compile-time registered**，沿用已有 application/service/host boundaries；信任可执行代码不表示其模型输出可信。无需为 RFC 建立通用插件管理框架。

### Declarative Extension != Recall Mod

当前 [declarative-extension.ts](../app/types/domains/declarative-extension.ts) 的 theme、persona、study-pack、automation-pack、rubric-pack 是 **untrusted / constrained data extension**。包经过 schema、资产摘要与签名验证；签名不能授予执行权限或升级学习证据。

当前系统禁止任意 JS、HTML、JSX、WASM 和 remote runtime code。按 [declarative-extension-permissions.ts](../app/services/declarative-extension-permissions.ts) 与 [权限文档](declarative-extension-permissions.md)，只有主题 / 人设有实际应用入口；其他三类仍是经过校验的数据声明。`enabled`、合法 declaration、当前 capability 与 lower-level permission 必须同时满足。

**Recall Mod = trusted executable capability**，与上述 data-only 包分开。不能将其重新命名为 Mod runtime，也不能让 persona 的 prompt 直接控制 Kernel Evidence Policy。

本 RFC 不设计公共任意代码插件运行时。未来第三方 executable Mods 可能需要 isolated process、Worker、MCP 或 WASM capability sandbox；如何隔离、授权和分发均 deferred。继续保留现有 MCP、Vault、Host、AI、Fenbi / Obsidian 停用与执行时复核边界，不扩大 preload / IPC / 网络权限。

## 10. Hardware / Trace 边界

```text
Hardware
    ↓
Capture Adapter
    ↓
Raw Trace / transient stream
    ↓
Event Interpreter
    ↓
LearningEvent
    ↓
Recall Kernel
```

持久化是主路径之外的可选侧边界：

```text
Raw Trace / transient stream
      └──→ optional Trace Store
           only when retention is authorized and justified
```

**Semantic event generation must not require raw-trace persistence.** Capture Adapter 的 transient stream 可以直接交由 Event Interpreter 生成语义事件；Trace Store 是 optional、policy-controlled 边界，不是 event generation 或 Kernel 的前置条件。

高频 pen / stylus raw traces 可包含 handwriting、draft reasoning、coordinates、timing、pressure、erasures、pen tilt 与其他潜在敏感的学习材料。设备协议、采样频率、坐标系与 raw storage 不属于 Kernel。

许多正常产品流程只需要 `pause.detected`、`answer.revised`、`erase.detected`、`attempt.completed` 等 semantic events；不能仅因 Kernel 需要这些事件就默认保留 raw traces。Interpreter 的观察与模型解释分别标注，不能用“停顿 8 秒”直接构造 concept misconception Evidence。

可论证的授权保留目的包括用户授权的 replay、research / measurement、未来新版 interpreter 的重新解释，以及隐私策略允许的 debugging。这些用途仍须满足适用的授权与保留策略，不能据此自动启用 Trace Store。

若 trace 未保留，semantic events 仍然有效，不携带 `traceRef`；Kernel 行为必须不依赖 `traceRef` 存在。事件仍保留自身的 semantic payload、来源与 interpreter provenance，不以 raw data 的可回放性作为有效性前提。

若 trace 经授权保留，semantic event 可含 opaque `traceRef`；引用本身不授予访问权。Retention、deletion、access 与 re-interpretation 的策略及执行均在 Kernel 之外。重解释结果需保留 interpreter / policy version 与来源联系，不能伪造新的独立尝试。

Raw data 不得因被保留或存在 `traceRef` 而自动进入 Kernel、AI context、diagnostics、exports、telemetry 或 Mods；引用不能成为原始点流、媒体或设备秘密的传播通道。任何 raw data 访问或使用都须由 Kernel 外的权限与隐私策略独立控制。

**本任务不实现 Trace Store，也不选择硬件存储技术。** 数据保留、删除、容量、授权与重新解释策略须在稳定语义契约及真实设备需求出现后单独设计；不因这张图现在创建新数据库或硬件服务。

## 11. Kernel invariants

1. **模型输出单独不能修改权威 learner state。** 保存、缓存或包装为另一种 event 都不升级 model judgment。
2. **每个 learner-state claim 可追溯到 Evidence IDs。** 默认 unknown / untested 表示无可用支持；适用的正反证须可解析回 Event、record 与 policy version。
3. **Workflow completion 与 learning evidence 是不同事实。** 一个可靠产品 commit 不自动支持理解、技能或保持。
4. **确定性评分不验证模型所写题目与 key 的正确性。** 内容 / key provenance 与 scoring method 分开。
5. **Sensor observation 不直接等于 understanding、mastery 或 misconception。** 推断先形成可验证假设。
6. **同一 events / evidence + 同一 policy versions + 同一相关 time context → 同一 state 与 actions。** 显式注入评估日期、时区和精度；稳定排序、去重与身份不依赖数组插入顺序、加载时钟、随机 ID 或模型新输出。
7. **Kernel 保持纯 TypeScript。** 不依赖 React、Dexie / app/db、Electron、DOM、Provider implementation、UI route structure 或 Platform Host globals。
8. **Mods propose; Adapters observe; Kernel decides state.** adapter provenance 和 Mod 提议都必须经过规则与权限验证。
9. **未知事实保持未知，证据不得洗白。** assistance unknown != none；多个由同一次来源派生的 Evidence != 多次独立测量；legacy mastery != canonical truth。
10. **派生不执行。** recommendation 和 nextVerificationAt 不创建计划、不执行工具、不自动重试多系统副作用。
11. **Semantic event generation must not require raw-trace persistence.** Trace Store 可选且由策略控制；没有 retained trace 或 `traceRef` 不影响 semantic event 有效性，Kernel 行为必须不依赖 `traceRef` 存在。

继续保留当前有用的产品约束：

```text
click != completion
navigation != completion
AI response != completion
Automation success != learning completion
unsubmitted micro-assessment != mastery evidence
```

## 12. 提议：最小代码位置与兼容 facade

以下为最小代码位置：领域契约、`learning-event.ts` 和 `legacy-event-adapter.ts` 已在 #132 完成；`evidence-policy.ts`、`derive-evidence.ts` 及 `evidence-shadow.ts` 在 #133 实现 shadow foundation。Phase D 首片新增 `compatibility-snapshot.ts`；Phase E 前两片新增纯/shadow-only `derive-learner-state.ts` 与 `learner-state-policy.ts`；第三片新增 `verified-assessment-adapter.ts`；第五片新增 WHAT-only `verification-policy.ts`：

```text
app/types/domains/learning-kernel.ts

app/services/learning-kernel/
  learning-event.ts
  legacy-event-adapter.ts
  evidence-policy.ts
  derive-evidence.ts
  evidence-shadow.ts
  derive-learner-state.ts  (Phase E first through fourth slices, pure/shadow-only)
  learner-state-policy.ts (Phase E fourth slice, effective verification policy v3)
  verified-assessment-adapter.ts (Phase E third slice, spec + attempt contract only)
  verification-policy.ts  (Phase E fifth slice, pure WHAT-only decision)
  compatibility-snapshot.ts
```

类型位于 domains，逻辑位于 pure TypeScript domain/service boundary。普通函数和显式输入足以完成派生，不新增 DI container、EventBus、CQRS framework、通用 Manager 或状态管理库。

这些模块不得 import React、app/db / Dexie、Electron、DOM、Provider implementation、Platform Host globals 或 feature / route 实现。若需要读取仓储、执行 AI、访问硬件或 Host，由现有外层 Repository / Application / capability boundary 完成；不要将带运行时全局的历史类型容器导入纯 Kernel。

逐步把现有 cross-domain aggregator 收敛为兼容 facade：

```text
normalized legacy facts
      ↓
LegacyLearningEventAdapter
      ↓
Recall Kernel
      ↓
compatibility LearnerStateSnapshot
      ↓
existing UI / LearningContextAssembler
```

Repository 继续拥有 Review / Knowledge normalization，保留现有作用域及数据关联语义。Facade 负责读写边界之外的装配，不复制 migration writer。保持 LearnerStateSnapshot、现有 recommendation identity / completionHint 和 UI 消费契约；无需 big-bang 删除 learner-state-service。

Phase D 首片的实际路径为 normalized Review / Knowledge attempts → `projectLegacyLearningEvents()` → `deriveEvidence()` → `projectLegacyResultCompatibility()` → 既有 LearnerStateSnapshot 派生。投影只含 source attempt identity、target identity、reported result、Event observed time 和 `legacy_self_report_compatibility` 权限分类（`self_report` / `self_report_only`），不传播用户正文或 legacy confidence/mastery。

仅当有效 Event 派生的 Evidence 同时满足 `claim=correctness`、`evidenceClass=self_report`、`outcome.kind=self_reported_result`、`self_report_only`，且 Event / Evidence source lineage 与输入 attempt identity / target 一致时，结果才可进入兼容投影。completion Evidence 单独不能形成结果；无效、不支持或冲突身份整组省略，不回退 raw Attempt.result。没有时间的有效 legacy Event 保持 `null`，旧 UI 引用使用空值，不补造时间。

这保留 legacy UI 语义：Review / Knowledge 的 latest result 继续影响 board / knowledge weakness、due ordering 和重复错因兼容路径，原始 Mistake / KnowledgeEntry 继续负责 1..5 heuristic、scheduling、展示与推荐目的地。self-report remains self-report；兼容信号和排序不成为独立正确性、理解或 mastery 的新 Kernel truth。LearnerStateSnapshot / Signal / recommendation 公共形状、ID、semanticKey、priority、destination、completionHint、日期转换、证据引用、generatedAt 与 workspace scope 保持兼容。

Phase D 第二片沿用同一 `compatibility-snapshot.ts`：TutoringTurn → `projectLegacyLearningEvents()` → 每题一个 `assessment.submitted` Event → `deriveEvidence()` → `projectCompletedTutoringCompatibility()` → 既有 learner-state 行为，运行时入口为 `projectLegacyTutoringCompatibility()`。只允许 `claim=correctness`、`evidenceClass=scored_performance`、`outcome.kind=supplied_key_comparison`，且 provenance 保持 `keySource=model_authored`、`scoringMethod=option_key_comparison` 与 `model_authored_key` / `no_independent_grader` 限制的 Evidence；completion 不能授予 scored compatibility。

整份测验必须有恰好一次的全部 `1..N` question ordinals；所有有效 Event 的 session、source tutoring_turn、completedAt、assessmentQuestionCount、submittedCorrectCount 和整份 measurement revision 一致，Event / Evidence target、revision 与 source lineage 相容。有效题目数须等于 N，supplied-key matches 总数须等于 submittedCorrectCount。缺片、冲突或不一致整份省略；相同重复测量确定性折叠，绝不回退 raw correctCount 或 raw key 比较。输出白名单仅有 turn ID、session ID、completedAt、questionCount、correctCount、有限权限分类及两个限制，不含 question/options/explanation、teacher prose、confidence 或 provider/reasoning 数据。

为保留 legacy latest-per-session 的 `completedAt DESC → turn.createdAt DESC → turn.id ASC` 排序，完整 Kernel 校验之后额外携带 `compatibilitySourceCreatedAt`，明确为非权限兼容排序 metadata；createdAt 不影响 Evidence 权限。P1 到期 auto plan 继续优先于失败微测；future auto plan + latest failed/pass 分别保持 P2 priority 200 / P4 priority 400。微测 weakness 的文案、score、ID、证据引用及推荐的 ID、semanticKey、destination、priorityReason、completionHint 保持原状。

第二片只迁移 completed micro-assessment：`insufficientEvidenceCount` 仍按 raw 未提交 assessment 的 questions/completedAt 统计工作流 / 数据可用性，不是 learner correctness authority；不能宣称所有 Tutoring 语义均已 Kernel-derived。计划 scheduling 与 repository writers 保持原状。

#136 的第三片沿用同一桥：InterviewEvaluation + matching InterviewSession → `projectLegacyLearningEvents()` → `interview.completed` / `interview.evaluated` → `deriveEvidence()` → `projectEvaluatedInterviewCompatibility()` → 旧 weakness-style UI，运行时入口为 `projectLegacyInterviewCompatibility()`。只接受 `performance` / `model_assessment` / `model_rubric_score`、`direction=inconclusive`，且 provenance 为 model_assessment、modelAuthored=true、model_rubric、keySource=none，含 `model_assessment_only` / `no_independent_grader` 的 Evidence；policyVersion 必须为 evidence-policy/v1，Event 通过现有 policy，source evaluation/session、target 和 measurementGroupId 全部匹配。

整份模型测量必须同时包含唯一 overall slice（Event totalScore / 100）与所有 `0..N-1` dimension slices，index、name、score、maxScore、source Event、lineage 和 provenance 均与现有 policy 派生结果一致。相同重复确定性折叠；冲突 Event / Evidence、缺 overall / dimension 或多余 rubric slice 整组拒绝，不从 raw score 重建。必须另有匹配的 `interview.completed` Event 与 `workflow_fact` Evidence；completion 仅证明工作流已评分，不证明表现好坏。桥不暴露 workflow-only projection，表现缺片时不制造维度信号。

`EvaluatedInterviewCompatibility.authority` 明确为 `legacy_model_assessment_compatibility`、`model_assessment`、`inconclusive` 和两个模型限制。低分只保留旧 weakness-style 展示，高分也不生成 canonical strength / correctness / understanding / mastery / independence / retention / transfer。维度名称只是测量标签，不是 canonical skills；不新增 interview_skill 映射。

完整 Event / Evidence 校验后，桥仅额外携带 `compatibilityUpdatedAt`（旧排序 / observedAt）与 `compatibilityComment`（旧维度展示）两种**非权限 presentation/order metadata**。同 index 的 raw name / score / maxScore 必须先匹配已校验维度，才附加 comment；comment 是有意保留的唯一旧模型文案例外，不进入 canonical Event / Evidence。按 evaluation ID 分组的重复来源只要 sessionId、updatedAt、维度顺序 / name / score / maxScore / comment 不同即拒绝。strengths、problems、suggestions、evaluation.evidence 文案、题干 / 材料 / transcript / turn content、provider output、reasoning、凭据与 raw response 不跨桥。

learner-state 保留 `compatibilityUpdatedAt DESC → evaluationId ASC`、最新四份评价、每份前两个 ratio < 0.7 维度、180 字 summary、signal ID / title / score 和原始 evaluation 引用。`insufficientEvidenceCount` 的 evaluated-session fallback 只读校验后的 projection，不再直接信任 raw evaluation.sessionId；session 自身 evaluated / cancelled 状态仍是 workflow bookkeeping，畸形 / detached evaluation 不能压低 active session 的不足计数。InterviewPracticePlan 的 due / priority 130 / 410、completedSessionCount、targetSessionCount、nextPracticeAt、status 与 destination 继续由 persisted workflow / scheduling facts 决定，saveEvaluation writer 与计划转换不变。

桥接完全内存派生，不持久化 Event、Evidence 或 compatibility projection，不增加 telemetry，不修改 normalization ownership、Dexie v16、UI 或依赖。只有 learner-state-service 可直接消费 compatibility bridge；Kernel 外仍禁止直接 import derive-evidence、evidence-policy 或 evidence-shadow。Phase D compatibility bridge completed after the #136 exact-diff/runtime-read architecture review；#136 已合并，Phase E **COMPLETE**（限定完成范围见第 14 节）：前三片建立完整 Evidence scope、asOf、verified direct assessment 与有限晋级；第四片以 learner-state-policy/v3 的最新等时 effective verification set 解释当前 emerging / scoped independent 或冲突，保留全部合格历史 Evidence；第五片消费该 state 作纯 WHAT-only Verification Policy。第六片建立默认拒绝的 source admission contract；第七片 spec authority、第八片 capture lifecycle foundation 与第九片 controlled assessment surface 已实现，唯一 production owner 为 recall-diagnostic，none 仅表示当前 surface 无内建辅助。仍无 learner-state 或持久化 cutover。

## 13. Persistence、legacy mastery 与回滚

**明确延后所有 Dexie schema 变更。** 核心 `review_workspace` 继续 v16；声明式扩展 `review_extensions` 继续 v1（当前代码见 [review-db.ts](../app/db/review-db.ts) 与 [extension-db.ts](../app/db/extension-db.ts)）。初期结构是：

```text
existing v16 domain records
      ↓
legacy compatibility adapter
      ↓
in-memory / derived LearningEventV1[]
      ↓
EvidenceRecord[]
      ↓
new derived Kernel state
```

现有 repositories 在早期迁移中继续是权威业务 writers；现有 1..5 mastery 与 scheduling 字段继续工作。Kernel 第一阶段无需写回旧 mastery，也不移除或改写旧记录。权威 writer 负责保存用户事实，不意味着 writer 内每条 model / self_report 内容都有权决定 learner truth。

暂不持久化 LearningEvent、EvidenceRecord、LearnerTargetState 或 recommendation，不立即提议 v17，不新建核心业务数据库、索引或跨库事务。被覆盖或删除的历史无法从当前投影恢复；本设计承认这个边界，不声称 append-only audit、完整重放或 exactly-once completion 已存在。

只有当契约通过真实既有产品数据验证有用，并且 hardware / trace 需求提供具体存储证据后，才考虑持久化 Event / Evidence 的单独提案。该提案还必须覆盖来源修订 / 删除、备份恢复、隐私、容量、升级和回滚；不能把需要追溯当作无条件升级 schema 的理由。

Phase A 的 RFC 可作为单一文档变更回滚，**zero data migration**。后续 adoption 逐步可测试、可撤回：contracts / shadow 不影响旧输出；bridge 可恢复旧派生路径；对外 state 需有明确边界与直接验证。Phase D 只改变 Review / Knowledge 自报结果、已完成 Tutoring supplied-key 结果与 Interview 模型评分兼容展示的派生路径，用户数据、UI 公共契约、v16 writers 与 Learning Loop scheduling 保持兼容。

## 14. 渐进迁移与阶段验收

| Phase | 提议内容 | 完成 / 前进条件 | 当前状态 |
| --- | --- | --- | --- |
| A — RFC only | 本文及最小索引 | 审计有源码依据、边界和未知明确、文档验证通过；Draft 供评审 | RFC 已交付；不代表所有后续设计均获批准 |
| B — Kernel contracts | 纯 TS 类型 / 函数、legacy adapters；无 DB 变化 | fixture 验证 self_report、model key、model judgment、unknown、稳定来源 ID 与 time context | Completed / merged in #132（`cd554c172a69f47fe36c65416d5a3871fd8b9563`） |
| C — Evidence Engine shadow mode | 与旧 learner-state 逻辑并行解释；纯 Evidence V1 / Policy V1 推导与计数，不接入运行时 | 差异可解释、无用户可见 authority 改变；production-path 持久化记录只读评估，不导出用户正文 | Acceptance passed on controlled production-path persisted records（4/4 来源类别）；无 authority cutover |
| D — Compatibility bridge | learner-state-service 逐步消费 Kernel 输出 | 相同 UI contract、recommendation identity / transitions、normalization owner 与 scope；可逐项回滚 | Completed / merged through #136；merge commit：`0f6b8857dee5499c18845da9fa8f181b91a2e15e`。Review / Knowledge、completed Tutoring 与 Interview rubric 的 authority reads 均经过 compatibility bridge；unsubmitted Tutoring、session status 与 plan scheduling 保持 workflow facts |
| E — LearnerTargetState V1 | Canonical Evidence、effective state derivation、WHAT-only decision、authorized admission 与受控第一方来源闭环；既有 Kernel/admission semantics 不变 | 单一 canonical spec/key → controlled presentation → submission → trusted capture → authorized owner → admission → existing adapter → Evidence；none 为 source-scoped；state 继续 derived | **COMPLETE**（限定范围见下文）；不表示持久化、长期完整历史、多题产品、mastery/retention/transfer 或 production deployment |
| F — first-party Mod / Adapter boundaries | 先建立 Managed Data Root Foundation 与 source-owned durable capture repository；其他 Mod 后续接入 | Host identity/registry；严格 reopen、完整 source 验证后才分组；first-party compile-time registration、能力授权不变 | Slice 1/2 foundation、Slice 3 durable submit/owner recovery、Slice 4 当前 source epoch 的完整 history→state/WHAT 内部重建已实现；learner continuation、迁移与后续 Mod adoption 未实现，见 storage/history/submission/reconstruction 文档 |
| G — Hardware protocol | 语义契约稳定后设计可选、policy-controlled trace storage 与 digital-pen / tablet adapters | 真实设备需求、interpreter provenance、raw / semantic 分离及授权保留的独立评审 | Deferred |

**Phase B 已完成；#133 的 Phase C shadow foundation 与受控 production-path 持久化记录只读 shadow 验收均已完成；Phase D compatibility bridge 已在 #136 exact-diff/runtime-read 架构评审及合并后完成。** Phase C 验收使用正常 packaged Electron UI / repository 持久化路径生成的 calibration records，而不是直接构造 fixture；它证明当前 Evidence / Policy V1 对真实生产数据形状保持既定 authority、privacy、determinism 与只读边界，但**不代表自然学习历史或真实学习效果验证**。Phase D 的 #134 Review / Knowledge、#135 completed Tutoring 与 #136 Interview 三片均已合并并保留 legacy 展示：self-report 仍是 self-report；model-authored supplied key 仍受 `model_authored_key` / `no_independent_grader` 限制；Interview 仍是 `model_assessment` / `inconclusive`；workflow completion 不等于 learner performance。未提交微测、session 状态与计划 scheduling 继续是 workflow bookkeeping；没有创建 canonical mastery / understanding / independence / retention / transfer，也没有独立 learner-truth authority cutover。Phase E 前六片保留完整 Evidence scope / asOf 因果边界、verified direct correctness 的有限晋级；当前状态由最新等时 effective verification set 决定，历史 Evidence 完整保留，当前 legacy Evidence 全部 blocked；Verification Policy 仅实现 WHAT-only decision，runtime cutover 与状态持久化 deferred。第六片建立 source admission / ownership contract，第七片建立受控 first-party spec/key authority，第八片建立内部 capture lifecycle foundation；第九片接通真实 controlled assessment 与固定 production owner 的 admission/Evidence 路径，none 限于 source-controlled assistance。Completion Audit 已确认当前来源与 lifetime/history 责任边界，Phase E **COMPLETE**；Phase F 已交付 Slice 1 storage foundation、Slice 2 capture repository、Slice 3 durable submit/owner recovery→Evidence 与 Slice 4 当前 profile/epoch/source 的完整 target history→State→WHAT 内部只读重建；learner continuation、额外来源、迁移与 Phase G 仍 deferred。

验收测试应直接调用纯函数，验证模型判断保存前后权限不变、completion 不提升 skill、模型 key 的评分限制、未知 assistance、sensor interpretation、重复来源不加权、缺失 / 冲突 / 来源修订和删除、稳定排序、不同 policy / time context、兼容 bridge 的真实 commit transitions。Phase B / C 的直接契约、Phase C production-path 持久化记录只读验收、Phase D compatibility closure 与 Phase E 受控来源语义验收均已记录其各自范围；Phase F Slice 1 的 Host storage contracts 见 storage 文档，Slice 2 的 durable capture/reopen contracts 见 history 文档；Slice 3 production durable submission/recovery 验收见 submission 文档；Slice 4 完整 source epoch history→state/WHAT 与独立进程重建验收见 reconstruction 文档；Phase G 验收尚未开始。架构守卫只增加固定内部 server composition edges，继续禁止其他外层 consumer、UI authority 和 Kernel storage。

### Phase E completion closure（2026-10-06）

**Phase E COMPLETE — canonical Evidence、effective LearnerTargetState derivation、WHAT-only VerificationDecision、authorized verification source admission，以及 first-party controlled verification source loop 已完成。**

本次 closure 依据 Completion Audit 的结论 **A. Phase E can be marked COMPLETE now**。审计基线为 integration branch `refactor/recall-first-party-diagnostic-source-integration` / HEAD `1453219dec9a4268e73fc099d2bfc8252003057a`，其 main base 为 `f03a7e1d3be9c5fa1e337b8be4d23c9530bcd9a3`。COMPLETE 描述该 integration 内容的限定交付，不表示这些 slices 已合入 main 或已部署。

**Completion rationale。** 当前真实闭环已成立：

```text
canonical spec
→ controlled presentation
→ learner submission
→ trusted capture
→ authorized owner
→ admission
→ existing adapter
→ Evidence
```

[Canonical spec/key authority](../app/services/first-party-diagnostic/spec-authority-core.ts)、[controlled capture](../app/services/first-party-diagnostic/capture-authority-core.ts)、[learner-facing surface](../app/diagnostic/page.tsx)、source-scoped assistance provenance、固定 [production owner](../app/server/diagnostic/source-owner.ts)、[real admission / existing Evidence generation](../app/server/diagnostic/assessment-submission.ts) 均已接通。Caller 不能自签 authority；unknown spec/revision/attempt fail closed，不能回退 caller facts。Correct response → supporting correctness Evidence；incorrect response → refuting correctness Evidence，复用 existing adapter / `evidence-policy/v2`，不新增 mastered、learned、retained 或 transferred claim。

[State](../app/services/learning-kernel/derive-learner-state.ts) 继续是 canonical Evidence 经完整 scope / asOf / effective set 校验后的 derived result；[VerificationDecision](../app/services/learning-kernel/verification-policy.ts) 继续 WHAT-only。`assistance=none` 仅表示当前 Recall controlled assessment surface 未提供 built-in assistance。现有 [runtime contracts](../app/server/diagnostic/assessment-runtime.contract.test.ts) 与 [本机 production standalone Playwright](../e2e/diagnostic-controlled-surface.spec.ts) 覆盖真实 source→admission→Evidence 和正常展示/提交路径；Completion Audit 确认这些证据满足本阶段来源语义验收，不要求另行证明真人身份、自然学习效果或远程部署。Persistence 不属于本阶段 contract。

**History boundary（Phase E closure 时）。** 当时 [diagnostic attempt store](../app/server/diagnostic/assessment-store.ts) 是 **process-local、bounded、TTL-based**：最多 256 sessions，从 issue 起 30 分钟有效。它不构成 durable learning history，也不是完整 history source；expiry/restart/换 process 后 lookup fail closed。Admission 只验证单次 capture，Kernel canonical completeness 只相对于传入 Events。未来若 learner state 开始消费持久历史，必须单独建立完整 Event loading / repository responsibility，不能把 TTL store 的剩余记录当作完整历史。

当前 F3 的历史 owner 已由完整验证的 durable capture snapshot 提供；TTL Map 只保留 active session/continuation。独立进程恢复与 Event/Evidence re-derivation 见 [Slice 3](recall-durable-diagnostic-submission.md)。后续 [Slice 4](recall-diagnostic-state-reconstruction.md) 向 State/WHAT 提供当前 profile/epoch/source 已验证 generation 的完整 canonical target history：先验证与重新准入全部 captures，再分组，空历史与 storage/authority failure 明确区分。Kernel/policy 保持纯；F4 本身只提供内部 server reconstruction，不落盘派生结果，不声称 lifetime/跨来源完整性。

[F5 Diagnostic-first Resume Slice 1](recall-diagnostic-resume.md) 在该接口之外增加固定只读 server 展示 facade 与独立恢复页，
保留失败 discriminants、原 attempt 身份、四维状态与 WHAT；不把 raw history/target/key/authority 传给 renderer。
总览入口和用户显式重复作答只复用既有单题来源；不改 persistence/policy，不引入 scheduler、fresh-profile onboarding 或独立 learner-truth cutover。

**Phase E COMPLETE 本身不表示：** durable attempt storage、Evidence persistence、persisted LearnerState、complete long-term event history、cross-process attempt resolution、multi-question diagnostic product、mastery、retention、transfer、globally unassisted learner、production deployment、Fenbi verified authority 或 Preparation/Planning integration。

**Follow-up（非 completion blocker）：**

- Durable Event/Evidence persistence 与 attempt storage、恢复及跨 process resolution。
- Complete history loader / repository responsibility。
- Multi-question / cross-revision target mapping。
- Additional authorized sources，分别进行 spec/capture/assistance/scope 语义验收。

Fenbi 与 Preparation/Planning 属于独立方向；mastery、retention、transfer 等更强 claim 仍须独立 Evidence/context 与 policy 授权。本次仅收口文档，不修改实现、contracts、runtime、UI、policy 或 schema，不启动新 slice。

## 15. Non-goals 与待定问题

本 RFC 不包含：

- Dexie v17、schema / index / 持久化 ID 变更、新核心业务库。
- EventBus、CQRS framework、DI container、新全局状态管理。
- AI-generated canonical mastery、单一 0–100 mastery、精确统计概率。
- FSRS / IRT / Elo / ML ranking 或现有 Learning Loop 替换。
- Hardware implementation、Trace Store 实现或存储技术选择。
- 公共任意代码 plugin runtime、声明式扩展转为 executable Mods。
- 云账号 / sync redesign、核心栈替换、UI redesign 或新路由。
- 删除当前模块、立即移除公考能力、Conversation 大迁移或扩大 Host / IPC 权限。

仍待后续具体阶段证明的设计问题：

1. 哪类真实内容 / key 验证来源，足以让特定 claim 达到 supported；human / model assessment 如何标注局限？本 RFC 不假设已有通用 independent grader。
2. 旧记录不能还原多次微测 / 重评历史、精确录入时间、辅助事实或作者身份。新契约不得凭这些缺口产生 retention / transfer、独立作答或唯一场次保证。
3. concept / skill / interview_skill 的稳定 namespace 与显式映射如何产生？当前名称、错因文本及模型维度标签不是通用 ontology。
4. 新旧 evidence authority 不同情况下，compatibility bridge 如何保留旧推荐又清楚表达限制？Shadow 报告与直接测试必须先于可见行为变更。
5. 时间策略如何处理日期精度、时区、迟到记录与冲突证据？当前代码使用日期切片与稳定 ID 排序；未来不能默默假定已知全部实际发生顺序。
6. 未来 raw trace 的权限、存储、保留、删除和重新解释成本如何验证？待硬件需求提供证据后单独讨论。

这些问题不阻止已交付的 RFC 或纯 shadow foundation，但不得在没有新授权、契约与证据时默默补成 runtime 实现。

## 16. 验证记录与可核查来源

Phase A 的原始交付只检查文档：执行 `git diff --check`，检查完整 diff、授权文件集合、相对链接、Markdown 结构、当前 / 提议标签及源码语义。仓库没有专用 Markdown / docs validator，当时未机械运行产品 build、Playwright 或 Electron packaging。后续 Phase B / C foundation 的实际验证见各自 PR。

### Phase C controlled production-path persisted-record acceptance（2026-10-04）

在 #133 exact HEAD `940c11fa2950b66f6a06be021c43b820e690592a` 上，从同一 HEAD 构建 packaged Electron，并在独立 Windows 测试账户通过正常 UI / repository 路径生成受控 calibration records；应用退出后冻结 `persist:review-workspace` 分区副本，并只读评估现有 Phase B adapter 与 Phase C Evidence / Policy V1。此样本**不是自然学习历史，也不是学习效果验证**。

- production-path 来源覆盖 4/4：Review attempt 1、Knowledge attempt 1、Tutoring turns 2（含微测 1 / 完成微测 1）、Interview session 1 / evaluation 1。
- 纯函数生成 5 个 LearningEvent、9 条 Evidence、5 个 measurement groups；Evidence diagnostics 0，拒绝 / 冲突 0。
- Evidence class：`workflow_fact=4`、`self_report=2`、`scored_performance=1`、`model_assessment=2`；claim：`completion=4`、`correctness=3`、`performance=2`。
- authority audit 9/9：Review / Knowledge 保持 self-report；Tutoring 仅为 model-authored supplied-key comparison；Interview 仅为 model-assessment performance；completion 不升级为学习成功；未知 assistance 保持 unknown。
- privacy 扫描通过；两次推导的完整序列化与归一化输出一致。
- 冻结分区前后均为 109 个文件，SHA-256 manifest 比对 0 项变化；补充契约测试 60/60、架构守卫 2/2 通过。
- 已知范围限制：样本量很小，只证明当前四类 production-path 数据形状与 Evidence authority / privacy / determinism / read-only 边界；不证明对更广泛真实学习历史的统计泛化，也不证明 Recall 改善学习结果。


### Phase D compatibility bridge closure（2026-10-04）

- [#134](https://github.com/shuangyan123/demo/pull/134) 迁移 Review / Knowledge latest-result semantics；[#135](https://github.com/shuangyan123/demo/pull/135) 迁移 completed Tutoring micro-assessment semantics；[#136](https://github.com/shuangyan123/demo/pull/136) 迁移 Interview model-assessment compatibility，三片均已合并。
- #136 exact HEAD：`22a26ff59197f07efbb20e00509b4c1ac022b6a1`。合并前最终架构评审检查 exact diff、learner-state-service runtime reads、compatibility bridge boundaries、Evidence authority、reviews / unresolved threads 与 exact-head CI。
- Exact-head [CI run 37201574350](https://github.com/shuangyan123/demo/actions/runs/37201574350)：7 applicable jobs SUCCESS；Windows M3 Migration Contracts 与 Windows NSIS Production 为 classifier-SKIPPED。
- #136 squash merge：`0f6b8857dee5499c18845da9fa8f181b91a2e15e`；Phase D compatibility bridge completed。
- Raw unsubmitted Tutoring bookkeeping、Interview session status 与 plan scheduling 仍是 workflow / data-availability facts；Phase D 完成不证明学习效果。
- Phase D closure 时 Phase E 尚未开始；当前 Phase E COMPLETE 的限定范围与 closure 见第 7/14 节。Phase D remains Completed；有限晋级、当前有效验证时间语义与 WHAT-only Verification Policy 已实现，更强维度晋级仍 deferred；spec authority、capture lifecycle 与 controlled surface 已建立，只有固定 recall-diagnostic production owner，尚不承诺 durable/complete history 或排除外部帮助。

当前语义的主要对照入口：

| 来源 | 用途与限制 |
| --- | --- |
| [AGENTS.md](../AGENTS.md)、[engineering Skill](../.agents/skills/review-workspace-engineering/SKILL.md)、[README](../README.md) | 分层、scope、Git preflight、schema / 隐私与 docs-only delivery 约束 |
| [architecture](architecture.md)、[learning-loop](learning-loop.md)、[roadmap](product-roadmap-0.3-to-1.0.md)、[application-layer-migration](application-layer-migration.md) | 当前 read model、提交 / 推荐完成及 Application / Repository 责任 |
| [learner-state-service.contract.test.ts](../app/services/learner-state-service.contract.test.ts) | 旧推荐优先级、稳定身份、最新微测与数据不足的契约；不证明评分 key 独立有效 |
| [learning-loop-completion.contract.test.ts](../app/services/learning-loop-completion.contract.test.ts) | 真实 repository commit 后 grouped action、微测、面试计划的 transition |
| [learning-context.contract.test.ts](../app/services/learning-context.contract.test.ts) | 最小证据引用、上下文预算、微测提交与兼容辅导记录 |
| [interview-repository.contract.test.ts](../app/services/interview-repository.contract.test.ts) | 中止不推进、既有 v16 数据 / 计时兼容 |
| [dashboard-next-action.contract.test.ts](../app/features/review/dashboard-next-action.contract.test.ts)、[study-registry.contract.test.ts](../app/features/study/study-registry.contract.test.ts) | 产品主操作及 registry 的实际导航职责 |
| [declarative-extension.contract.test.ts](../app/services/declarative-extension.contract.test.ts)、[declarative-extension-permissions](declarative-extension-permissions.md) | declaration != authorization、停用 / 能力缺失 / 非运行时包边界 |
| [architecture-boundary.contract.test.ts](../app/features/performance/architecture-boundary.contract.test.ts) | Application purity、Host 方向、只读推荐、Provider 和扩展边界；Phase B / C foundation 已扩展纯 Kernel 与无 authority 接入守卫 |

源码与既有测试是语义审计的事实源；各阶段必须分别记录实际执行证据，不能把既往 assertions 或合成 fixture PASS 当作真实记录只读评估已完成。
