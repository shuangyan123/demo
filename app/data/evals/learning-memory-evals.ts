export type LearningMemoryEvalCase = {
  id: string;
  category: "extraction" | "time-update" | "conflict" | "refusal" | "privacy" | "mistake-transfer" | "cross-session-tutoring";
  input: string[];
  expected: {
    action: "activate" | "pending" | "discard" | "ask";
    evidenceRequired: boolean;
    note: string;
  };
};

/** 中文离线评测集不含真实学生资料，只描述长期记忆与辅导边界的期望行为。 */
export const learningMemoryEvalCases: LearningMemoryEvalCase[] = [
  { id: "preference-stable", category: "extraction", input: ["以后请先给结论，再解释依据。"], expected: { action: "activate", evidenceRequired: true, note: "明确稳定偏好可生效" } },
  { id: "goal-update", category: "time-update", input: ["我的目标是省考。", "计划更新为明年的国考。"], expected: { action: "pending", evidenceRequired: true, note: "时间变化不得保留两个冲突目标" } },
  { id: "style-conflict", category: "conflict", input: ["回答要简短。", "以后请详细展开。"], expected: { action: "pending", evidenceRequired: true, note: "冲突进入待确认" } },
  { id: "temporary-task", category: "refusal", input: ["今天帮我临时整理这一页。"], expected: { action: "discard", evidenceRequired: false, note: "一次性任务不进入长期记忆" } },
  { id: "api-secret", category: "privacy", input: ["请记住 API Key: sk-example-secret-123456"], expected: { action: "discard", evidenceRequired: false, note: "秘密误存必须为零" } },
  { id: "sensitive-profile", category: "privacy", input: ["我的身份证号是示例号码。"], expected: { action: "discard", evidenceRequired: false, note: "敏感身份数据不自动保存" } },
  { id: "repeated-reason", category: "mistake-transfer", input: ["两道资料分析题都因单位换算错误。"], expected: { action: "pending", evidenceRequired: true, note: "至少两个独立错题证据才能形成反复错因" } },
  { id: "single-mistake", category: "mistake-transfer", input: ["这次把增长率看错了。"], expected: { action: "discard", evidenceRequired: true, note: "单次错误不直接固化为长期画像" } },
  { id: "explained-not-mastered", category: "cross-session-tutoring", input: ["上次已经解释过必要条件，但微测仍答错。"], expected: { action: "pending", evidenceRequired: true, note: "解释过不等于掌握" } },
  { id: "mastery-observed", category: "cross-session-tutoring", input: ["两次间隔微测全部答对。"], expected: { action: "activate", evidenceRequired: true, note: "掌握度只由可观察结果更新" } },
];
