import assert from "node:assert/strict";
import test from "node:test";
import type { TutoringTurn } from "../types/domains/tutoring.ts";
import { deriveLearnerStateSnapshot, type LearnerStateFacts } from "./learner-state-service.ts";
import {
  buildTutoringProtocolInstructions,
  normalizeTutoringProtocolResponse,
  parseTutoringProtocolResponse,
} from "./tutoring-protocol.ts";

const baseExplanation = {
  version: "v1",
  kind: "explanation",
  content: "先把已知条件按单位统一，再比较两个量的变化。",
  nextStep: { action: "请写出统一单位后的式子", question: "你会先统一哪一个单位？" },
};

const baseQuestion = {
  id: "model-question-id",
  prompt: "哪一步应当先做？",
  options: ["统一单位", "直接猜答案", "跳过条件"],
  correctOptionIndex: 0,
  explanation: "统一单位后，比较才有确定意义。",
};

function validResponse(raw: string) {
  const result = parseTutoringProtocolResponse(raw);
  assert.equal(result.status, "valid");
  if (result.status !== "valid") throw new Error("expected a valid tutoring protocol response");
  return result.response;
}

function emptyFacts(patch: Partial<LearnerStateFacts> = {}): LearnerStateFacts {
  return {
    attempts: [],
    interviewEvaluations: [],
    interviewPracticePlans: [],
    interviewSessions: [],
    knowledgeAttempts: [],
    knowledgeEntries: [],
    learningEvents: [],
    mistakes: [],
    tutoringPlans: [],
    tutoringSessions: [],
    tutoringTurns: [],
    ...patch,
  };
}

test("valid explanation v1 保留可见内容并安全归一化", () => {
  const response = validResponse(JSON.stringify(baseExplanation));
  assert.equal(response.version, "v1");
  assert.equal(response.kind, "explanation");
  assert.equal(response.content, baseExplanation.content);
  assert.deepEqual(response.nextStep, baseExplanation.nextStep);
  assert.equal(response.diagnosis, undefined);
  assert.equal(response.microAssessment, undefined);
});

test("model-assisted diagnosis 总是被应用标记为 model_assisted", () => {
  const response = validResponse(JSON.stringify({
    ...baseExplanation,
    kind: "diagnosis",
    nextStep: undefined,
    diagnosis: {
      summary: "把比例变化误当成绝对变化",
      rationale: "题目中的比较对象在分母上发生了变化。",
      evidence: ["学生本轮把两个不同单位直接相减"],
      confidence: 0.74,
      source: "deterministic",
    },
  }));
  assert.deepEqual(response.diagnosis, {
    summary: "把比例变化误当成绝对变化",
    rationale: "题目中的比较对象在分母上发生了变化。",
    evidence: ["学生本轮把两个不同单位直接相减"],
    confidence: 0.74,
    source: "model_assisted",
  });
});

test("valid micro_assessment 只保留题目定义并生成确定性题目 ID", () => {
  const response = validResponse(JSON.stringify({
    version: "v1",
    kind: "micro_assessment",
    content: "请完成这道小测，提交后应用会确定性地计算结果。",
    microAssessment: { questions: [baseQuestion] },
  }));
  assert.deepEqual(response.microAssessment, {
    questions: [{ ...baseQuestion, id: "micro-1" }],
  });
  assert.equal("correctCount" in response.microAssessment!, false);
  assert.equal("completedAt" in response.microAssessment!, false);
});

test("unknown version 是 typed failure，并在有安全可见内容时降级", () => {
  const normalized = normalizeTutoringProtocolResponse({ ...baseExplanation, version: "v2" });
  assert.equal(normalized.status, "failure");
  if (normalized.status === "failure") assert.equal(normalized.code, "unknown_version");

  const parsed = parseTutoringProtocolResponse(JSON.stringify({ ...baseExplanation, version: "v2" }));
  assert.equal(parsed.status, "fallback");
  if (parsed.status === "fallback") {
    assert.equal(parsed.fallbackReason, "unknown_version");
    assert.equal(parsed.response.content, baseExplanation.content);
    assert.equal(parsed.response.diagnosis, undefined);
  }
});

test("unknown kind 是 typed failure，不会产生结构化辅导状态", () => {
  const normalized = normalizeTutoringProtocolResponse({ ...baseExplanation, kind: "future_kind" });
  assert.equal(normalized.status, "failure");
  if (normalized.status === "failure") assert.equal(normalized.code, "unknown_kind");

  const parsed = parseTutoringProtocolResponse(JSON.stringify({ ...baseExplanation, kind: "future_kind" }));
  assert.equal(parsed.status, "fallback");
  if (parsed.status === "fallback") assert.deepEqual(parsed.response, { version: "v1", kind: "explanation", content: baseExplanation.content });
});

test("malformed assessment question 会整体安全降级，不保留部分题目", () => {
  const parsed = parseTutoringProtocolResponse(JSON.stringify({
    version: "v1",
    kind: "micro_assessment",
    content: "先看这道题。",
    microAssessment: { questions: [{ ...baseQuestion, options: ["只有一个选项"] }] },
  }));
  assert.equal(parsed.status, "fallback");
  if (parsed.status === "fallback") {
    assert.equal(parsed.response.content, "先看这道题。");
    assert.equal(parsed.response.microAssessment, undefined);
    assert.equal(parsed.response.diagnosis, undefined);
  }
});

test("invalid structured metadata + safe visible text 只保存解释 fallback", () => {
  const parsed = parseTutoringProtocolResponse("这是仍然可以展示给学生的简短解释。 ");
  assert.equal(parsed.status, "fallback");
  if (parsed.status === "fallback") {
    assert.equal(parsed.fallbackReason, "malformed_json");
    assert.equal(parsed.response.content, "这是仍然可以展示给学生的简短解释。");
    assert.equal(parsed.response.diagnosis, undefined);
    assert.equal(parsed.response.microAssessment, undefined);
  }
});

test("empty/unusable response 返回 failure，不伪造 tutor turn", () => {
  const parsed = parseTutoringProtocolResponse("   ");
  assert.equal(parsed.status, "failure");
  if (parsed.status === "failure") assert.equal(parsed.code, "malformed_json");
});

test("模型提供的完成、掌握或推荐字段不能进入 normalized response", () => {
  const forbidden = ["correctCount", "completedAt", "selections", "mastery", "masteryAfter", "nextReviewAt", "recommendationScore"];
  for (const field of forbidden) {
    const payload: Record<string, unknown> = { ...baseExplanation, [field]: field === "completedAt" ? "2026-08-10T00:00:00.000Z" : 1 };
    const parsed = parseTutoringProtocolResponse(JSON.stringify(payload));
    assert.equal(parsed.status, "fallback", field);
    if (parsed.status === "fallback") {
      assert.deepEqual(parsed.response, { version: "v1", kind: "explanation", content: baseExplanation.content }, field);
    }
  }

  const assessmentWithState = parseTutoringProtocolResponse(JSON.stringify({
    version: "v1",
    kind: "micro_assessment",
    content: "请作答。",
    microAssessment: { questions: [baseQuestion], correctCount: 1, completedAt: "2026-08-10T00:00:00.000Z" },
  }));
  assert.equal(assessmentWithState.status, "fallback");
  if (assessmentWithState.status === "fallback") assert.equal(assessmentWithState.response.microAssessment, undefined);
});

test("diagnosis 和 microAssessment 只能出现在兼容的 protocol kind", () => {
  const diagnosisOnExplanation = normalizeTutoringProtocolResponse({
    ...baseExplanation,
    diagnosis: { summary: "卡点", rationale: "依据", evidence: [], confidence: 0.5 },
  });
  assert.equal(diagnosisOnExplanation.status, "failure");
  if (diagnosisOnExplanation.status === "failure") assert.equal(diagnosisOnExplanation.code, "incompatible_diagnosis");

  const assessmentOnExplanation = normalizeTutoringProtocolResponse({
    ...baseExplanation,
    microAssessment: { questions: [baseQuestion] },
  });
  assert.equal(assessmentOnExplanation.status, "failure");
  if (assessmentOnExplanation.status === "failure") assert.equal(assessmentOnExplanation.code, "incompatible_micro_assessment");
});

test("model diagnosis 与未作答微测都不会改变 learner-state 输出", () => {
  const diagnosis = validResponse(JSON.stringify({
    version: "v1",
    kind: "diagnosis",
    content: "先区分比较对象，再重新列式。",
    diagnosis: { summary: "模型判断的卡点", rationale: "仅供辅导引导", evidence: ["本轮文字"], confidence: 0.99 },
  }));
  const assessment = validResponse(JSON.stringify({
    version: "v1",
    kind: "micro_assessment",
    content: "请完成小测。",
    microAssessment: { questions: [baseQuestion] },
  }));
  const turns: TutoringTurn[] = [
    { id: "diagnosis-only", sessionId: "session-diagnosis", speaker: "ai_tutor", content: diagnosis.content, detectedProblem: diagnosis.diagnosis?.summary, confidence: diagnosis.diagnosis?.confidence, createdAt: "2026-08-10T00:00:00.000Z" },
    { id: "unanswered", sessionId: "session-assessment", speaker: "ai_tutor", content: assessment.content, microAssessment: assessment.microAssessment, createdAt: "2026-08-10T00:00:01.000Z" },
  ];
  const snapshot = deriveLearnerStateSnapshot(emptyFacts({ tutoringTurns: turns }), new Date("2026-08-10T00:00:00.000Z"));
  assert.equal(snapshot.signals.some((signal) => signal.evidence.some((item) => item.id === "diagnosis-only")), false);
  assert.equal(snapshot.recommendations.some((item) => item.destination.targetIds?.includes("session-diagnosis")), false);
  assert.equal(snapshot.recommendations.some((item) => item.destination.targetIds?.includes("session-assessment")), false);
  assert.equal(snapshot.insufficientEvidenceCount, 1);
});

test("protocol instructions 明确 evidence boundary 且不请求 hidden reasoning", () => {
  const instructions = buildTutoringProtocolInstructions();
  assert.match(instructions, /AI Tutor Protocol v1/);
  assert.match(instructions, /correctCount/);
  assert.match(instructions, /completedAt/);
  assert.match(instructions, /mastery/);
  assert.match(instructions, /model_assisted/);
  assert.match(instructions, /hidden chain-of-thought/);
  assert.match(instructions, /只能是/);
});
