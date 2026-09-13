# Recall L2：Adaptive Review Scheduling v1

## 边界

L1 的 `LearningEvent` 现在作为 L2 调度的历史证据，但 `Attempt`、`KnowledgeAttempt` 和掌握度仍是产品事实源。L2 只改变成功复盘的 `nextReviewAt`，不改变掌握度含义：持久化 mastery 仍为 `1..5`，正确 `+1`、不确定不变、错误 `-1`，均做边界限制。

L2 v1 是 deterministic、history-sensitive、interpretable、conservative 的小型策略。它不是 calibrated recall probability、FSRS、SM-2 compatibility 或 validated learning-effect prediction；不向用户展示概率或科学校准结论。

## 策略

正确结果使用 `baseInterval = max(2, masteryAfter * 2)`。若同一 subject 的历史在今天已有事件，触发 same-day retry guard，间隔固定为 `1` 天，不因同日重复尝试增加 streak。否则只取最近 `8` 个 distinct study dates：同日多事件按 `wrong > uncertain > correct` 折叠。

当前正确结果的 streak 从 `1` 开始，连续的 collapsed correct 日期每增加一天乘数增加 `0.25`，effective streak 上限为 `5`。最近窗口中的 wrong 日期提供 `0.10`/日的 lapse penalty，上限 `3` 天。最终正确间隔为四舍五入后的 `base × streakMultiplier × lapseMultiplier`，并限制在 `2..30` 天。

不确定始终为 `1` 天，错误始终为当天（interval `0`）；历史不会放宽这两个保守规则。知识库和错题 repository 共用同一纯策略，并在已有 Dexie transaction 内读取目标 subject 的历史后完成状态、Attempt 和 LearningEvent 写入。

## 数据与延期

不新增表、索引、迁移或持久化 scheduler state，继续使用 Dexie v17；L1 回填的 LearningEvent 与实时事件相同参与历史计算。当前 UI 未可靠收集 `selfConfidence`、`hintCount`、`errorCause`、`attemptOrdinal` 或 `practiceKind`，L2 不合成这些字段。更丰富的证据、延迟 retention outcome 和未来 calibration 延期到后续阶段。
