# Recall D1：学习洞察语义一致性

本说明记录基于精确父提交 `af7e770e95a9aaf1b5c9e2818d900bc9457e4858` 的 D1 收口范围。D1 只修正 L5 洞察的报告边界、趋势上下文、优先级排序和文案语义，不新增指标或改变评分。

## 语义修正

- `近 7 天`、`近 30 天`、`近 90 天` 是本地民用日窗口：以 `requireStudyDay(now)` 为今天，以 `addStudyDays(today, -(N - 1))` 为首日；有效尝试按 `studyDay(reviewedAt)` 判断，未来学习日始终排除。`全部` 保留所有有效的非未来历史。
- 可见趋势点仍只来自选中范围；每个点的 7 日加权移动平均从该对象的全部有效历史中取 `D-6..D`，因此首个可见点可以使用报告边界之前的上下文，但不会创建范围外的可见点。加权仍为总答对数 / 总尝试数。
- 错题和知识项共享同一个优先级 comparator：掌握度升序、canonical due study day 升序、无效/缺失日期置后、ID 作为稳定 tie-break。到期判断仍由 `isStudyDayDue` 负责。
- 优先项指标明确标为“本范围”；最近结果明确标为“全部历史最近结果”，不把全历史事实误读为选中范围指标。
- L5 使用“薄弱与错因证据”，并说明薄弱是当前派生状态（适用时），错因证据可能来自近期历史失败，不能证明同一错误当前仍在发生。

## 保持不变与延后事项

- `correctCount`、`uncertainCount`、`wrongCount`、`correctRate`、学习日去重、跨日复习、恢复证据、掌握度映射、可靠样本门槛、趋势门槛和优先级掌握度优先策略保持不变。
- L2 调度与同日策略、L3 Tutor Protocol 与证据边界、L4 风险/恢复/错因聚类与 signal score、Wave 2 canonical LearningEvent/provenance、S1 加载/分组优化均未改动。
- C1 CSS 源码与预算保持不变：生成 CSS 基线 `144811` bytes，硬上限 `144968` bytes；`docs/performance-budget.json` 和 `scripts/check-bundle-budget.mjs` 不变。
- Dexie v17、schema/migrations、依赖与 lockfile、Next/PostCSS 配置、workflow、release 文件均不是 D1 范围。预测、校准、留存率和通用排序重构继续延后。
