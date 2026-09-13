# Recall L1：LearningEvent 模型基础

## 边界

现有 `Attempt` / `KnowledgeAttempt` 继续作为当前产品行为的 canonical 事实源；`LearningEvent` 是新增的、追加式学习证据层。L1 阶段不替换旧 Attempt，也不参与当时的 scheduling、mastery、learner-state 或推荐决策；L2 v1 只在 repository 内读取它来调整成功复盘间隔。

旧 Attempt 中的 `confidence` 实际表示复盘后的掌握度，因此迁移到 `LearningEvent.masteryAfter`，绝不写入 `selfConfidence`。`selfConfidence` 是未来可由学习者报告的独立可选概念；当前 UI 没有真实证据时保持缺失。

## 数据模型与迁移

`LearningEvent` 只保存来源/主题稳定 ID、结果、观察时间，以及已有证据中的 `masteryAfter` 和 review `durationSec`。`hintCount`、`errorCause`、`attemptOrdinal`、`practiceKind` 与 `selfConfidence` 只有实际证据存在时才可写入；题干、答案、解析、文章正文、AI transcript、截图和附件不复制进事件。

`review_workspace` 从 v16 additive 升级到 v17，新增 `learningEvents` 表及来源、主题和时间索引。v16 的 `attempts` 与 `knowledgeAttempts` 在升级事务内按确定性来源 ID 回填；事件 ID 为 `review_attempt:<attemptId>` 或 `knowledge_attempt:<attemptId>`，因此回填幂等且可追溯。

## 写入、删除与读取

review completion 在更新 `Mistake`、新增 `Attempt` 的同一 Dexie transaction 中新增 `LearningEvent`；knowledge completion 同理更新 `KnowledgeEntry`、新增 `KnowledgeAttempt` 和事件。现有 `recordReview(...)` 调用签名保持兼容。删除错题/知识资料及其训练历史时，同一事务删除对应事件；错题分域清理与 `clearAll` 也清理匹配的事件。

最小读取边界由 `learningEventRepository` 提供：`listForSubject(subjectType, subjectId)`、`listRecent(limit?)` 和按确定性来源 ID 的 `getBySource(...)`。结果按 `observedAt` 倒序、ID 稳定排序；LearningEvent 不被 learner-state service 读取。完整本地数据备份已显式枚举核心表，因此 v2 backup/restore allowlist、manifest 和引用校验包含 `learningEvents`。

## 明确延期

以下内容不属于 L1：adaptive review、AI tutor hint protocol、error-cause inference、retention metrics、learning-effect dashboard，以及任何推荐、调度或掌握度算法迁移。
