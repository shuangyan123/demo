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

## Wave 2 读取完整性边界

Attempt / KnowledgeAttempt 是事件核心事实的唯一来源：`id/sourceType/sourceId/subjectType/subjectId/outcome/observedAt/masteryAfter` 及 Review Attempt 投影的 `durationSec`。持久化事件只有在全部核心字段精确匹配时，才可补充有效的显式可选证据；冲突及悬空事件不进入权威学习历史，完整性检查报告问题，不重写历史数据。L2 在既有提交事务中从同一 subject 的尝试记录构造历史。

L2/L4/L5 使用 `app/lib/study-day.ts`：合法日期字符串保持原民用日，时间戳按运行时本地日历日归一；日历加法不使用 24 小时毫秒步长。Workspace 在下一次本地午夜及恢复焦点/可见性时校正日期。

个人 scope 排除 `sample:` 与 `ui-review:` 来源（含尝试所属对象的来源）；独立 `ui-review` scope 读取审查场景。安装/清理只切换读取上下文，不以审查数据替代个人学习事实。Dexie v17、schema 和评分公式不变。
