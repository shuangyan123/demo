# Recall L5：Learning Effect & Insight Presentation v1

L5 演进既有“薄弱分析”视图，不新增路由、分析表或第二套学习状态。页面只从当前 workspace 已加载的错题、复盘、知识项、KnowledgeAttempt 和 Learner State 快照派生展示数据。

## 证据边界

- 观察指标只描述真实记录：复盘答对、不确定、答错的数量与答对率，以及按 ISO 日键去重后的学习日期数。
- 复盘答对率是 `correctCount / attemptsCount`；无有效复盘时为 `null`，UI 显示“数据不足”。
- 跨日复习通过率只统计同一错题在更早日已有记录的范围内复盘；同日重试不算跨日证据。
- 恢复证据要求更早学习日有答错或不确定、之后跨日答对、最新学习日仍答对、当前掌握度至少 3 且当前未到期。它不是永久掌握或保留率证明。
- 掌握度沿用持久化 `1..5`；只读派生掌握分使用 canonical 映射 `1→0`、`2→25`、`3→50`、`4→75`、`5→100`，不表示概率、保留率或置信度。
- 趋势的 7 日移动平均按每个日期向前 6 个日历日内的全部有效尝试加权计算，不按日期点平均。

L4 的 weakness / misconception signals 只作为当前证据-backed presentation，展示标题、摘要和真实 evidence 引用数，不重新解释 signal score，也不把模型诊断当作学习事实。L5 不改变推荐优先级、L2 调度、L3 Tutor 协议或 L4 公式。

## 明确不声明

L5 v1 不提供学习效率提升、因果学习增益、掌握概率、记忆率、预计遗忘概率、retention probability 或任何校准预测。Dexie 仍为 v17；没有新增 schema、migration、缓存分析记录或 analytics table。合适的 retention calibration 延后到拥有跨日结果校准数据的后续阶段。

旧的合成样本数和 `mastery * 20` 展示已移除；错题与知识训练分别使用各自真实尝试，零记录显示为“暂无训练记录”或“数据不足”。
