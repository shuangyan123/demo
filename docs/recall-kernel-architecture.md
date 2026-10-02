# Recall Kernel Architecture RFC

- 状态：**Draft / Phase A — RFC only**，供架构评审；尚未实现 Kernel。
- 审计基线：`shuangyan123/demo`，`0b08ec14bf43cffbd64617b89dbea53e26bfa545`。
- 日期：2026-10-02。
- 本次交付：本文和一个 README 索引链接；零 runtime、UI、生产 TypeScript、测试、依赖、schema 或用户数据变更。
- 下文标为“当前”的内容描述上述基线；标为“提议”的契约、策略和目录均是未来设计，不代表已存在的 API 或已完成的阶段。

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
| `traceRef` | 可选 opaque 引用，指向未来受权限保护的 raw trace；不内嵌点流、路径或凭据 |

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
| `claim` | correctness、understanding、independence、retention、transfer、misconception、completion |
| `outcome` | 对该 claim 的支持 / 反证 / inconclusive，及具体测量范围；例如 matches_model_key 而非无条件 objective_correct |
| `evidenceClass` | workflow_fact、self_report、scored_performance、human_assessment、model_assessment、sensor_observation |
| `assistance` | unknown、none、hint、guided、solution；只有显式可靠事实才能选 none |
| `strength` | weak、moderate、strong；对该 claim 的分类支持程度，不是概率 |
| `sourceEventIds` | 非空、可解析的来源 event IDs |
| `sourceRecordRefs` | 原始 record type / ID 与可用 revision；保持与 Event 链一致 |
| `policyVersion` / `provenance` | Evidence Policy 版本及作者、key、评分、辅助、时间、适用范围与限制 |

Evidence Policy 是版本化纯规则，不能由模型或第三方 adapter 任意传入。Event 的来源声明需要 adapter boundary 校验；第三方声称“human graded”或“no assistance”不自动获得高权限。未知、无效、冲突来源不升级，保留理由。

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

当前 [LearnerStateSnapshot](../app/types/domains/learner-state.ts) 是用于 signals 和 recommendations 的 derived read model，不扩展为 canonical state object。未来另建 LearnerTargetState：

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
Raw Trace Store
    ↓
Event Interpreter
    ↓
LearningEvent
    ↓
Recall Kernel
```

Raw trace 可包含 stroke coordinates、pressure、timestamp、page coordinates、erase operation、pen tilt 与 high-frequency point stream。设备协议、采样频率、坐标系与 raw storage 不属于 Kernel。

Kernel 只消费 `pause.detected`、`answer.revised`、`attempt.completed` 等 semantic events。Interpreter 的观察与模型解释分别标注，不能用“停顿 8 秒”直接构造 concept misconception Evidence。

Semantic event 可含 opaque `traceRef`，使未来能在授权后回看并用新版 interpreter 重新解释。重解释结果需保留 interpreter / policy version 与来源联系，不能伪造新的独立尝试。`traceRef` 本身不授予访问权，也不能把高频点流、原始媒体或设备秘密带入 Kernel、模型上下文或普通诊断。

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

继续保留当前有用的产品约束：

```text
click != completion
navigation != completion
AI response != completion
Automation success != learning completion
unsubmitted micro-assessment != mastery evidence
```

## 12. 提议：最小代码位置与兼容 facade

以下路径仅作未来建议，本 PR 不创建这些文件：

```text
app/types/domains/learning-kernel.ts

app/services/learning-kernel/
  learning-event.ts
  legacy-event-adapter.ts
  evidence-policy.ts
  derive-evidence.ts
  derive-learner-state.ts
  verification-policy.ts
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

模型面试 weakness 等旧信号在 Shadow / bridge 中必须标注其 legacy / model 来源，不允许把它们灌回 LearnerTargetState 假称独立验证。如何逐条转接并保持兼容，应由后续有直接测试的策略变更决定。

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

本 RFC 可作为单一文档变更回滚，**zero data migration**。后续 adoption 逐步可测试、可撤回：contracts / shadow 不影响旧输出；bridge 可恢复旧派生路径；对外 state 需有明确边界与直接验证。当前用户数据、UI、runtime、v16 writers 与 Learning Loop 均保持现状。

## 14. 渐进迁移与阶段验收

| Phase | 提议内容 | 完成 / 前进条件 | 本 PR 状态 |
| --- | --- | --- | --- |
| A — RFC only | 本文及最小索引 | 审计有源码依据、边界和未知明确、文档验证通过；Draft 供评审 | 仅此阶段交付文档，不代表设计已获批准 |
| B — Kernel contracts | 纯 TS 类型 / 函数、legacy adapters；无 DB 变化 | fixture 验证 self_report、model key、model judgment、unknown、稳定来源 ID 与 time context | Deferred |
| C — Evidence Engine shadow mode | 与旧 learner-state 逻辑并行解释 | 差异可解释、无用户可见 authority 改变；真实记录只读评估，不导出用户正文 | Deferred |
| D — Compatibility bridge | learner-state-service 逐步消费 Kernel 输出 | 相同 UI contract、recommendation identity / transitions、normalization owner 与 scope；可逐项回滚 | Deferred |
| E — LearnerTargetState V1 | 在 Evidence 足够时暴露 independence / retention / transfer | unknown / conflict / insufficient evidence 可用，维度 claim 有可追溯链；仍 derived，初期不持久化 | Deferred |
| F — first-party Mod / Adapter boundaries | 渐进拆 civil-service；Fenbi 明确 adapter；Tutor / Interview / Obsidian 逐步接入 | first-party compile-time registration、能力授权不变、无删功能或公共代码插件 runtime | Deferred |
| G — Hardware protocol | 语义契约稳定后设计 trace storage 与 digital-pen / tablet adapters | 真实设备需求、interpreter provenance、raw / semantic 分离及存储独立评审 | Deferred |

**本 PR 不实现 B–G，不启动下一阶段。** 这些是迁移提议，不是批准的执行计划或已完成 roadmap 状态。

未来测试应直接调用纯函数，验证模型判断保存前后权限不变、completion 不提升 skill、模型 key 的评分限制、未知 assistance、sensor interpretation、重复来源不加权、缺失 / 冲突 / 来源修订和删除、稳定排序、不同 policy / time context、兼容 bridge 的真实 commit transitions。沿用现有 architecture guard，不为新边界放宽规则。这里只描述未来验收，不新增测试。

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

这些问题不阻止 docs-only RFC，但不得在没有新授权、契约与证据时默默补成 runtime 实现。

## 16. 本次验证与可核查来源

本任务只检查文档：执行 `git diff --check`，检查完整 diff、授权文件集合、相对链接、Markdown 结构、当前 / 提议标签及源码语义。仓库没有专用 Markdown / docs validator；不机械运行产品 build、Playwright 或 Electron packaging。实际执行结果记录在 Draft PR，本文不把未来验收写成已运行 PASS。

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
| [architecture-boundary.contract.test.ts](../app/features/performance/architecture-boundary.contract.test.ts) | Application purity、Host 方向、只读推荐、Provider 和扩展边界；不声称已有 Kernel guard |

源码与现有测试用于本次语义审计；没有执行它们就不能将其既往 assertions 当成本 PR 的测试 PASS。
