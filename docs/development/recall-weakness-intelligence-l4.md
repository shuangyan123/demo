# Recall L4：薄弱与误解智能 v1

L4 是确定性的、只读的学习状态智能。它在读取时由当前掌握度、到期状态、真实 Attempt / KnowledgeAttempt、L1 LearningEvent、显式 `Mistake.reasons` 和事件上真实存在的 `errorCause` 派生，不持久化 inferred weakness state。

## 薄弱 subject

每个 mistake 或 knowledge subject 只看最近 8 个 distinct study dates。同一日按 `wrong > uncertain > correct` 折叠，重复尝试不会增加 recurrence。风险分为：

```text
masteryRisk = 100 - masteryLevelToScore(mastery)
riskScore = clamp(
  masteryRisk
  + latest(wrong: 16, uncertain: 8, correct/none: 0)
  + min(18, wrongDays * 6 + uncertainDays * 3)
  + (due ? 4 : 0)
  - min(12, correctStreak * 4),
  0,
  100,
)
```

掌握度不高、最新 distinct-day 结果为 wrong/uncertain 或 subject 已到期时可以保持薄弱。掌握度至少为 3、未到期且最近两个 distinct study dates 都正确时，旧失败不会继续把 subject 标为 persistent weakness。Board 信号使用当前 eligible mistake 的 top 3 risk 平均值；knowledge 信号直接使用对应 subject risk。

## Misconception

重复错因只使用持久化的 `Mistake.reasons`，仅做 trim、大小写、空白和标点的机械规范化；至少两个当前未解决的不同 mistake ID 才形成信号。通用标签（如“待归因”“其他”“未知”）排除，不做模糊、同义词或 AI 聚类。

显式 `LearningEvent.errorCause` 只消费 wrong/uncertain 事件，且必须在至少两个不同 subject（mistake 或 knowledge）中出现；`other`、缺失字段和正确事件不形成跨 subject cluster。显示名称来自固定本地映射，不由模型生成。

## Evidence 与边界

LearningEvent 通过现有 `learningEventRepository.listForSubject` 读取，并且只对当前 workspace scope 中仍存在的 mistake/knowledge subject 生效。事件是 Attempt / KnowledgeAttempt 的投影，映射回现有 `review_attempt` / `knowledge_attempt` evidence type；不会新增 `learning_event` 类型，也不会让 `sourceRecordCount` 重复计算底层 source records。

L3 diagnosis、confidence、tutor prose、未完成 micro-assessment 和 AI 推断的 error cause 都不是 L4 证据。L1 回填的旧形状事件即使没有可选字段，也仍使用 outcome、observedAt 和 masteryAfter 可用的历史事实。L4 不收集或伪造 `selfConfidence`、`hintCount`、`attemptOrdinal`、`practiceKind`。

L4 不改变 Dexie v17、L2 scheduling、L3 protocol 或现有 recommendation priority / precedence；也不创建 error-cause 自动 review action。更丰富的显式证据采集、L5 analytics 与 presentation 仍是后续工作。
