# Recall L3：AI Tutor Protocol v1

L3 是模型响应与既有辅导轮次之间的协议层，不是新的 tutoring 数据库、Provider 抽象或推荐引擎。当前真实链路是：

`ConversationWorkspace` / `useTutoringFlow` → `requestTutorReply()` → 现有 `TutoringSession` / `TutoringTurn` repository。

对话侧继续使用 `ensureConversationSession()` 和 `putConversationTurn()`；独立辅导侧继续使用 `addTurn()`。协议层不替换这些持久化边界，也不创建平行 `TutoringTurn`。当前基线没有独立持久化的 `TutoringDiagnosis` 或 `TutoringEvaluation` 类型：诊断会映射到已有轮次的 `detectedProblem` / `confidence` 辅导元数据，确定性微测完成继续由既有 repository 创建 `auto:<sessionId>` 计划。

## Protocol v1

`app/services/tutoring-protocol.ts` 定义并校验：

- `version: "v1"`
- `kind: diagnosis | explanation | guided_practice | micro_assessment | summary`
- 必填的学生可见 `content`
- 可选的 `diagnosis`（`summary`、`rationale`、`evidence[]`、`confidence`；应用始终标记 `source: "model_assisted"`）
- 可选的 `nextStep`
- `microAssessment.questions` 题目定义

题目 ID 在本地按位置生成。模型可以提供 `correctOptionIndex` 作为题目定义，但不能提供完成结果。

## Untrusted output and fallback

Provider 返回的文本先经既有 AI JSON 提取，再由协议模块对对象、字段白名单、kind、文本长度、诊断、下一步和题目逐项校验。未知版本/kind、未知字段、空内容、错误诊断或错误题目不会被强制写入。

若结构化元数据无效但存在明确可见文本，协议会降级为不带诊断和微测的 `explanation`；不可用或空响应返回 typed failure，调用方不会伪造辅导轮次。模型提供的 `correctCount`、`completedAt`、`selections`、mastery、`masteryAfter`、`nextReviewAt` 或推荐分等字段会使结构化结果失效，绝不会成为权威状态。

## Evidence boundary

模型诊断和 confidence 只用于辅导展示，不进入 learner-state mastery、正确概率、推荐分或 `LearningEvent`。未作答的 `microAssessment` 没有 `completedAt` / `correctCount`，因此不会产生掌握或薄弱证据。

只有用户提交 selections 后，现有 `completeMicroAssessment()` 才根据题目答案确定性计算 `correctCount`、写入完成时间并创建复练计划。当前路径没有 LLM 语义批改；未来若需要 learner-answer grading，应单独定义并验证边界。L3 也不合成 `selfConfidence`、`hintCount`、`errorCause`、`attemptOrdinal` 或 `practiceKind`。

## Retry, scope, and deferred work

对话助手可见消息仍由 conversation repository 保存；结构化辅导轮次使用现有 `conversationMessageId` 确定性 ID。重复同一 assistant message 的协议持久化会返回已有轮次，不会重复计数或串到其他 session。

本阶段保持 `review_workspace` Dexie v17、既有 Session/Turn/Plan/Link、Provider/credential 边界和 L2 adaptive-review 不变；不新增表、索引或迁移，不改 UI/CSS，不实现 L4 weakness intelligence 或 L5 analytics/recommendation work。
