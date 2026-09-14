# Recall L6：跨日回忆与自评把握程度证据

## 定位

L6 是基于本地已保存复盘事实的描述性、可审计观察层。它展示跨日对象日和反馈前自评把握程度，帮助用户回看自己的学习记录；它不是遗忘曲线、记忆保持率、心理测量校准、掌握度预测、推荐依据或 AI 判断。

错题复盘和知识训练现有的 `correct`、`uncertain`、`wrong` 仍然是学习者自评。界面使用“自评答对 / 自评不确定 / 自评答错”说明这一边界，不把它们当作独立客观评分。

## 持久化协议

L6 不新增表、索引或迁移。`LearningEvent` 增加可选非核心字段：

- `selfConfidenceProtocol?: string`
- 首方反馈前自评固定使用 `pre_feedback_1_5_v1`

首方入口只接受窄输入 `{ selfConfidence?: 1 | 2 | 3 | 4 | 5 }`。未提供是合法的“跳过”；提供 `0`、`6`、小数、字符串、`null`、`NaN`、无穷或额外协议 / metadata 会在事务前拒绝，不截断、不转换、不静默丢弃。合法值自动写入固定协议，调用者不能选择协议。

旧 `Attempt.confidence` / `KnowledgeAttempt.confidence` 继续投影为 `masteryAfter`，绝不重解释为自信度。已有任意有限 `selfConfidence`（例如没有协议的 `80`）保留为通用事件，既不转成 1–5，也不破坏既有 B1 核心匹配和恢复读取。

两条首方写入链均在既有事务内读取 authoritative source attempts、执行原有 L2 决策、创建 attempt、推导 `practiceKind`、构建 canonical event，再原子写入 subject state、source attempt 和 event。当前对象同一 canonical 学习日已有来源尝试时写 `retry`，否则写 `standard`；`transfer` 不是首方入口。真实复盘用时继续保留；不写 `attemptOrdinal`、`hintCount` 或 fabricated error cause。

## 派生规则

实现位于 `app/lib/learning-calibration.ts`，不访问数据库，也不依赖 React、L4、推荐或 adaptive review。

### 自信度覆盖

每个 canonical source attempt 只计一次。原始事件先按 `sourceType + sourceId` 分组，再丢弃 core 不匹配的事件；只有核心完全匹配的事件才能参与可选字段判定。相同有效 `(selfConfidence, selfConfidenceProtocol)` 只接受一次；缺失、非法、协议不同或多个有效值冲突时，整个可选自信度样本无效，没有 lexical winner。

有效记录必须同时满足：来源 attempt 存在、核心投影完全匹配、协议精确为 `pre_feedback_1_5_v1`、自信度为整数 1–5，并且未被重复事件争议。`N` 是所选范围内所有有效 source attempts，`C` 是无争议 L6 记录；缺失不是低把握。

### 现存历史排序号

ordinal 只在分析时按 subject 的有效历史重新计算，不持久化。先按 canonical local civil `studyDay` 升序；同一天只有双方都有真实且可比较 timestamp 时才按 timestamp，否则按稳定 source ID tie-break。输入数组顺序和历史事件中已有的 `attemptOrdinal` 均不影响结果。删除或导入历史后，ordinal 可以随现存历史重排。

### 跨日对象日

单位是 `subject × distinct studyDay`，不是 raw attempt。每个对象每天保留最保守结果：`wrong > uncertain > correct`；同日 retry 不增加 denominator。按不同学习日升序后，每个非首日与紧邻前一日配对；当前学习日必须在选择范围内，前一日可在范围外。未来 civil day 以及真实 timestamp 晚于 `now` 的记录排除。

界面只呈现真实前一日 / 当前日和自评结果。`D` 是所选范围内有前一 distinct day 的当前对象日数，`DC` 是当前代表结果为自评答对的数量；不展示百分比、保持概率、衰减桶或“长期记忆已形成”等推断。

不一致只做描述性标记：4–5 分且自评答错为“高把握后自评答错”，1–2 分且自评答对为“低把握后自评答对”。3 分或自评不确定不进入 mismatch，也不做因果解释。

## UI 与范围

复盘和知识训练流程为：提示 → 可选反馈前自评 → 可选查看答案 / 资料 → 自评结果 → 原子提交。直接提交结果而不查看反馈仍然有效。第一次揭示反馈时冻结当前已选值或“未记录”；关闭反馈不会解冻。关联资料、错因详情、知识摘要 / 正文和编辑入口在揭示前不暴露或不可用。

自评控件使用 semantic fieldset / radio，支持键盘与触摸；切换、跳过和成功提交按 subject 清空，失败事务保留当前输入。自评状态不进入 L2 mastery、due、interval、lapse、streak、L4 signals、learner state 或 recommendations。

“薄弱分析”只增加一个紧凑“学习证据”面板，显示：

- `自信度记录 C/N 次`
- `跨日自评答对 DC/D 个对象日`，或 `尚无跨日再测证据`
- 高把握记录中的错误数
- 低把握记录中的答对数

面板明细最多显示每组最新 5 条，含 domain、稳定 subject / source attempt、学习日、结果、自信度和协议；跨日明细含前一日与当前日。原有 raw-attempt `spacedAttemptCount` / `spacedCorrectCount` / `spacedCorrectRate` 内部公式保持不变，但不再以旧“跨日复习通过率”卡片对用户展示。

## 读取与 provenance

workspace data loader 先按现有 `WorkspaceDataScope` 过滤 subjects，再以一次 bounded `learningEventRepository.listForSubjects(...)` 读取对应错题 / 知识 subject 的事件。L6 只使用 `review_attempt` 和 `knowledge_attempt`；不读取或改变 Tutor / interview / sample 之外的事实，不按 event ID 猜测 personal provenance。Explorer 不重做信息架构，只复用同一洞察模型。

## 验证边界

契约覆盖协议和输入拒绝、canonical / duplicate / legacy 处理、practiceKind、事务回滚、ordinal、civil-day / future / range、保守日折叠、UI 揭示冻结、subject 隔离、scope bounded read 以及 L5 既有字段回归。聚焦 Playwright 覆盖桌面复盘、知识训练、洞察明细和 `390×844` 移动端无横向溢出。
